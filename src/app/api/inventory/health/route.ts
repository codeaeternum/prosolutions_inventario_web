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
  const [products, branchSums] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, isActive: true },
      select: { id: true, name: true, stock: true },
    }),
    prisma.branchStock.groupBy({
      by: ["productId"],
      where: { businessId },
      _sum: { quantity: true },
    }),
  ])

  const sumByProduct = new Map<string, number>()
  for (const row of branchSums) {
    sumByProduct.set(row.productId, row._sum.quantity ?? 0)
  }

  // Solo evaluamos productos que ya tienen al menos una fila en BranchStock,
  // para no marcar como "desfase" productos legacy previos a multi-sucursal
  // que nunca han tenido fila en BranchStock.
  const drifted: StockDriftRow[] = []
  for (const product of products) {
    if (!sumByProduct.has(product.id)) continue
    const branchesStock = sumByProduct.get(product.id) ?? 0
    if (product.stock !== branchesStock) {
      drifted.push({
        productId: product.id,
        name: product.name,
        cachedStock: product.stock,
        branchesStock,
        diff: branchesStock - product.stock,
      })
    }
  }

  return { totalChecked: products.length, drifted }
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
