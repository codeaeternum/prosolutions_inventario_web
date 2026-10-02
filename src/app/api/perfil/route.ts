import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { checkAndRecord } from "@/lib/rate-limit"
import { normalizePhone } from "@/lib/utils"
import { issueVerificationCode } from "@/lib/verification"
import { sendVerificationEmail } from "@/lib/mailer"
import { buildTelegramVerifyUrl, sendTelegramMessage } from "@/lib/telegram"

/**
 * PATCH /api/perfil — el usuario autenticado edita SUS datos de contacto
 * (name, email, phone). Nada más: el schema zod descarta cualquier otro
 * campo del body (role, status, customerType, businessId, creditLimit…), así
 * que es imposible escalar privilegios por aquí, y el update siempre opera
 * sobre session.user.id — nunca sobre un id del payload.
 *
 * Cambiar correo o teléfono invalida la verificación previa
 * (emailVerifiedAt / phoneVerifiedAt → null) y dispara, SIN bloquear la
 * respuesta, un código nuevo por el canal de siempre: correo vía Resend y
 * teléfono vía deep-link de Telegram (entregado por mensaje si la cuenta ya
 * tiene telegramId ligado; si no, el usuario lo pide desde /verificar).
 * Si el valor no cambió, la verificación se conserva.
 */

const PERFIL_WINDOW_MS = 15 * 60 * 1000
const PERFIL_MAX_UPDATES = 5

const patchSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Tu nombre es requerido")
    .max(80, "Tu nombre no puede exceder 80 caracteres")
    .optional(),
  // "" o null limpian el correo (solo si queda otro contacto en la cuenta).
  email: z
    .union([z.email("Ingresa un correo electrónico válido"), z.literal(""), z.null()])
    .optional(),
  phone: z.string().trim().max(30, "El teléfono no puede exceder 30 caracteres").nullish(),
})

