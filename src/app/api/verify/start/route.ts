import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { checkAndRecord } from "@/lib/rate-limit"
import { issueVerificationCode } from "@/lib/verification"
import { sendVerificationEmail } from "@/lib/mailer"
import { buildTelegramVerifyUrl } from "@/lib/telegram"
import { normalizeEmail } from "@/lib/utils"

/**
 * POST /api/verify/start — el usuario autenticado pide (re)verificar su correo
 * o teléfono actuales. El código NUNCA se devuelve en claro:
 *   - EMAIL  → sale por Resend (si está configurado).
 *   - PHONE  → sale dentro del deep-link de Telegram (telegramUrl), que es el
 *              canal de entrega; el bot lo consume al hacer /start.
 *
 * Admite cuentas PENDING (p. ej. dueños recién registrados cuyo primer código
 * expiró antes de verificar): solo rechaza no autenticados, cuentas REJECTED
 * o negocios suspendidos.
 *
 * A diferencia de /api/auth/password-reset/request, aquí NO hace falta un
 * piso de latencia anti-enumeración: el lookup va por session.user.id (la
 * propia cuenta del llamante) y cada rama ya responde status/body distintos
 * (400 sin contacto, alreadyVerified, emailSent) — el timing no revela nada
 * que la respuesta no diga, ni permite sondear cuentas ajenas.
 */

const START_WINDOW_MS = 15 * 60 * 1000
const START_MAX_ISSUES = 5

const startSchema = z.object({
  channel: z.enum(["EMAIL", "PHONE"]),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  if (session.user.status === "REJECTED") {
    return NextResponse.json({ error: "Cuenta suspendida" }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => null)
    const parsed = startSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Canal inválido" }, { status: 400 })
    }
    const { channel } = parsed.data

    if (!checkAndRecord("verify-start", session.user.id, START_WINDOW_MS, START_MAX_ISSUES)) {
      return NextResponse.json(
        { error: "Pediste demasiados códigos. Espera unos minutos." },
        { status: 429 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        status: true,
        businessId: true,
        email: true,
        phone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        business: { select: { name: true, isActive: true } },
      },
    })
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }
    if (user.status === "REJECTED" || user.business?.isActive === false) {
      return NextResponse.json({ error: "Cuenta o negocio suspendido" }, { status: 403 })
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
      const emailNorm = normalizeEmail(user.email)
      const { code } = await issueVerificationCode(prisma, {
        userId: user.id,
        businessId: user.businessId,
        identifier: emailNorm,
        channel: "EMAIL",
      })
      const result = await sendVerificationEmail(emailNorm, code, user.business.name)
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
