import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { normalizePhone } from "@/lib/utils"
import { issueVerificationCode } from "@/lib/verification"
import { sendPasswordResetEmail } from "@/lib/mailer"
import { escapeTelegramHtml, sendTelegramMessage } from "@/lib/telegram"
import { withLatencyFloor } from "@/lib/timing"

/**
 * POST /api/auth/password-reset/request
 *
 * Inicia la recuperación de contraseña enviando un código de 6 dígitos
 * (purpose: "PASSWORD_RESET") por correo y/o Telegram.
 * Respuesta constante 200 anti-enumeración aunque la cuenta no exista,
 * esté rechazada o no tenga canal de entrega configurado.
 */

const RESET_WINDOW_MS = 15 * 60 * 1000
const MAX_BY_IP = 10
const MAX_BY_ID = 5

const NO_STORE = { "Cache-Control": "private, no-store" } as const

const ANTI_ENUM_MESSAGE = "Si la cuenta existe, enviamos un código de 6 dígitos."

const requestSchema = z.object({
  identifier: z.string().trim().min(1, "Ingresa tu correo o teléfono").max(254),
  businessSlug: z.string().trim().max(80).optional(),
})

function normalizeIdentifier(raw: string): { normId: string; isEmail: boolean; rawLower: string } {
  const rawLower = raw.trim().toLowerCase()
  const isEmail = rawLower.includes("@")
  if (isEmail) return { normId: rawLower, isEmail: true, rawLower }
  const phoneNorm = normalizePhone(rawLower)
  return { normId: phoneNorm || rawLower, isEmail: false, rawLower }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400, headers: NO_STORE },
      )
    }

    const { normId, isEmail, rawLower } = normalizeIdentifier(parsed.data.identifier)
    const ip = getClientIp(req)

    if (
      !checkAndRecord("pwd-reset-ip", ip, RESET_WINDOW_MS, MAX_BY_IP) ||
      !checkAndRecord("pwd-reset-id", normId, RESET_WINDOW_MS, MAX_BY_ID)
    ) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera unos minutos." },
        { status: 429, headers: NO_STORE },
      )
    }

    // Piso de latencia anti-enumeración: status y body son constantes, pero
    // la rama "cuenta existe" await-ea issueVerificationCode + Resend
    // (~200-800 ms) + Telegram y la "no existe" respondía en ~10 ms — una
    // request de >300 ms confirmaba la cuenta. El piso aleatorio [500, 800]
    // iguala ambas ramas y el jitter por request impide que el propio umbral
    // las distinga (ver lib/timing). Los 400/429 anteriores no entran al
    // piso: ya se distinguen por status y no revelan existencia.
    return withLatencyFloor(async () => {
      const slug = parsed.data.businessSlug?.trim().toLowerCase() || undefined
      const where = {
        ...(isEmail
          ? { email: normId }
          : {
              OR: [
                { phone: normId },
                ...(rawLower !== normId ? [{ phone: rawLower }] : []),
              ],
            }),
        status: { not: "REJECTED" as const },
        business: {
          isActive: true,
          ...(slug ? { slug } : {}),
        },
      }
      const select = {
        id: true,
        businessId: true,
        email: true,
        phone: true,
        telegramId: true,
        status: true,
        business: { select: { name: true, isActive: true } },
      } as const

      const matches =
        typeof prisma.user.findMany === "function"
          ? await prisma.user.findMany({ where, select, take: 2 })
          : []
      const user =
        matches.length === 1
          ? matches[0]
          : matches.length === 0 && typeof prisma.user.findFirst === "function"
            ? await prisma.user.findFirst({ where, select })
            : null

      if (
        user &&
        user.status !== "REJECTED" &&
        user.business?.isActive !== false &&
        (user.email || user.telegramId)
      ) {
        const channel = user.email ? "EMAIL" : "TELEGRAM"
        const { code } = await issueVerificationCode(prisma, {
          userId: user.id,
          businessId: user.businessId,
          identifier: normId,
          channel,
          purpose: "PASSWORD_RESET",
        })

        if (user.email) {
          await sendPasswordResetEmail(user.email, code, user.business?.name)
        }
        if (user.telegramId) {
          await sendTelegramMessage(
            user.telegramId,
            `🔑 <b>Código para restablecer tu contraseña</b>\n\nTu código de verificación es: <code>${escapeTelegramHtml(code)}</code>\n\nExpira en 15 minutos. Si no solicitaste este cambio, ignora este mensaje.`,
          )
        }
      }

      return NextResponse.json(
        { ok: true, message: ANTI_ENUM_MESSAGE },
        { status: 200, headers: NO_STORE },
      )
    })
  } catch (error) {
    console.error("[password-reset/request] Error:", error)
    return NextResponse.json(
      { error: "No se pudo procesar la solicitud" },
      { status: 500, headers: NO_STORE },
    )
  }
}
