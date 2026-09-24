import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { diffChanges, recordAudit } from "@/lib/audit"

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
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
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

    // Bitácora: antes→después de los campos del proveedor.
    const changes = diffChanges(
      { nombre: supplier.name, telefono: supplier.phone, correo: supplier.email, notas: supplier.notes, activo: supplier.isActive },
      { nombre: updated.name, telefono: updated.phone, correo: updated.email, notas: updated.notes, activo: updated.isActive },
      ["nombre", "telefono", "correo", "notas", "activo"],
    )
    if (changes) {
      const parts: string[] = []
      if (changes.nombre) parts.push(`Nombre "${supplier.name}" → "${updated.name}"`)
      if (changes.activo) parts.push(updated.isActive ? "Reactivado" : "Desactivado")
      if (changes.telefono) parts.push("Cambió el teléfono")
      if (changes.correo) parts.push("Cambió el correo")
      if (changes.notas) parts.push("Cambió las notas")
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "SUPPLIER_UPDATE",
        entity: "supplier",
        entityId: id,
        entityName: updated.name,
        summary: parts.join(" · ") || "Editó al proveedor",
        changes,
      })
    }
    return NextResponse.json(updated)
  } catch (error) {
    return businessFailure(error)
  }
}

/** Desactiva el proveedor; si nunca tuvo compras se elimina definitivamente. */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params

    const supplier = await prisma.supplier.findFirst({
      where: { id, businessId },
      // Con historial (OCs o pagos generales) no se borra: se desactiva. Sin el
      // conteo de payments el delete reventaba por onDelete: Restrict → 500.
      include: { _count: { select: { purchases: true, payments: true } } },
    })
    if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })

    if (supplier._count.purchases > 0 || supplier._count.payments > 0) {
      const updated = await prisma.supplier.update({ where: { id }, data: { isActive: false } })
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "SUPPLIER_DEACTIVATE",
        entity: "supplier",
        entityId: id,
        entityName: supplier.name,
        summary: `Desactivó al proveedor "${supplier.name}" (conserva historial de compras)`,
        changes: { activo: { before: true, after: false } },
      })
      return NextResponse.json({ deactivated: true, supplier: updated })
    }
    await prisma.supplier.delete({ where: { id } })
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "SUPPLIER_DELETE",
      entity: "supplier",
      entityId: id,
      entityName: supplier.name,
      summary: `Eliminó al proveedor "${supplier.name}"`,
    })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return businessFailure(error)
  }
}
