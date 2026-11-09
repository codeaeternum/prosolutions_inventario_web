import { prisma } from "@/lib/prisma"
import { lowStockProducts } from "@/lib/low-stock"

/**
 * Lista "Alerta de Stock Bajo" del dashboard: los productos bajo mínimo con
 * su primer modelo/marca y categoría para la tarjeta de /admin.
 *
 * Son dos consultas: el raw devuelve ids ya filtrados (stock <= minStock,
 * orden severidad) y el findMany hidrata las relaciones que la UI pinta —
 * el raw no puede devolver el include anidado. El orden de la lista lo fija
 * el resultado raw (el findMany viene sin orden garantizado).
 */
export async function getLowStockList(businessId: string, take = 10) {
  const rows = await lowStockProducts(prisma, businessId, { take })
  if (rows.length === 0) return []
  const products = await prisma.product.findMany({
    where: { businessId, id: { in: rows.map((r) => r.id) } },
    include: {
      models: {
        include: {
          model: { include: { brand: true } },
        },
        take: 1,
      },
      category: true,
    },
  })
  const byId = new Map(products.map((p) => [p.id, p]))
  return rows.flatMap((r) => {
    const p = byId.get(r.id)
    return p ? [p] : []
  })
}
