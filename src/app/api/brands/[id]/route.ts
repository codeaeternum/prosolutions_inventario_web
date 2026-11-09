import { NextResponse } from "next/server"
import { requireModule, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { businessFailure } from "@/lib/domain/http"

type Params = { params: Promise<{ id: string }> }

/**
 * Elimina la marca solo si no tiene modelos: `Model.brand` es
 * onDelete: Cascade y borrarla arrastraría sus modelos (y con ellos las
 * vinculaciones ProductModel del catálogo) sin aviso.
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params

    const brand = await prisma.brand.findFirst({
      where: { id, businessId },
      include: { _count: { select: { models: true } } },
    })
    if (!brand) return NextResponse.json({ error: "Marca no encontrada" }, { status: 404 })

    if (brand._count.models > 0) {
      return NextResponse.json(
        { error: `No puedes eliminar "${brand.name}": tiene ${brand._count.models} modelo(s). Elimínalos primero.` },
        { status: 409 },
      )
    }

    await prisma.brand.delete({ where: { id } })
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "BRAND_DELETE",
      entity: "brand",
      entityId: id,
      entityName: brand.name,
      summary: `Eliminó la marca "${brand.name}"`,
    })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    return businessFailure(error)
  }
}
