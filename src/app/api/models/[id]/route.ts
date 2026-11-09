import { NextResponse } from "next/server"
import { requireModule, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { businessFailure } from "@/lib/domain/http"

type Params = { params: Promise<{ id: string }> }

/**
 * Elimina el modelo solo si ningún producto lo referencia: la relación
 * ProductModel es onDelete: Cascade y borrarlo desvincularía productos
 * del catálogo sin aviso.
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params

    const model = await prisma.model.findFirst({
      where: { id, businessId },
      include: { _count: { select: { products: true } } },
    })
    if (!model) return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 })

    if (model._count.products > 0) {
      return NextResponse.json(
        { error: `No puedes eliminar "${model.name}": ${model._count.products} producto(s) lo tienen asignado. Desvincúlalos primero.` },
        { status: 409 },
      )
    }

    await prisma.model.delete({ where: { id } })
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "MODEL_DELETE",
      entity: "model",
      entityId: id,
      entityName: model.name,
      summary: `Eliminó el modelo "${model.name}"`,
    })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return businessFailure(error)
  }
}
