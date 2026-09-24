import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { fillDays, fillMonths, lastDayKeys, lastMonthKeys } from "@/lib/chart-utils"
import { parseBusinessDateParam } from "@/lib/business-time"

// Tipo para status de reserva (del schema)
type ReservationStatusType = "PENDING" | "PENDING_PAYMENT" | "DEPOSIT_VERIFIED" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED" | "EXPIRED"

export async function GET(req: NextRequest) {
  try {
    const result = await requireModule("reportes")
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const { searchParams } = new URL(req.url)

    // ?series=1 — series de tiempo y rankings para las gráficas del panel.
    // Es una respuesta independiente: no usa los filtros from/to.
    if (searchParams.get("series") === "1") {
      return NextResponse.json(await buildReportSeries(businessId))
    }

    // from/to en fecha corta "YYYY-MM-DD" = día completo del negocio
    // (00:00:00.000 / 23:59:59.999 en BUSINESS_TIME_ZONE, no UTC); valores
    // con hora/ISO completo pasan tal cual.
    const from = parseBusinessDateParam(searchParams.get("from"), "start")
    const to = parseBusinessDateParam(searchParams.get("to"), "end")

    // Filtros de fecha para reservas
    const dateFilter = {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    }
    const hasDateFilter = from || to

    // Obtener estadísticas en paralelo
    const [
      // Productos
      totalProducts,
      totalActiveProducts,
      allProducts,
      // Usuarios
      totalUsers,
      activeUsers,
      pendingUsers,
      // Reservas
      totalReservations,
      reservationsByStatus,
      // Catálogo
      totalBrands,
      totalCategories,
      totalModels,
      // Top productos (por reservas)
      topProductsData,
      // Top marcas
      topBrandsData,
      // Últimas reservas
      recentReservations,
      // Top clientes
      topClientsData,
      // Stock por categoría
      categoriesWithStock,
    ] = await Promise.all([
      // Productos
      prisma.product.count({ where: { businessId } }),
      prisma.product.count({ where: { businessId, isActive: true } }),
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: { stock: true, minStock: true, wholesalePrice: true },
      }),
      // Usuarios
      prisma.user.count({ where: { businessId, role: "CUSTOMER" } }),
      prisma.user.count({ where: { businessId, role: "CUSTOMER", status: "APPROVED" } }),
      prisma.user.count({ where: { businessId, status: "PENDING" } }),
      // Reservas (con filtro de fecha si aplica)
      prisma.reservation.count({
        where: hasDateFilter ? { businessId, createdAt: dateFilter } : { businessId },
      }),
      prisma.reservation.groupBy({
        by: ["status"],
        _count: { status: true },
        where: hasDateFilter ? { businessId, createdAt: dateFilter } : { businessId },
      }),
      // Catálogo
      prisma.brand.count({ where: { businessId } }),
      prisma.category.count({ where: { businessId } }),
      prisma.model.count({ where: { businessId } }),
      // Top productos
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: {
          id: true,
          name: true,
          stock: true,
          _count: {
            select: {
              reservations: hasDateFilter
                ? { where: { businessId, createdAt: dateFilter } }
                : { where: { businessId } },
            },
          },
        },
        orderBy: {
          reservations: { _count: "desc" },
        },
        take: 5,
      }),
      // Top marcas
      prisma.brand.findMany({
        where: { businessId },
        select: {
          id: true,
          name: true,
          _count: {
            select: { models: true },
          },
        },
        orderBy: {
          models: { _count: "desc" },
        },
        take: 5,
      }),
      // Últimas reservas
      prisma.reservation.findMany({
        where: hasDateFilter ? { businessId, createdAt: dateFilter } : { businessId },
        include: {
          user: { select: { name: true } },
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      // Top clientes
      prisma.user.findMany({
        where: { businessId, role: "CUSTOMER", status: "APPROVED" },
        select: {
          id: true,
          name: true,
          email: true,
          customerType: true,
          _count: {
            select: {
              reservations: hasDateFilter
                ? { where: { businessId, createdAt: dateFilter, status: "COMPLETED" } }
                : { where: { businessId, status: "COMPLETED" } },
            },
          },
        },
        orderBy: {
          reservations: { _count: "desc" },
        },
        take: 10,
      }),
      // Stock bajo por categoría
      prisma.category.findMany({
        where: { businessId },
        select: {
          id: true,
          name: true,
          products: {
            where: { businessId, isActive: true },
            select: {
              id: true,
              name: true,
              stock: true,
              minStock: true,
            },
          },
        },
      }),
    ])

    // Calcular estadísticas de stock
    let totalStock = 0
    let totalStockValue = 0
    let lowStockProducts = 0
    let outOfStockProducts = 0

    for (const product of allProducts) {
      totalStock += product.stock
      totalStockValue += product.stock * (product.wholesalePrice ?? 0)
      if (product.stock <= product.minStock) {
        lowStockProducts++
      }
      if (product.stock === 0) {
        outOfStockProducts++
      }
    }

    // Mapear estados de reservas
    const statusMap = new Map<ReservationStatusType, number>(
      reservationsByStatus.map((s: { status: ReservationStatusType; _count: { status: number } }) => [s.status, s._count.status])
    )

    // Formatear top productos
    const topProducts = topProductsData.map((p: { id: string; name: string; stock: number; _count: { reservations: number } }) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      reservationCount: p._count.reservations,
    }))

    // Formatear top marcas (contamos productos a través de modelos)
    const topBrands: { id: string; name: string; productCount: number }[] = await Promise.all(
      topBrandsData.map(async (b: { id: string; name: string; _count: { models: number } }) => {
        const productCount = await prisma.product.count({
          where: {
            businessId,
            models: {
              some: {
                model: { brandId: b.id },
              },
            },
          },
        })
        return {
          id: b.id,
          name: b.name,
          productCount,
        }
      })
    )

    // Ordenar por cantidad de productos
    topBrands.sort((a: { productCount: number }, b: { productCount: number }) => b.productCount - a.productCount)

    // Formatear top clientes
    type TopClientData = {
      id: string
      name: string
      email: string | null
      customerType: string
      _count: { reservations: number }
    }
    const topClients = (topClientsData as TopClientData[])
      .filter(c => c._count.reservations > 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        customerType: c.customerType,
        completedReservations: c._count.reservations,
      }))

    // Formatear stock bajo por categoría
    type CategoryWithStock = {
      id: string
      name: string
      products: Array<{
        id: string
        name: string
        stock: number
        minStock: number
      }>
    }
    const lowStockByCategory = (categoriesWithStock as CategoryWithStock[])
      .map(cat => {
        const lowStockItems = cat.products.filter(p => p.stock <= p.minStock)
        return {
          id: cat.id,
          name: cat.name,
          totalProducts: cat.products.length,
          lowStockCount: lowStockItems.length,
          outOfStockCount: cat.products.filter(p => p.stock === 0).length,
          products: lowStockItems.slice(0, 5).map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
            minStock: p.minStock,
          })),
        }
      })
      .filter(cat => cat.lowStockCount > 0)
      .sort((a, b) => b.lowStockCount - a.lowStockCount)

    // Tipo para las reservas recientes
    type RecentReservation = {
      id: string
      createdAt: Date
      status: ReservationStatusType
      totalPrice: number
      user: { name: string }
      product: { name: string }
    }

    const response = {
      totalProducts,
      totalActiveProducts,
      totalStock,
      totalStockValue,
      lowStockProducts,
      outOfStockProducts,
      totalUsers,
      activeUsers,
      pendingUsers,
      totalReservations,
      pendingReservations: statusMap.get("PENDING") || 0,
      completedReservations: statusMap.get("COMPLETED") || 0,
      cancelledReservations: statusMap.get("CANCELLED") || 0,
      expiredReservations: statusMap.get("EXPIRED") || 0,
      totalBrands,
      totalCategories,
      totalModels,
      topProducts,
      topBrands,
      topClients,
      lowStockByCategory,
      recentReservations: (recentReservations as RecentReservation[]).map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        status: r.status,
        totalPrice: r.totalPrice,
        user: { name: r.user.name },
        product: { name: r.product.name },
      })),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching reports:", error)
    return NextResponse.json(
      { error: "Error al obtener reportes" },
      { status: 500 }
    )
  }
}

