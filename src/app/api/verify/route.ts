import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { normalizePhone } from "@/lib/utils"
import {
  consumeVerificationCode,
  markVerified,
  VerificationError,
} from "@/lib/verification"

/**
 * POST /api/verify — consume un código de verificación de contacto.
 * Público (el código viaja por correo y el usuario puede no tener sesión aún).
 * Respuestas genéricas en fallo: nunca se revela si el identifier existe.
 */

const VERIFY_WINDOW_MS = 15 * 60 * 1000
const VERIFY_MAX_ATTEMPTS = 10

const verifySchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  code: z.string().trim().regex(/^\d{6}$/, "El código debe ser de 6 dígitos"),
})

const GENERIC_ERROR = "Código incorrecto o expirado. Solicita uno nuevo."

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = verifySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }

    // Correo en minúsculas; si parece teléfono se prueba también la forma
    // normalizada (últimos 10 dígitos) en que se guarda en User.phone.
    const raw = parsed.data.identifier.toLowerCase()
    const identifiers = [raw]
    if (!raw.includes("@")) {
      const phoneNorm = normalizePhone(raw)
      if (phoneNorm && phoneNorm !== raw) identifiers.push(phoneNorm)
    }
    const identifier = identifiers[0]
    const ip = getClientIp(req)
    if (!checkAndRecord("verify", `${ip}:${identifier}`, VERIFY_WINDOW_MS, VERIFY_MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos." },
        { status: 429 }
      )
    }

    try {
      let consumed = null as Awaited<ReturnType<typeof consumeVerificationCode>> | null
      let lastError: unknown = null
      for (const candidate of identifiers) {
        try {
          consumed = await consumeVerificationCode(prisma, {
            identifier: candidate,
            code: parsed.data.code,
          })
          break
        } catch (error) {
          lastError = error
          // Sin fila vigente para este identifier: probar la otra forma.
          if (error instanceof VerificationError && error.reason === "MISMATCH" && !consumed) continue
          throw error
        }
      }
      if (!consumed) throw lastError ?? new VerificationError("MISMATCH", "Código incorrecto")
      if (consumed.userId) {
        await markVerified(prisma, consumed.userId, consumed.channel)
      }
      return NextResponse.json({ verified: true, channel: consumed.channel })
    } catch (error) {
      if (error instanceof VerificationError && error.reason === "TOO_MANY_ATTEMPTS") {
        return NextResponse.json(
          { error: "Demasiados intentos con ese código. Solicita uno nuevo." },
          { status: 429 }
        )
      }
      // NOT_FOUND / EXPIRED / MISMATCH → misma respuesta genérica.
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
    }
  } catch (error) {
    console.error("[verify] Error consumiendo código:", error)
    return NextResponse.json({ error: "No se pudo verificar el código" }, { status: 500 })
  }
}
