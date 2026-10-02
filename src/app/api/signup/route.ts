import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { isValidSlug, normalizeSlug } from "@/lib/slug-rules"
import { generateSlug, normalizePhone } from "@/lib/utils"
import { SUGGESTED_SERVICES } from "@/lib/workshop-service-suggestions"
import { issueVerificationCode } from "@/lib/verification"
import { sendVerificationEmail } from "@/lib/mailer"
import { buildTelegramVerifyUrl } from "@/lib/telegram"

/**
 * POST /api/signup — Alta pública de una empresa nueva (multi-tenant).
 *
 * En una sola transacción crea: el Business (con slug único del namespace
 * público /<slug>), su primer User ADMIN + APPROVED, el SystemSettings semilla
 * (ticket_business_name), la sucursal "Principal" y el catálogo sugerido de
 * servicios de taller. TODO o nada.
 *
 * Cerrado por defecto: requiere REFICIO_SIGNUP_ENABLED=true en el entorno.
 * Se abre cuando el aislamiento multi-tenant esté completo (fase 2).
 */

const SIGNUP_WINDOW_MS = 15 * 60 * 1000
const SIGNUP_MAX_ATTEMPTS = 5
// SLUG_RE permite máx. 50 chars; se reservan 4 para el sufijo "-999".
const SLUG_BASE_MAX_LEN = 46
const SLUG_DERIVATION_ATTEMPTS = 50

const signupSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "El nombre del negocio debe tener al menos 2 caracteres")
    .max(80, "El nombre del negocio no puede exceder 80 caracteres"),
  slug: z.string().max(80).nullish(),
  adminName: z
    .string()
    .trim()
    .min(1, "Tu nombre es requerido")
    .max(80, "Tu nombre no puede exceder 80 caracteres"),
  email: z.email("Ingresa un correo electrónico válido"),
  phone: z.string().max(30, "El teléfono no puede exceder 30 caracteres").nullish(),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres")
    .max(100, "La contraseña no puede exceder 100 caracteres"),
  // Giro del negocio (Business.businessKind): no restringe módulos, solo
  // adapta onboarding y opciones visibles. Default FULL (taller + refacciones).
  businessKind: z.enum(["FULL", "REPAIR", "PARTNER", "PARTS"]).default("FULL"),
})

/** Prisma P2002 (unique violado): slug/email/phone chocó dentro de la tx. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  )
}

/**
 * El slug está ocupado si ya es namespace de un negocio (Business.slug) o el
 * publicSlug de un taller aliado. Los reservados los filtra isValidSlug antes.
 */
async function isSlugTaken(slug: string): Promise<boolean> {
  const [business, workshop] = await Promise.all([
    prisma.business.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findFirst({ where: { publicSlug: slug }, select: { id: true } }),
  ])
  return Boolean(business ?? workshop)
}

/**
 * Deriva un slug libre a partir del nombre del negocio: base slugificada
 * (minúsculas, sin acentos, guiones) y, si choca contra Business.slug,
 * User.publicSlug o los reservados, prueba sufijos -2, -3… hasta encontrar
 * uno disponible. Devuelve null si se agotan los intentos.
 */
