import { NextRequest, NextResponse } from "next/server"
import { RepairStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { lastDayKeys } from "@/lib/chart-utils"
import { parseBusinessDateParam } from "@/lib/business-time"
import { PRINCIPAL_BRANCH_ID } from "@/lib/domain/operations"

// Comparador de sucursales del panel de reportes: una fila por sucursal
// activa con sus métricas lado a lado.
//
// - Ventas: solo COMPLETED cuenta como ingreso (igual que la serie de
//   /api/reports: DRAFT/OPEN son documentos vivos, VOIDED se excluye).
//   Sale.total viene en pesos.
// - Piezas vendidas: unidades netas de SaleItem (quantity − devueltas) de
//   las ventas COMPLETED del periodo.
// - Mermas: InventoryMovement type OUT sin paymentMethod — la misma
//   definición que el filtro ?type=MERMAS de /api/inventory (las ventas POS
//   también salen como OUT pero llevan paymentMethod). El movimiento no
//   guarda precio para DAMAGED/LOST, así que el costo se estima con
//   Product.costPrice actual (0 cuando el producto no tiene costo).
// - Stock: suma de BranchStock.quantity por sucursal (fuente de verdad por
//   local; Product.stock es solo el total cacheado).
// - Órdenes activas: RepairOrder donde está físicamente el equipo hoy
//   (currentBranchId) con estado no terminal.
//
// ?dias=7|30|90 (default 30) acota ventas, piezas y mermas al periodo; el
// stock y las órdenes activas son estado actual y no se filtran por fecha.
// ?branchId= limita la comparación a una sucursal del negocio.

const DIAS_VALIDOS = new Set([7, 30, 90])

// Estados terminales del taller: la orden ya no ocupa mesa ni caja.
const ESTADOS_TERMINALES: RepairStatus[] = [
  "DELIVERED",
  "CANCELLED",
  "NOT_REPAIRED",
  "NOT_AUTHORIZED",
]

export async function GET(req: NextRequest) {
  try {
    const auth = await requireModule("reportes")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const { searchParams } = new URL(req.url)
    const parsed = parseInt(searchParams.get("dias") || "30")
    const dias = DIAS_VALIDOS.has(parsed) ? parsed : 30
    const branchIdParam = searchParams.get("branchId")
    // El filtro de sucursal se valida contra allowedBranchIds: sin el assert un
    // empleado restringido con reportes comparaba cualquier sucursal.
    const deniedBranch = assertBranchAllowed(session, branchIdParam)
    if (deniedBranch) return deniedBranch

    // Inicio del periodo: 00:00 del día del negocio hace `dias` días (incluye
    // hoy), en la zona del negocio — igual que las series del reporte.
    const days = lastDayKeys(dias)
    const since = parseBusinessDateParam(days[0], "start")!

    const activeBranches = await prisma.branch.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    })

    // Empleado con sucursales asignadas: la comparación se limita a las suyas
    // aunque no pida una sucursal en concreto.
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    let branches = branchIdParam
      ? activeBranches.filter((b) => b.id === branchIdParam)
      : activeBranches
    if (allowed?.length) branches = branches.filter((b) => allowed.includes(b.id))
    const ids = branches.map((b) => b.id)

    // Los movimientos viejos sin branchId cayeron en la principal (misma
    // regla que resolveBranch): se le atribuyen si está en la comparación.
    const principalId =
      (branches.find((b) => b.id === PRINCIPAL_BRANCH_ID) ?? branches[0])?.id ??
      null

    const empty = { generatedAt: new Date().toISOString(), dias, desde: since.toISOString(), branches: [] }
    if (ids.length === 0) return NextResponse.json(empty)

    const [
      salesAgg,
      saleItems,
      mermaRows,
      stockAgg,
      stockProductsAgg,
      ordenesAgg,
    ] = await Promise.all([
      // Ventas cobradas del periodo: total y número de tickets por sucursal.
      prisma.sale.groupBy({
        by: ["branchId"],
        where: {
          businessId,
          status: "COMPLETED",
          createdAt: { gte: since },
          branchId: { in: ids },
        },
        _sum: { total: true },
        _count: { _all: true },
      }),
      // Piezas vendidas (netas de devoluciones) por sucursal de la venta.
      prisma.saleItem.findMany({
        where: {
          businessId,
          sale: {
            status: "COMPLETED",
            createdAt: { gte: since },
            branchId: { in: ids },
          },
        },
        select: {
          quantity: true,
          returnedQuantity: true,
          sale: { select: { branchId: true } },
        },
      }),
      // Mermas del periodo (salidas que no son venta) con costo del producto.
      prisma.inventoryMovement.findMany({
        where: {
          businessId,
          type: "OUT",
          paymentMethod: null,
          createdAt: { gte: since },
        },
        select: {
          branchId: true,
          quantity: true,
          product: { select: { costPrice: true } },
        },
      }),
      // Existencias actuales por sucursal.
      prisma.branchStock.groupBy({
        by: ["branchId"],
        where: { businessId, branchId: { in: ids } },
        _sum: { quantity: true },
      }),
      // Productos distintos con existencias (>0) por sucursal.
      prisma.branchStock.groupBy({
        by: ["branchId"],
        where: { businessId, branchId: { in: ids }, quantity: { gt: 0 } },
        _count: { _all: true },
      }),
      // Órdenes de taller no terminales según la sucursal donde está el equipo.
      prisma.repairOrder.groupBy({
        by: ["currentBranchId"],
        where: {
          businessId,
          currentBranchId: { in: ids },
          status: { notIn: ESTADOS_TERMINALES },
        },
        _count: { _all: true },
      }),
    ])

    const ventasPorBranch = new Map(
      salesAgg.map((s) => [
        s.branchId,
        { total: s._sum.total ?? 0, count: s._count._all },
      ])
    )

    const piezasPorBranch = new Map<string, number>()
    for (const item of saleItems) {
      const branchId = item.sale.branchId
      piezasPorBranch.set(
        branchId,
        (piezasPorBranch.get(branchId) ?? 0) +
          Math.max(0, item.quantity - item.returnedQuantity)
      )
    }

    const mermasPorBranch = new Map<string, { piezas: number; costo: number }>()
    for (const m of mermaRows) {
      const branchId = m.branchId ?? principalId
      if (!branchId || !ids.includes(branchId)) continue
      const agg = mermasPorBranch.get(branchId) ?? { piezas: 0, costo: 0 }
      agg.piezas += m.quantity
      agg.costo += m.quantity * (m.product.costPrice ?? 0)
      mermasPorBranch.set(branchId, agg)
    }

    const stockPorBranch = new Map(
      stockAgg.map((s) => [s.branchId, s._sum.quantity ?? 0])
    )
    const productosPorBranch = new Map(
      stockProductsAgg.map((s) => [s.branchId, s._count._all])
    )
    const ordenesPorBranch = new Map(
      ordenesAgg.map((o) => [o.currentBranchId, o._count._all])
    )

    const round2 = (v: number) => Math.round(v * 100) / 100

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      dias,
      desde: since.toISOString(),
      branches: branches.map((b) => {
        const ventas = ventasPorBranch.get(b.id) ?? { total: 0, count: 0 }
        const mermas = mermasPorBranch.get(b.id) ?? { piezas: 0, costo: 0 }
        return {
          id: b.id,
          name: b.name,
          ventas: round2(ventas.total),
          ventasCount: ventas.count,
          ticketPromedio: ventas.count > 0 ? round2(ventas.total / ventas.count) : 0,
          piezasVendidas: piezasPorBranch.get(b.id) ?? 0,
          mermas: mermas.piezas,
          mermasCosto: round2(mermas.costo),
          stockPiezas: stockPorBranch.get(b.id) ?? 0,
          productosConStock: productosPorBranch.get(b.id) ?? 0,
          ordenesActivas: ordenesPorBranch.get(b.id) ?? 0,
        }
      }),
    })
  } catch (error) {
    return businessFailure(error)
  }
}
