import { NextResponse } from "next/server"
import { requireModule, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, transaction } from "@/lib/domain/operations"

type Params = { params: Promise<{ id: string }> }

/** P2003/P2014: violación de FK restrict en el delete (defensa en
 *  profundidad — hoy las dependencias son Cascade, mañana pueden no serlo). */
const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error ? String(error.code) : ""

/**
 * Elimina la marca solo si no tiene modelos: `Model.brand` es
 * onDelete: Cascade y borrarla arrastraría sus modelos (y con ellos las
 * vinculaciones ProductModel del catálogo) sin aviso.
 *
 * El conteo de dependientes y el delete van dentro de la MISMA transacción
 * serializable: leer `_count` fuera dejaba una ventana TOCTOU en la que un
 * modelo recién vinculado caía en cascade silencioso. transaction()
 * reintenta los choques de serialización (P2034/40001) y el reintento vuelve
 * a contar — el resultado es un 409 con motivo, nunca un 500 ni un cascade.
 */
export async function DELETE(_req: Request, { params }: Params) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params

    const brand = await transaction(prisma, async tx => {
      const found = await tx.brand.findFirst({
        where: { id, businessId },
        include: { _count: { select: { models: true } } },
      })
      if (!found) return null
      if (found._count.models > 0) {
        throw new BusinessError(
          `No puedes eliminar "${found.name}": tiene ${found._count.models} modelo(s). Elimínalos primero.`,
          409,
        )
      }
      try {
        await tx.brand.delete({ where: { id } })
      } catch (error) {
        // La FK abortó el delete aunque el conteo venía en cero: hay
        // dependientes (re-count bajo aislamiento no los vio aún).
        if (codeOf(error) === "P2003" || codeOf(error) === "P2014") {
          throw new BusinessError(
            `No puedes eliminar "${found.name}": tiene modelos vinculados. Elimínalos primero.`,
            409,
          )
        }
        throw error
      }
      return found
    })
    if (!brand) return NextResponse.json({ error: "Marca no encontrada" }, { status: 404 })

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