/** Prisma P2002 (unique violado): email/phone chocó contra otra cuenta. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  )
}

export async function PATCH(req: Request) {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const userId = auth.session.user.id

  try {
    if (!checkAndRecord("perfil-update", userId, PERFIL_WINDOW_MS, PERFIL_MAX_UPDATES)) {
      return NextResponse.json(
        { error: "Hiciste demasiados cambios. Espera unos minutos." },
        { status: 429 }
      )
    }

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    const { name, email, phone } = parsed.data
    if (name === undefined && email === undefined && phone === undefined) {
      return NextResponse.json({ error: "No hay datos para actualizar" }, { status: 400 })
    }

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        businessId: true,
        name: true,
        email: true,
        phone: true,
        telegramId: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        business: { select: { name: true } },
      },
    })
    if (!current) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Normalización igual que en signup/register: correo en minúsculas y
    // teléfono a sus últimos 10 dígitos (User.phone es único GLOBAL).
    const nextName = name === undefined ? current.name : name
    let nextEmail: string | null = current.email
    if (email !== undefined) {
      const clean = (email ?? "").trim().toLowerCase()
      nextEmail = clean || null
    }
    let nextPhone: string | null = current.phone
    if (phone !== undefined) {
      const normalized = normalizePhone(phone ?? "")
      if ((phone ?? "").trim() && !normalized) {
        return NextResponse.json(
          { error: "El teléfono no tiene dígitos válidos" },
          { status: 400 }
        )
      }
      nextPhone = normalized || null
    }

    // La cuenta siempre conserva un identificador de contacto para entrar.
    if (!nextEmail && !nextPhone) {
      return NextResponse.json(
        { error: "Necesitas al menos un correo o un teléfono en tu cuenta" },
        { status: 400 }
      )
    }

    const currentEmail = current.email?.trim().toLowerCase() ?? null
    const currentPhone = normalizePhone(current.phone) || null
    const emailChanged = email !== undefined && nextEmail !== currentEmail
    const phoneChanged = phone !== undefined && nextPhone !== currentPhone
    const nameChanged = name !== undefined && nextName !== current.name

    if (!nameChanged && !emailChanged && !phoneChanged) {
      // Sin cambios reales: no se toca verifiedAt ni se emiten códigos.
      return NextResponse.json({
        ok: true,
        unchanged: true,
        user: {
          id: current.id,
          name: current.name,
          email: current.email,
          phone: current.phone,
          emailVerifiedAt: current.emailVerifiedAt,
          phoneVerifiedAt: current.phoneVerifiedAt,
        },
        verification: { emailDispatched: false, phoneIssued: false },
      })
    }

    // User.email y User.phone son únicos GLOBALES (no por negocio).
    if (emailChanged && nextEmail) {
      const taken = await prisma.user.findUnique({
        where: { email: nextEmail },
        select: { id: true },
      })
      if (taken && taken.id !== userId) {
        return NextResponse.json(
          { error: "Ya existe una cuenta con ese correo" },
          { status: 409 }
        )
      }
    }
    if (phoneChanged && nextPhone) {
      // Igual que signup/register: teléfonos legacy guardados como "+52…" no
      // empatan en búsqueda exacta; se compara normalizado en memoria.
      const candidates = await prisma.user.findMany({
        where: { phone: { not: null } },
        select: { id: true, phone: true },
      })
      if (candidates.some((u) => u.id !== userId && normalizePhone(u.phone) === nextPhone)) {
        return NextResponse.json(
          { error: "Ya existe una cuenta con ese teléfono" },
          { status: 409 }
        )
      }
    }

    const data: {
      name?: string
      email?: string | null
      emailVerifiedAt?: Date | null
      phone?: string | null
      phoneVerifiedAt?: Date | null
    } = {}
    if (nameChanged) data.name = nextName
    // El contacto nuevo vuelve a quedar pendiente de verificación.
    if (emailChanged) {
      data.email = nextEmail
      data.emailVerifiedAt = null
    }
    if (phoneChanged) {
      data.phone = nextPhone
      data.phoneVerifiedAt = null
    }

    let updated
    try {
      updated = await prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
        },
      })
    } catch (error) {
      // Carrera contra el chequeo previo: el unique manda.
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: "Ese correo o teléfono ya está en uso por otra cuenta" },
          { status: 409 }
        )
      }
      throw error
    }

    // Re-verificación en segundo plano: nunca bloquea ni tumba el PATCH.
    const emailDispatched = emailChanged && Boolean(nextEmail)
    const phoneIssued = phoneChanged && Boolean(nextPhone)
    if (emailDispatched || phoneIssued) {
      void (async () => {
        if (emailDispatched && nextEmail) {
          const { code } = await issueVerificationCode(prisma, {
            userId,
            businessId: current.businessId,
            identifier: nextEmail,
            channel: "EMAIL",
          })
          await sendVerificationEmail(nextEmail, code, current.business?.name)
        }
        if (phoneIssued && nextPhone) {
          // El canal de entrega del teléfono es el deep-link de Telegram
          // (como en /api/verify/start): el bot lo consume al hacer /start.
          const { code } = await issueVerificationCode(prisma, {
            userId,
            businessId: current.businessId,
            identifier: nextPhone,
            channel: "TELEGRAM",
          })
          const telegramUrl = await buildTelegramVerifyUrl(code)
          if (telegramUrl && current.telegramId) {
            await sendTelegramMessage(
              current.telegramId,
              `Actualizaste tu teléfono en Reficio. Para verificarlo abre este enlace y toca «Iniciar»:\n${telegramUrl}`,
            )
          }
        }
      })().catch((error) => console.error("[perfil] Error emitiendo re-verificación:", error))
    }

    return NextResponse.json({
      ok: true,
      user: updated,
      verification: { emailDispatched, phoneIssued },
    })
  } catch (error) {
    console.error("[perfil] Error actualizando contacto:", error)
    return NextResponse.json({ error: "No se pudieron guardar los cambios" }, { status: 500 })
  }
}
