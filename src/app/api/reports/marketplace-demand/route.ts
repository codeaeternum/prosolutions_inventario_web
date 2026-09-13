import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"

// Reporte de demanda del marketplace B2B: qué refacciones piden los talleres
// aliados. La "demanda" = solicitudes NO rechazadas (PENDING/APPROVED/FULFILLED);
// las REJECTED solo se muestran en el desglose por taller.
//
// El taller se identifica por `tallerName` (normalizado), no por requestedById:
// el staff también registra solicitudes a mano a nombre de un taller, así que
// requestedById no siempre es la cuenta del taller.

const normalizeTaller = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ")

// Lunes 00:00 (hora local del servidor) de la semana a la que pertenece `d`.
const startOfWeek = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() // 0 = domingo
  const diff = (day + 6) % 7 // días transcurridos desde el lunes
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - diff)
  return date
}

export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const requests = await prisma.marketplaceRequest.findMany({
      where: { businessId },
      select: {
        productId: true,
        qty: true,
        status: true,
        tallerName: true,
        createdAt: true,
        sale: { select: { total: true } },
      },
    })

    const productIds = [...new Set(requests.map((r) => r.productId))]
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, businessId },
      select: {
        id: true,
        name: true,
        stock: true,
        minStock: true,
        wholesalePrice: true,
        category: { select: { name: true } },
      },
    })
    const productMap = new Map(products.map((p) => [p.id, p]))

    // Acumuladores
    type ProductAgg = {
      totalQty: number
      requestCount: number
      talleres: Set<string>
    }
    type TallerAgg = {
      tallerName: string
      requestCount: number
      totalQty: number
      pending: number
      approved: number
      rejected: number
      fulfilled: number
      estimatedTotal: number
      purchasesCount: number
      purchasesTotal: number
    }
    const byProduct = new Map<string, ProductAgg>()
    const byTaller = new Map<string, TallerAgg>()
    const talleres = new Set<string>()
    const summary = {
      totalRequests: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      fulfilled: 0,
    }

    // Tendencia: últimas 8 semanas calendario (lunes-domingo), incluida la actual.
    const weekBuckets = new Map<
      string,
      { weekStart: Date; requests: number; qty: number }
    >()
    const currentWeekStart = startOfWeek(new Date())
    for (let i = 7; i >= 0; i--) {
      const ws = new Date(currentWeekStart)
      ws.setDate(ws.getDate() - i * 7)
      weekBuckets.set(ws.toISOString().slice(0, 10), {
        weekStart: ws,
        requests: 0,
        qty: 0,
      })
    }

    for (const r of requests) {
      summary.totalRequests++
      const tallerKey = normalizeTaller(r.tallerName)
      talleres.add(tallerKey)
      const product = productMap.get(r.productId)

      if (r.status === "PENDING") summary.pending++
      else if (r.status === "APPROVED") summary.approved++
      else if (r.status === "REJECTED") summary.rejected++
      else if (r.status === "FULFILLED") summary.fulfilled++

      // Por taller: cuenta TODOS los estados.
      let t = byTaller.get(tallerKey)
      if (!t) {
        t = {
          tallerName: r.tallerName.trim(),
          requestCount: 0,
          totalQty: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          fulfilled: 0,
          estimatedTotal: 0,
          purchasesCount: 0,
          purchasesTotal: 0,
        }
        byTaller.set(tallerKey, t)
      }
      t.requestCount++
      t.totalQty += r.qty
      if (r.status === "PENDING") t.pending++
      else if (r.status === "APPROVED") t.approved++
      else if (r.status === "REJECTED") t.rejected++
      else if (r.status === "FULFILLED") t.fulfilled++

      // Compras surtidas: solicitud FULFILLED con su venta ligada.
      if (r.status === "FULFILLED" && r.sale) {
        t.purchasesCount++
        t.purchasesTotal += r.sale.total
      }

      // Demanda (sin rechazadas): por producto, valor estimado y tendencia.
      if (r.status !== "REJECTED") {
        if (product) t.estimatedTotal += r.qty * product.wholesalePrice

        let pa = byProduct.get(r.productId)
        if (!pa) {
          pa = { totalQty: 0, requestCount: 0, talleres: new Set() }
          byProduct.set(r.productId, pa)
        }
        pa.totalQty += r.qty
        pa.requestCount++
        pa.talleres.add(tallerKey)

        const weekKey = startOfWeek(r.createdAt).toISOString().slice(0, 10)
        const bucket = weekBuckets.get(weekKey)
        if (bucket) {
          bucket.requests++
          bucket.qty += r.qty
        }
      }
    }

    // Top refacciones: más pedidas primero.
    const topProducts = [...byProduct.entries()]
      .map(([productId, agg]) => {
        const p = productMap.get(productId)
        const stock = p?.stock ?? 0
        return {
          productId,
          name: p?.name ?? "Producto no disponible",
          category: p?.category.name ?? null,
          stock,
          minStock: p?.minStock ?? 0,
          wholesalePrice: p?.wholesalePrice ?? null,
          totalQty: agg.totalQty,
          requestCount: agg.requestCount,
          tallerCount: agg.talleres.size,
          // Demanda insatisfecha: piezas pedidas por encima del stock actual.
          unmetQty: Math.max(0, agg.totalQty - stock),
          estimatedValue: p ? agg.totalQty * p.wholesalePrice : null,
        }
      })
      .sort((a, b) => b.totalQty - a.totalQty || b.requestCount - a.requestCount)

    const tallerList = [...byTaller.values()].sort(
      (a, b) => b.totalQty - a.totalQty || b.requestCount - a.requestCount
    )

    const weekly = [...weekBuckets.values()].map((w) => ({
      weekStart: w.weekStart.toISOString().slice(0, 10),
      requests: w.requests,
      qty: w.qty,
    }))

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary: {
        ...summary,
        distinctTalleres: talleres.size,
        unmetProducts: topProducts.filter((p) => p.unmetQty > 0).length,
        unmetQty: topProducts.reduce((s, p) => s + p.unmetQty, 0),
      },
      topProducts,
      byTaller: tallerList,
      weekly,
    })
  } catch (error) {
    console.error("Error fetching marketplace demand report:", error)
    return NextResponse.json(
      { error: "Error al obtener el reporte de demanda" },
      { status: 500 }
    )
  }
}
