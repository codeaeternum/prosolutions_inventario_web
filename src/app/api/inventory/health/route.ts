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

/**
 * GET /api/inventory/health — Verifica invariante Product.stock === Σ BranchStock.quantity.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const session = getSession(auth)!
  const businessId = businessIdOf(session)

  try {
    const { totalChecked, drifted } = await computeStockDrift(businessId)
    return NextResponse.json(
      {
        ok: drifted.length === 0,
        totalChecked,
        driftedCount: drifted.length,
        drifted,
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