// Series para las gráficas de /admin/reportes. Montos en CENTAVOS:
// Sale.total, CashMovement.amount y Payment.amount son Float en pesos, así
// que se convierten con toCents; los *Cents del taller ya vienen en centavos.
// Los buckets de día/mes son UTC (createdAt.toISOString), igual que
// lastDayKeys/lastMonthKeys; los días/meses sin datos se rellenan en cero.
async function buildReportSeries(businessId: string) {
  const now = new Date()
  const days = lastDayKeys(30, now)
  const months = lastMonthKeys(6, now)
  const since30 = new Date(`${days[0]}T00:00:00.000Z`)
  const since6m = new Date(`${months[0]}-01T00:00:00.000Z`)

  const toCents = (v: number | null | undefined) => Math.round((v ?? 0) * 100)
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const monthKey = (d: Date) => d.toISOString().slice(0, 7)

  const [
    sales,
    movements,
    repairPayments,
    modelGroups,
    parts,
    statusGroups,
    newCustomers,
    customerGroups,
  ] = await Promise.all([
    // Ventas de los últimos 30 días: solo COMPLETED cuenta como ingreso
    // (DRAFT/OPEN son documentos vivos sin comprometer; VOIDED se excluye).
    prisma.sale.findMany({
      where: { businessId, status: "COMPLETED", createdAt: { gte: since30 } },
      select: { createdAt: true, total: true },
    }),
    // Movimientos de caja: IN suma efectivo, OUT lo retira.
    prisma.cashMovement.findMany({
      where: { businessId, createdAt: { gte: since30 } },
      select: { createdAt: true, amount: true, type: true },
    }),
    // Cobros de taller confirmados (anticipos, abonos y liquidaciones).
    prisma.payment.findMany({
      where: {
        businessId,
        repairOrderId: { not: null },
        status: "CONFIRMED",
        createdAt: { gte: since30 },
      },
      select: { createdAt: true, amount: true },
    }),
    // Modelos más reparados (histórico, brand+model concatenados abajo).
    prisma.repairOrder.groupBy({
      by: ["brand", "model"],
      where: { businessId },
      _count: { _all: true },
    }),
    // Refacciones más usadas; solo las autorizadas cuentan como cobradas.
    prisma.repairPart.findMany({
      where: { businessId, status: "APPROVED" },
      select: { description: true, qty: true, unitPriceCents: true },
    }),
    // Órdenes de reparación agrupadas por estado (histórico).
    prisma.repairOrder.groupBy({
      by: ["status"],
      where: { businessId },
      _count: { _all: true },
    }),
    // Clientes (User rol CUSTOMER) dados de alta en los últimos 6 meses.
    prisma.user.findMany({
      where: { businessId, role: "CUSTOMER", createdAt: { gte: since6m } },
      select: { createdAt: true },
    }),
    // Clientes del taller con más órdenes (histórico).
    prisma.repairOrder.groupBy({
      by: ["customerName"],
      where: { businessId },
      _count: { _all: true },
      _sum: { approvedQuoteCents: true },
    }),
  ])

  // Ventas por día
  const salesAgg = new Map<string, { salesCents: number; count: number }>()
  for (const s of sales) {
    const k = dayKey(s.createdAt)
    const a = salesAgg.get(k) ?? { salesCents: 0, count: 0 }
    a.salesCents += toCents(s.total)
    a.count++
    salesAgg.set(k, a)
  }
  const salesByDay = fillDays(
    days,
    [...salesAgg].map(([day, v]) => ({ day, ...v })),
    { salesCents: 0, count: 0 }
  )

  // Ingresos/egresos de caja por día
  const cashAgg = new Map<string, { inCents: number; outCents: number }>()
  for (const m of movements) {
    const k = dayKey(m.createdAt)
    const a = cashAgg.get(k) ?? { inCents: 0, outCents: 0 }
    if (m.type === "IN") a.inCents += toCents(m.amount)
    else a.outCents += toCents(m.amount)
    cashAgg.set(k, a)
  }
  const cashByDay = fillDays(
    days,
    [...cashAgg].map(([day, v]) => ({ day, ...v })),
    { inCents: 0, outCents: 0 }
  )

  // Cobros de taller por día
  const repairAgg = new Map<string, number>()
  for (const p of repairPayments) {
    const k = dayKey(p.createdAt)
    repairAgg.set(k, (repairAgg.get(k) ?? 0) + toCents(p.amount))
  }
  const repairMoney = fillDays(
    days,
    [...repairAgg].map(([day, paymentsCents]) => ({ day, paymentsCents })),
    { paymentsCents: 0 }
  )

  // Top modelos: "Marca Modelo" (se omite lo vacío; se fusionan variantes
  // que terminan en la misma etiqueta, p. ej. espacios extra).
  const modelAgg = new Map<string, number>()
  for (const g of modelGroups) {
    const label = [g.brand, g.model]
      .map((s) => s?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
    if (!label) continue
    modelAgg.set(label, (modelAgg.get(label) ?? 0) + g._count._all)
  }
  const topModels = [...modelAgg]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Top refacciones por piezas usadas; ingreso = qty * precio unitario.
  const partAgg = new Map<string, { count: number; revenueCents: number }>()
  for (const p of parts) {
    const label = p.description.trim()
    if (!label) continue
    const a = partAgg.get(label) ?? { count: 0, revenueCents: 0 }
    a.count += p.qty
    a.revenueCents += p.qty * p.unitPriceCents
    partAgg.set(label, a)
  }
  const topParts = [...partAgg]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count || b.revenueCents - a.revenueCents)
    .slice(0, 10)

  // Órdenes por estado
  const repairsByStatus = statusGroups
    .map((g) => ({ status: g.status, count: g._count._all }))
    .sort((a, b) => b.count - a.count)

  // Clientes nuevos por mes
  const custAgg = new Map<string, number>()
  for (const u of newCustomers) {
    const k = monthKey(u.createdAt)
    custAgg.set(k, (custAgg.get(k) ?? 0) + 1)
  }
  const customersByMonth = fillMonths(
    months,
    [...custAgg].map(([month, count]) => ({ month, count })),
    { count: 0 }
  )

  // Top clientes del taller por número de órdenes.
  // Gasto aproximado: suma de la mano de obra aprobada (approvedQuoteCents);
  // no incluye refacciones, anticipos sueltos ni cargos de diagnóstico.
  const topCustomers = customerGroups
    .map((g) => ({
      label: g.customerName.trim(),
      orders: g._count._all,
      spentCents: g._sum.approvedQuoteCents ?? 0,
    }))
    .filter((c) => c.label !== "")
    .sort((a, b) => b.orders - a.orders || b.spentCents - a.spentCents)
    .slice(0, 10)

  return {
    generatedAt: now.toISOString(),
    salesByDay,
    cashByDay,
    repairMoney,
    topModels,
    topParts,
    repairsByStatus,
    customersByMonth,
    topCustomers,
  }
}
