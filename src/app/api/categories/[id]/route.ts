import { NextResponse } from "next/server"
import { requireModule, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { businessFailure } from "@/lib/domain/http"

type Params = { params: Promise<{ id: string }> }

/**
 * Elimina la categoría solo si está vacía: `Product.category` es
 * onDelete: Cascade — borrarla con productos los eliminaría junto con
 * su historial (movimientos, líneas de venta, refacciones de taller).
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params

    const category = await prisma.category.findFirst({
      where: { id, businessId },
      include: { _count: { select: { products: true } } },
    })
    if (!category) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 })

    if (category._count.products > 0) {
      return NextResponse.json(
        { error: `No puedes eliminar "${category.name}": tiene ${category._count.products} producto(s). Reasígnalos o elimínalos primero.` },
        { status: 409 },
      )
    }

    await prisma.category.delete({ where: { id } })
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "CATEGORY_DELETE",
      entity: "category",
      entityId: id,
      entityName: category.name,
      summary: `Eliminó la categoría "${category.name}"`,
    })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return businessFailure(error)
  }
}
