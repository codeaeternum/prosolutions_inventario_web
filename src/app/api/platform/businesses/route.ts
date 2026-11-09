import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { listPlatformBusinesses } from "@/lib/platform"
import { checkAndRecord } from "@/lib/rate-limit"
import { isValidSlug, normalizeSlug } from "@/lib/slug-rules"
import { generateSlug, normalizePhone } from "@/lib/utils"
import { SUGGESTED_SERVICES } from "@/lib/workshop-service-suggestions"

const createBusinessSchema = z.object({
  businessName: z.string().trim().min(2, "El nombre del negocio debe tener al menos 2 caracteres").max(80),
  slug: z.string().max(80).nullish(),
  businessKind: z.enum(["FULL", "REPAIR", "PARTNER", "PARTS"]).default("FULL"),
  adminName: z.string().trim().min(1, "El nombre del administrador es requerido").max(80),
  email: z.email("Ingresa un correo electrónico válido"),
  phone: z.string().max(30).nullish(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100),
})

/**
 * GET /api/platform/businesses — Consola Reficio (solo superadmin).
 *
 * Lista TODAS las empresas de la instancia con conteos de sus recursos
 * (usuarios, productos, órdenes, ventas, sucursales), ventas acumuladas
 * (suma de Sale.total en ventas COMPLETED) y última actividad operativa.
 * Sin datos sensibles: no incluye correos ni teléfonos de usuarios.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const businesses = await listPlatformBusinesses()

    return NextResponse.json(
      { businesses },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[platform] Error listando empresas:", error)
    return NextResponse.json(
      { error: "Error al listar las empresas" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/platform/businesses — Alta directa de un negocio desde la consola
 * de operador (/platform), activa incluso cuando el registro público está cerrado.
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  // Freno por operador (la sesión ya está autenticada): 15 altas cada 15 min.
  if (!checkAndRecord("platform-business-create", auth.session.user.id, 15 * 60 * 1000, 15)) {
    return NextResponse.json(
      { error: "Demasiadas operaciones, espera un momento" },
      { status: 429, headers: { "Retry-After": "900" } }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const parsed = createBusinessSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    )
  }

  const { businessName, slug: rawSlug, businessKind, adminName, email, phone, password } = parsed.data
  const emailNorm = email.trim().toLowerCase()
  const phoneOrNull = normalizePhone(phone) || null

  const requestedSlug = normalizeSlug(typeof rawSlug === "string" ? rawSlug : "")
  const baseSlug = requestedSlug || normalizeSlug(generateSlug(businessName)).slice(0, 46).replace(/-+$/, "") || "negocio"
  if (!isValidSlug(baseSlug)) {
    return NextResponse.json(
      { error: "Slug inválido o reservado: usa minúsculas, números y guiones internos" },
      { status: 400 }
    )
  }

  try {
    const [existingSlug, existingEmail] = await Promise.all([
      prisma.business.findUnique({ where: { slug: baseSlug }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: emailNorm }, select: { id: true } }),
    ])
    if (existingSlug) {
      return NextResponse.json({ error: "Ese slug ya está en uso por otro negocio." }, { status: 409 })
    }
    if (existingEmail) {
      return NextResponse.json({ error: "Ya existe un usuario con ese correo electrónico." }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const actor = auth.session.user

    const created = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: businessName,
          slug: baseSlug,
          phone: phoneOrNull,
          isActive: true,
          businessKind,
        },
        select: { id: true, name: true, slug: true },
      })
      const branch = await tx.branch.create({
        data: { businessId: business.id, name: "Principal", isActive: true },
        select: { id: true },
      })
      await tx.user.create({
        data: {
          businessId: business.id,
          name: adminName,
          email: emailNorm,
          phone: phoneOrNull,
          password: hashedPassword,
          role: "ADMIN",
          status: "APPROVED",
          homeBranchId: branch.id,
          emailVerifiedAt: new Date(),
        },
      })
      await tx.systemSettings.create({
        data: {
          businessId: business.id,
          key: "ticket_business_name",
          value: businessName,
        },
      })
      await tx.workshopService.createMany({
        data: SUGGESTED_SERVICES.map((s) => ({
          businessId: business.id,
          name: s.name,
          equipmentType: s.equipmentType,
          priceCents: null,
          isActive: true,
        })),
      })
      await tx.platformEvent.create({
        data: {
          kind: "TENANT_CREATED",
          businessId: business.id,
          businessSlug: business.slug,
          businessName: business.name,
          actorId: actor.id,
          actorEmail: actor.email ?? null,
          detail: { adminEmail: emailNorm, businessKind },
        },
      })
      return business
    })

    return NextResponse.json({ business: created }, { status: 201 })
  } catch (error) {
    console.error("[platform] Error creando empresa:", error)
    return NextResponse.json({ error: "Error al crear el negocio" }, { status: 500 })
  }
}
