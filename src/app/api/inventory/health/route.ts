import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"

export interface StockDriftRow {
  productId: string
  name: string
  cachedStock: number
  branchesStock: number
  diff: number
}

async function computeStockDrift(businessId: string): Promise<{ totalChecked: number; drifted: StockDriftRow[] }> {
  // El desfase se compara en BD (stock vs Σ BranchStock): el INNER JOIN
  // replica la regla "solo productos con al menos una fila en BranchStock"
  // —los legacy sin fila no se marcan— y el HAVING deja solo los que
  // difieren, en vez de materializar el catálogo activo completo.
  const [driftRows, totalChecked] = await Promise.all([
    prisma.$queryRaw<Omit<StockDriftRow, "diff">[]>`
      SELECT p."id" AS "productId", p."name" AS "name", p."stock" AS "cachedStock",
             COALESCE(SUM(bs."quantity"), 0)::int AS "branchesStock"
      FROM "Product" p
      JOIN "BranchStock" bs ON bs."productId" = p."id" AND bs."businessId" = p."businessId"
      WHERE p."businessId" = ${businessId} AND p."isActive" = true
      GROUP BY p."id", p."name", p."stock"
      HAVING COALESCE(SUM(bs."quantity"), 0) <> p."stock"
      ORDER BY p."name" ASC
    `,
    prisma.product.count({ where: { businessId, isActive: true } }),
  ])

  const drifted = driftRows.map((r) => ({ ...r, diff: r.branchesStock - r.cachedStock }))
  return { totalChecked, drifted }
}

export interface ChargedWithoutStockRow {
  partId: string
  orderId: string
  orderNumber: number
  orderStatus: string
  description: string
  qty: number
  deducted: number
  missing: number
}

const CHARGED_PARTS_LIMIT = 100

/**
 * Refacciones COBRADAS (RepairPart APPROVED con producto del catálogo) cuyo
 * descuento neto de inventario quedó por debajo de la cantidad cobrada:
 * syncPartStock (domain/workshop) descuenta min(qty, disponible) y cobra
 * igual — intencional cuando la pieza se montó antes de catalogarse, pero
 * sin esta conciliación el faltante era invisible. El descuento aplicado se
 * reconstruye igual que el RETURN de syncPartStock: Σ OUT − Σ RETURN de los
 * movimientos cuyo notes ancla al patrón "Refacción OT <partId> ·".
 * COUNT(*) OVER () da el total real aunque la lista venga acotada.
 */
async function computeChargedWithoutStock(businessId: string): Promise<{ count: number; parts: ChargedWithoutStockRow[] }> {
  const rows = await prisma.$queryRaw<(Omit<ChargedWithoutStockRow, "missing"> & { totalCount: number })[]>`
    SELECT rp."id" AS "partId", rp."orderId", rp."description", rp."qty",
           ro."number" AS "orderNumber", ro."status" AS "orderStatus",
           COALESCE(SUM(CASE WHEN im."type" = 'OUT' THEN im."quantity" WHEN im."type" = 'RETURN' THEN -im."quantity" END), 0)::int AS "deducted",
           COUNT(*) OVER ()::int AS "totalCount"
    FROM "RepairPart" rp
    JOIN "RepairOrder" ro ON ro."id" = rp."orderId"
    LEFT JOIN "InventoryMovement" im
      ON im."businessId" = rp."businessId"
      AND im."type" IN ('OUT', 'RETURN')
      AND im."notes" LIKE 'Refacción OT ' || rp."id" || ' ·%'
    WHERE rp."businessId" = ${businessId}
      AND rp."status" = 'APPROVED'
      AND rp."productId" IS NOT NULL
    GROUP BY rp."id", rp."orderId", rp."description", rp."qty", ro."number", ro."status"
    HAVING COALESCE(SUM(CASE WHEN im."type" = 'OUT' THEN im."quantity" WHEN im."type" = 'RETURN' THEN -im."quantity" END), 0) < rp."qty"
    ORDER BY ro."number" DESC
    LIMIT ${CHARGED_PARTS_LIMIT}
  `
  return {
    count: rows[0]?.totalCount ?? 0,
    parts: rows.map((row) => ({
      partId: row.partId, orderId: row.orderId, orderNumber: row.orderNumber,
      orderStatus: row.orderStatus, description: row.description,
      qty: row.qty, deducted: row.deducted, missing: row.qty - row.deducted,
    })),
  }
}

/**
 * GET /api/inventory/health — Verifica invariante Product.stock === Σ BranchStock.quantity
 * y reporta refacciones cobradas sin stock descontado (chargedWithoutStock).
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const session = getSession(auth)!
  const businessId = businessIdOf(session)

  try {
    const [{ totalChecked, drifted }, chargedWithoutStock] = await Promise.all([
      computeStockDrift(businessId),
      computeChargedWithoutStock(businessId),
    ])
    return NextResponse.json(
      {
        ok: drifted.length === 0,
        totalChecked,
        driftedCount: drifted.length,
        drifted,
        chargedWithoutStock,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[inventory/health] Error:", error)
    return NextResponse.json({ error: "Error al verificar salud de inventario" }, { status: 500 })
  }
}

/**
 * POST /api/inventory/health — Reconcilia Product.stock al Σ BranchStock.quantity real.
 */
export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const session = getSession(auth)!
  const businessId = businessIdOf(session)

  try {
    const { drifted } = await computeStockDrift(businessId)
    if (drifted.length === 0) {
      return NextResponse.json({ ok: true, reconciledCount: 0, reconciled: [] })
    }

    await prisma.$transaction(
      drifted.map((row) =>
        prisma.product.update({
          where: { id: row.productId },
          data: { stock: row.branchesStock },
        })
      )
    )

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "STOCK_RECONCILE",
      entity: "product",
      entityId: businessId,
      entityName: `${drifted.length} producto(s)`,
      summary: `Reconciliación de stock total contra sucursales en ${drifted.length} producto(s)`,
      changes: Object.fromEntries(
        drifted.slice(0, 20).map((r) => [r.name, { before: r.cachedStock, after: r.branchesStock }])
      ),
    })

    return NextResponse.json({
      ok: true,
      reconciledCount: drifted.length,
      reconciled: drifted,
    })
  } catch (error) {
    console.error("[inventory/health] Error reconciliando:", error)
    return NextResponse.json({ error: "Error al reconciliar existencias" }, { status: 500 })
  }
}