async function deriveAvailableSlug(businessName: string): Promise<string | null> {
  const base =
    normalizeSlug(generateSlug(businessName)).slice(0, SLUG_BASE_MAX_LEN).replace(/-+$/, "") ||
    "negocio"
  for (let i = 1; i <= SLUG_DERIVATION_ATTEMPTS; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`
    if (isValidSlug(candidate) && !(await isSlugTaken(candidate))) return candidate
  }
  return null
}

export async function POST(req: Request) {
  // Flag de apertura: sin REFICIO_SIGNUP_ENABLED=true el alta no existe.
  if (process.env.REFICIO_SIGNUP_ENABLED !== "true") {
    return NextResponse.json(
      { error: "El registro de empresas aún no está abierto" },
      { status: 403 }
    )
  }

  try {
    const ip = getClientIp(req)
    if (!checkAndRecord("signup", ip, SIGNUP_WINDOW_MS, SIGNUP_MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiados intentos de registro. Espera unos minutos." },
        { status: 429 }
      )
    }

    const body = await req.json().catch(() => null)
    const parseResult = signupSchema.safeParse(body)
    if (!parseResult.success) {
      const message = parseResult.error.issues[0]?.message ?? "Datos inválidos"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const { businessName, slug: rawSlug, adminName, email, phone, password, businessKind } = parseResult.data
    const emailNorm = email.trim().toLowerCase()
    // User.phone es único GLOBAL: se guarda normalizado (últimos 10 dígitos)
    // para que "+52 811 234 5678" y "811 234 5678" choquen en vez de evadirlo.
    const phoneOrNull = normalizePhone(phone) || null
    if (phone?.trim() && !phoneOrNull) {
      return NextResponse.json(
        { error: "El teléfono no tiene dígitos válidos" },
        { status: 400 }
      )
    }

    // Slug: explícito (validado; 409 si está ocupado) o derivado del nombre.
    const requestedSlug = normalizeSlug(typeof rawSlug === "string" ? rawSlug : "")
    let slug: string
    if (requestedSlug) {
      if (!isValidSlug(requestedSlug)) {
        return NextResponse.json(
          { error: "Slug inválido o reservado: usa minúsculas, números y guiones internos" },
          { status: 400 }
        )
      }
      if (await isSlugTaken(requestedSlug)) {
        return NextResponse.json(
          { error: "Ese slug ya está en uso. Prueba con otro." },
          { status: 409 }
        )
      }
      slug = requestedSlug
    } else {
      const derived = await deriveAvailableSlug(businessName)
      if (!derived) {
        return NextResponse.json(
          { error: "No pudimos generar un link público disponible. Elige un slug manualmente." },
          { status: 409 }
        )
      }
      slug = derived
    }

    // User.email y User.phone son únicos GLOBALES (no por negocio). El teléfono
    // se compara normalizado en memoria — filas legacy guardadas como "+52…" no
    // empatan con la búsqueda exacta (volumen de piloto, cf. customers.ts).
    const [existingEmail, phoneCandidates] = await Promise.all([
      prisma.user.findUnique({ where: { email: emailNorm }, select: { id: true } }),
      phoneOrNull
        ? prisma.user.findMany({ where: { phone: { not: null } }, select: { phone: true } })
        : Promise.resolve([]),
    ])
    if (existingEmail) {
      return NextResponse.json(
        { error: "Ya existe una cuenta con ese correo" },
        { status: 409 }
      )
    }
    if (phoneCandidates.some((u) => normalizePhone(u.phone) === phoneOrNull)) {
      return NextResponse.json(
        { error: "Ya existe una cuenta con ese teléfono" },
        { status: 409 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // La cuenta nace PENDING solo si hay un canal por donde entregar la
    // verificación: correo vía Resend, o teléfono vía bot de Telegram. Un
    // PENDING sin canal posible quedaría atascado para siempre. Con canal,
    // el dueño se activa (APPROVED) al verificar — markVerified lo promueve.
    const telegramReady = Boolean(process.env.TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_BOT_TOKEN)
    const canVerify = Boolean(process.env.RESEND_API_KEY) || (Boolean(phoneOrNull) && telegramReady)

    // Ids del alta para emitir los códigos de verificación fuera de la tx.
    let createdBusinessId: string | null = null
    let createdUserId: string | null = null
    try {
      await prisma.$transaction(async (tx) => {
        const business = await tx.business.create({
          data: {
            name: businessName,
            slug,
            phone: phoneOrNull,
            isActive: true,
            businessKind,
          },
          select: { id: true },
        })
        const adminUser = await tx.user.create({
          data: {
            businessId: business.id,
            name: adminName,
            email: emailNorm,
            phone: phoneOrNull,
            password: hashedPassword,
            role: "ADMIN",
            status: canVerify ? "PENDING" : "APPROVED",
          },
          select: { id: true },
        })
        createdBusinessId = business.id
        createdUserId = adminUser.id
        // Semillas del negocio: nombre para tickets y sucursal principal.
        await tx.systemSettings.create({
          data: {
            businessId: business.id,
            key: "ticket_business_name",
            value: businessName,
          },
        })
        await tx.branch.create({
          data: { businessId: business.id, name: "Principal", isActive: true },
        })
        // Catálogo inicial de servicios de taller: precio null = "según
        // dispositivo". El negocio los edita/desactiva desde el catálogo.
        await tx.workshopService.createMany({
          data: SUGGESTED_SERVICES.map((service) => ({
            businessId: business.id,
            name: service.name,
            equipmentType: service.equipmentType,
            priceCents: null,
          })),
        })
        // Bitácora de plataforma: el alta queda registrada junto con la
        // suspensión/eliminación (PlatformEvent no tiene FK — sobrevive al
        // borrado del tenant).
        await tx.platformEvent.create({
          data: {
            businessId: business.id,
            businessSlug: slug,
            businessName,
            kind: "TENANT_CREATED",
            actorId: adminUser.id,
            actorEmail: emailNorm,
            detail: { selfService: true, businessKind },
          },
        })
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: "El slug, correo o teléfono ya están en uso. Revisa los datos." },
          { status: 409 }
        )
      }
      throw error
    }

    // Verificación de contacto post-alta (no bloquea el acceso). El código en
    // claro solo viaja por su canal: correo vía Resend o el deep-link de
    // Telegram — jamás en esta respuesta salvo dentro de telegramUrl.
    let emailSent = false
    let telegramUrl: string | null = null
    try {
      if (createdUserId) {
        const emailCode = await issueVerificationCode(prisma, {
          userId: createdUserId,
          businessId: createdBusinessId,
          identifier: emailNorm,
          channel: "EMAIL",
        })
        emailSent = (await sendVerificationEmail(emailNorm, emailCode.code, businessName)).sent
        if (phoneOrNull) {
          const phoneCode = await issueVerificationCode(prisma, {
            userId: createdUserId,
            businessId: createdBusinessId,
            identifier: phoneOrNull,
            channel: "TELEGRAM",
          })
          telegramUrl = await buildTelegramVerifyUrl(phoneCode.code)
        }
      }
    } catch (error) {
      // El alta ya se confirmó: una falla de entrega no la echa para atrás.
      console.error("[signup] Error emitiendo verificación:", error)
    }

    return NextResponse.json(
      {
        ok: true,
        slug,
        verification: {
          emailSent,
          telegramUrl,
          // true cuando el alta quedó PENDING hasta verificar un canal.
          required: canVerify,
        },
        urls: {
          home: `/${slug}`,
          market: `/${slug}/market`,
          orderStatus: `/${slug}/order-status`,
          admin: "/admin",
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("[signup] Error en registro de empresa:", error)
    return NextResponse.json(
      { error: "Error al registrar la empresa" },
      { status: 500 }
    )
  }
}
