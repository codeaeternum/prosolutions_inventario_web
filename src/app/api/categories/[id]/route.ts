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
 * Elimina la categoría solo si está vacía: `Product.category` es
 * onDelete: Cascade — borrarla con productos los eliminaría junto con
 * su historial (movimientos, líneas de venta, refacciones de taller).
 *
 * El conteo de dependientes y el delete van dentro de la MISMA transacción
 * serializable: leer `_count` fuera dejaba una ventana TOCTOU en la que un
 * producto recién vinculado caía en cascade silencioso. transaction()
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

    const category = await transaction(prisma, async tx => {
      const found = await tx.category.findFirst({
        where: { id, businessId },
        include: { _count: { select: { products: true } } },
      })
      if (!found) return null
      if (found._count.products > 0) {
        throw new BusinessError(
          `No puedes eliminar "${found.name}": tiene ${found._count.products} producto(s). Reasígnalos o elimínalos primero.`,
          409,
        )
      }
      try {
        await tx.category.delete({ where: { id } })
      } catch (error) {
        // La FK abortó el delete aunque el conteo venía en cero: hay
        // dependientes (re-count bajo aislamiento no los vio aún).
        if (codeOf(error) === "P2003" || codeOf(error) === "P2014") {
          throw new BusinessError(
            `No puedes eliminar "${found.name}": tiene productos vinculados. Reasígnalos o elimínalos primero.`,
            409,
          )
        }
        throw error
      }
      return found
    })
    if (!category) return NextResponse.json({ error: "Categoría no encontrada" }, { status: 404 })

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
