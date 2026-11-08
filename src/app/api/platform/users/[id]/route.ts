import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  isSuperAdmin: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().nullable().optional(),
  status: z.enum(["APPROVED", "PENDING", "REJECTED"]).optional(),
  newPassword: z.string().min(8).max(100).optional(),
}).refine(
  data =>
    data.isSuperAdmin !== undefined ||
    data.name !== undefined ||
    data.email !== undefined ||
    data.status !== undefined ||
    data.newPassword !== undefined,
  { message: "Sin cambios por aplicar" }
)

/**
 * PATCH /api/platform/users/[id]
 *
 * Permite al operador de plataforma:
 * 1) Otorgar o revocar `isSuperAdmin` (con protección anti-lockout).
 * 2) Editar nombre, correo, estado o restablecer la contraseña de un usuario
 *    cuando el dueño de un negocio solicita soporte.
 */
export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos" },
      { status: 400 }
    )
  }

  if (id === auth.session.user.id && parsed.data.isSuperAdmin === false) {
    return NextResponse.json(
      { error: "No puedes quitarte el permiso de superadmin a ti mismo." },
      { status: 400 }
    )
  }
  if (id === auth.session.user.id && parsed.data.status && parsed.data.status !== "APPROVED") {
    return NextResponse.json(
      { error: "No puedes desactivar tu propia cuenta de operador." },
      { status: 400 }
    )
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id },
      include: {
        business: {
          select: { id: true, name: true, slug: true },
        },
      },
    })
    if (!target) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    // El permiso de operador solo tiene sentido en cuentas de staff: la UI
    // ni siquiera lo ofrece en otras filas, pero el endpoint debe validarlo
    // igual — un CUSTOMER con isSuperAdmin entraría a la consola completa.
    if (parsed.data.isSuperAdmin !== undefined && !["ADMIN", "EMPLOYEE"].includes(target.role)) {
      return NextResponse.json(
        { error: "El permiso de operador solo aplica a cuentas de administrador o empleado." },
        { status: 400 }
      )
    }

    const passwordHash = parsed.data.newPassword
      ? await bcrypt.hash(parsed.data.newPassword, 12)
      : undefined

    const updateData = {
      ...(parsed.data.isSuperAdmin !== undefined ? { isSuperAdmin: parsed.data.isSuperAdmin } : {}),
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.email !== undefined ? { email: parsed.data.email ? parsed.data.email.trim().toLowerCase() : null } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(passwordHash !== undefined ? { password: passwordHash } : {}),
    }

    const eventKind =
      parsed.data.isSuperAdmin !== undefined &&
      parsed.data.name === undefined &&
      parsed.data.email === undefined &&
      parsed.data.status === undefined &&
      parsed.data.newPassword === undefined
        ? (parsed.data.isSuperAdmin ? "SUPERADMIN_GRANTED" : "SUPERADMIN_REVOKED")
        : "USER_CREDENTIALS_UPDATED"

    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: updateData,
        select: { id: true, name: true, email: true, isSuperAdmin: true },
      }),
      prisma.platformEvent.create({
        data: {
          kind: eventKind,
          businessId: target.business.id,
          businessSlug: target.business.slug,
          businessName: target.business.name,
          actorId: auth.session.user.id,
          actorEmail: auth.session.user.email ?? null,
          // A quién se le aplicó el cambio: sin esto un reset de contraseña
          // o un grant de superadmin no identifican a la cuenta afectada.
          detail: { targetUserId: target.id, targetUserName: target.name, targetUserEmail: target.email },
        },
      }),
    ])

    return NextResponse.json({ user })
  } catch (error) {
    const isUnique =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "P2002"
    if (isUnique) {
      return NextResponse.json(
        { error: "Ese correo electrónico ya está registrado en otra cuenta." },
        { status: 409 }
      )
    }
    console.error("[platform] Error actualizando usuario:", error)
    return NextResponse.json(
      { error: "Error al actualizar la cuenta del usuario" },
      { status: 500 }
    )
  }
}
