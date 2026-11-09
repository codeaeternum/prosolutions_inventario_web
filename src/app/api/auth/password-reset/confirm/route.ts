import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { normalizePhone } from "@/lib/utils"
import { consumeVerificationCode, VerificationError } from "@/lib/verification"
import { recordAudit } from "@/lib/audit"

/**
 * POST /api/auth/password-reset/confirm
 *
 * Consume el código de 6 dígitos emitido para PASSWORD_RESET, actualiza el
 * hash bcrypt de User.password (lo que invalida automáticamente cualquier JWT
 * activo en el siguiente request vía passwordVersion en session-policy.ts) y
 * registra el evento en la bitácora sin exponer la contraseña.
 */

const CONFIRM_WINDOW_MS = 15 * 60 * 1000
const CONFIRM_MAX_ATTEMPTS = 15

const NO_STORE = { "Cache-Control": "private, no-store" } as const

const confirmSchema = z.object({
  identifier: z.string().trim().min(1, "Ingresa tu correo o teléfono").max(254),
  code: z.string().trim().regex(/^\d{6}$/, "El código debe ser de 6 dígitos"),
  newPassword: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(128, "La contraseña no puede exceder 128 caracteres"),
})

function normalizeIdentifier(raw: string): string {
  const rawLower = raw.trim().toLowerCase()
  if (rawLower.includes("@")) return rawLower
  return normalizePhone(rawLower) || rawLower
}

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req)
    if (!checkAndRecord("pwd-reset-confirm", ip, CONFIRM_WINDOW_MS, CONFIRM_MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos." },
        { status: 429, headers: NO_STORE },
      )
    }

    const body = await req.json().catch(() => null)
    const parsed = confirmSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400, headers: NO_STORE },
      )
    }

    const normId = normalizeIdentifier(parsed.data.identifier)

    let row
    try {
      row = await consumeVerificationCode(prisma, {
        identifier: normId,
        code: parsed.data.code,
        purpose: "PASSWORD_RESET",
      })
    } catch (error) {
      if (error instanceof VerificationError) {
        return NextResponse.json(
          { error: "Código inválido o expirado" },
          { status: 400, headers: NO_STORE },
        )
      }
      throw error
    }

    if (!row.userId) {
      return NextResponse.json(
        { error: "Código inválido o expirado" },
        { status: 400, headers: NO_STORE },
      )
    }

    const hashedPassword = await bcrypt.hash(parsed.data.newPassword, 12)
    const updatedUser = await prisma.user.update({
      where: { id: row.userId },
      data: { password: hashedPassword },
      select: { id: true, name: true, businessId: true },
    })

    await recordAudit(prisma, {
      businessId: updatedUser?.businessId ?? row.businessId ?? "",
      actorId: row.userId,
      action: "USER_PASSWORD_RESET",
      entity: "user",
      entityId: row.userId,
      entityName: updatedUser?.name ?? null,
      summary: "Restableció su contraseña con código de verificación",
      impersonator: null,
    })

    return NextResponse.json({ ok: true }, { status: 200, headers: NO_STORE })
  } catch (error) {
    console.error("[password-reset/confirm] Error:", error)
    return NextResponse.json(
      { error: "No se pudo restablecer la contraseña" },
      { status: 500, headers: NO_STORE },
    )
  }
}
