import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getPlatformBusinessDetail } from "@/lib/platform"

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  isActive: z.boolean(),
})

/**
 * GET /api/platform/businesses/[id] — Consola Reficio (solo superadmin).
 *
 * Detalle operativo de una empresa: datos, conteos, métricas, últimas 5
 * órdenes/ventas y el equipo de usuarios (sin contraseñas).
 */
export async function GET(_req: Request, { params }: Params) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  const { id } = await params
  try {
    const business = await getPlatformBusinessDetail(id)
    if (!business) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }
    return NextResponse.json(
      { business },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[platform] Error consultando empresa:", error)
    return NextResponse.json(
      { error: "Error al consultar la empresa" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/platform/businesses/[id] — body { isActive: boolean }.
 *
 * Suspender (isActive=false) no borra nada: la vitrina pública del slug deja
 * de resolver (resolvePublicSlug exige isActive) y el login de sus usuarios
 * queda bloqueado — las sesiones vivas se revocan en el callback jwt, que
 * verifica business.isActive en cada request. Reactivar lo revierte todo.
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
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
  }

  try {
    const existing = await prisma.business.findUnique({ where: { id }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: "Empresa no encontrada" }, { status: 404 })
    }

    const business = await prisma.business.update({
      where: { id },
      data: { isActive: parsed.data.isActive },
      select: { id: true, name: true, slug: true, isActive: true, updatedAt: true },
    })

    return NextResponse.json({ business })
  } catch (error) {
    console.error("[platform] Error actualizando empresa:", error)
    return NextResponse.json(
      { error: "Error al actualizar la empresa" },
      { status: 500 }
    )
  }
}
