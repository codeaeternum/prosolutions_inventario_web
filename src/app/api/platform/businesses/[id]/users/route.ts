import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { checkAndRecord } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

const createUserSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(120),
  email: z.email("Ingresa un correo electrónico válido"),
  role: z.enum(["ADMIN", "EMPLOYEE", "WORKSHOP"]).default("ADMIN"),
  jobTitle: z.string().trim().max(80).optional(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100),
})

/**
 * POST /api/platform/businesses/[id]/users — Alta directa de un usuario del
 * equipo en un negocio desde la consola de operador (/platform/[id]).
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  // Freno por operador (la sesión ya está autenticada): 15 altas cada 15 min.
  if (!checkAndRecord("platform-user-create", auth.session.user.id, 15 * 60 * 1000, 15)) {
    return NextResponse.json(
      { error: "Demasiadas operaciones, espera un momento" },
      { status: 429, headers: { "Retry-After": "900" } }
    )
  }

  const { id: businessId } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const parsed = createUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    )
  }

  const emailNorm = parsed.data.email.trim().toLowerCase()

  try {
    const [business, existingEmail, branch] = await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, name: true, slug: true },
      }),
      prisma.user.findUnique({ where: { email: emailNorm }, select: { id: true } }),
      prisma.branch.findFirst({
        where: { businessId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
    ])

    if (!business) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }
    if (existingEmail) {
      return NextResponse.json(
        { error: "Ya existe una cuenta registrada con ese correo electrónico." },
        { status: 409 }
      )
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const actor = auth.session.user

    const [user] = await prisma.$transaction([
      prisma.user.create({
        data: {
          businessId: business.id,
          name: parsed.data.name,
          email: emailNorm,
          password: passwordHash,
          role: parsed.data.role,
          status: "APPROVED",
          customerType: "NORMAL",
          jobTitle: parsed.data.jobTitle || null,
          homeBranchId: branch?.id ?? null,
          emailVerifiedAt: new Date(),
        },
        select: { id: true, name: true, email: true, role: true, status: true },
      }),
      prisma.platformEvent.create({
        data: {
          kind: "USER_CREATED_BY_PLATFORM",
          businessId: business.id,
          businessSlug: business.slug,
          businessName: business.name,
          actorId: actor.id,
          actorEmail: actor.email ?? null,
        },
      }),
    ])

    return NextResponse.json({ user }, { status: 201 })
  } catch (error) {
    console.error("[platform] Error creando usuario:", error)
    return NextResponse.json({ error: "Error al crear el usuario" }, { status: 500 })
  }
}
