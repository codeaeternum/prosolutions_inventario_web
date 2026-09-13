import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.literal(""), z.email("Correo inválido").max(200)]).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  isActive: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)
    const { id } = await params

    const parsed = updateSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })

    const supplier = await prisma.supplier.findFirst({ where: { id, businessId } })
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })

    const { name, phone, email, notes, isActive } = parsed.data
    if (name && name !== supplier.name) {
      const dup = await prisma.supplier.findFirst({ where: { businessId, name, id: { not: id } } })
      if (dup) return NextResponse.json({ error: "Ya existe un proveedor con ese nombre" }, { status: 400 })
    }

    const updated = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
        ...(email !== undefined ? { email: email || null } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      include: { _count: { select: { purchases: true } } },
    })
    return NextResponse.json(updated)
  } catch (error) {
    return businessFailure(error)
  }
}

/** Desactiva el proveedor; si nunca tuvo compras se elimina definitivamente. */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)
    const { id } = await params

    const supplier = await prisma.supplier.findFirst({
      where: { id, businessId },
      include: { _count: { select: { purchases: true } } },
    })
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })

    if (supplier._count.purchases > 0) {
      const updated = await prisma.supplier.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json({ deactivated: true, supplier: updated })
    }
    await prisma.supplier.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return businessFailure(error)
  }
}
