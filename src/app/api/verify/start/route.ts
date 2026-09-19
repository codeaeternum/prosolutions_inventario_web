import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { checkAndRecord } from "@/lib/rate-limit"
import { issueVerificationCode } from "@/lib/verification"
import { sendVerificationEmail } from "@/lib/mailer"
import { buildTelegramVerifyUrl } from "@/lib/telegram"

/**
 * POST /api/verify/start — el usuario autenticado pide (re)verificar su correo
 * o teléfono actuales. El código NUNCA se devuelve en claro:
 *   - EMAIL  → sale por Resend (si está configurado).
 *   - PHONE  → sale dentro del deep-link de Telegram (telegramUrl), que es el
 *              canal de entrega; el bot lo consume al hacer /start.
 */

const START_WINDOW_MS = 15 * 60 * 1000
const START_MAX_ISSUES = 5

const startSchema = z.object({
  channel: z.enum(["EMAIL", "PHONE"]),
})

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error

  try {
    const body = await req.json().catch(() => null)
    const parsed = startSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Canal inválido" }, { status: 400 })
    }
    const { channel } = parsed.data

    if (!checkAndRecord("verify-start", auth.session.user.id, START_WINDOW_MS, START_MAX_ISSUES)) {
      return NextResponse.json(
        { error: "Pediste demasiados códigos. Espera unos minutos." },
        { status: 429 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.session.user.id },
      select: {
        id: true,
        businessId: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        business: { select: { name: true } },
      },
    })
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    if (channel === "EMAIL") {
      if (!user.email) {
        return NextResponse.json(
          { error: "Tu cuenta no tiene correo registrado" },
          { status: 400 }
        )
      }
      if (user.emailVerifiedAt) {
        return NextResponse.json({ ok: true, alreadyVerified: true, emailSent: false })
      }
      const { code } = await issueVerificationCode(prisma, {
        userId: user.id,
        businessId: user.businessId,
        identifier: user.email,
        channel: "EMAIL",
      })
      const result = await sendVerificationEmail(user.email, code, user.business.name)
      return NextResponse.json({ ok: true, emailSent: result.sent, reason: result.sent ? undefined : result.reason })
    }

    // channel === "PHONE": la entrega es el deep-link de Telegram.
    if (!user.phone) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene teléfono registrado" },
        { status: 400 }
      )
    }
    if (user.phoneVerifiedAt) {
      return NextResponse.json({ ok: true, alreadyVerified: true, telegramUrl: null })
    }
    const { code } = await issueVerificationCode(prisma, {
      userId: user.id,
      businessId: user.businessId,
      identifier: user.phone,
      channel: "TELEGRAM",
    })
    const telegramUrl = await buildTelegramVerifyUrl(code)
    if (!telegramUrl) {
      return NextResponse.json(
        { error: "El bot de Telegram no está disponible ahora. Intenta más tarde." },
        { status: 503 }
      )
    }
    return NextResponse.json({ ok: true, telegramUrl })
  } catch (error) {
    console.error("[verify/start] Error emitiendo código:", error)
    return NextResponse.json({ error: "No se pudo generar el código" }, { status: 500 })
  }
}
