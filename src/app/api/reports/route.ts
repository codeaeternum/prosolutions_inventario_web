import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { fillDays, fillMonths, lastDayKeys, lastMonthKeys } from "@/lib/chart-utils"
import { BUSINESS_TIME_ZONE, parseBusinessDateParam } from "@/lib/business-time"
import { Prisma } from "@prisma/client"

// Tipo para status de reserva (del schema)
type ReservationStatusType = "PENDING" | "PENDING_PAYMENT" | "DEPOSIT_VERIFIED" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED" | "EXPIRED"

// Los reportes exponen ventas, caja y valuación de inventario: jamás
// servibles desde un caché compartido (misma regla que /api/caja y nómina).
const NO_STORE = { "Cache-Control": "private, no-store" } as const

export async function GET(req: NextRequest) {
  try {
    const result = await requireModule("reportes")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)
    // Reporte por sucursal: el empleado con sucursales asignadas solo ve las
    // métricas de las suyas (ventas, caja, taller, reservas). Catálogo y
    // clientes-altas son por negocio y no se recortan.
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const scopedBranchIds = allowed?.length ? allowed : null
    const branchScope = scopedBranchIds ? { in: scopedBranchIds } : undefined

    const { searchParams } = new URL(req.url)

    // ?series=1 — series de tiempo y rankings para las gráficas del panel.
    // Es una respuesta independiente: no usa los filtros from/to.
    if (searchParams.get("series") === "1") {
      return NextResponse.json(await buildReportSeries(businessId, scopedBranchIds), { headers: NO_STORE })
    }

    // from/to en fecha corta "YYYY-MM-DD" = día completo del negocio
    // (00:00:00.000 / 23:59:59.999 en BUSINESS_TIME_ZONE, no UTC); valores
    // con hora/ISO completo pasan tal cual.
    const from = parseBusinessDateParam(searchParams.get("from"), "start")
    const to = parseBusinessDateParam(searchParams.get("to"), "end")
    // Igual que nómina: un rango invertido es error del cliente, no un
    // reporte vacío silencioso.
    if (from && to && from > to) {
      return NextResponse.json({ error: "Rango inválido: 'from' es posterior a 'to'" }, { status: 400 })
    }

    // Filtros de fecha para reservas
    const dateFilter = {
      ...(from && { gte: from }),
      ...(to && { lte: to }),
    }
    const hasDateFilter = from || to

    // Filtro de reservas compartido por conteos, rankings y recientes.
    const reservationWhere = {
      businessId,
      ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      ...(branchScope ? { branchId: branchScope } : {}),
    }

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
      categories,
      totalModels,
      // Top productos (por reservas del periodo)
      topProductGroups,
      // Top marcas
      topBrandsData,
      // Últimas reservas
      recentReservations,
      // Top clientes (por compras completadas del periodo)
      topClientGroups,
    ] = await Promise.all([
      // Productos — una sola pasada del catálogo activo: de ella salen los
      // agregados de stock Y el desglose de stock bajo por categoría (antes
      // se consultaban los productos dos veces: aquí y anidados por categoría).
      prisma.product.count({ where: { businessId } }),
      prisma.product.count({ where: { businessId, isActive: true } }),
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: { id: true, name: true, categoryId: true, stock: true, minStock: true, wholesalePrice: true },
      }),
      // Usuarios
      prisma.user.count({ where: { businessId, role: "CUSTOMER" } }),
      prisma.user.count({ where: { businessId, role: "CUSTOMER", status: "APPROVED" } }),
      prisma.user.count({ where: { businessId, status: "PENDING" } }),
      // Reservas (con filtro de fecha si aplica; recortadas por sucursal
      // cuando el empleado tiene asignadas)
      prisma.reservation.count({ where: reservationWhere }),
      prisma.reservation.groupBy({
        by: ["status"],
        _count: { status: true },
        where: reservationWhere,
      }),
      // Catálogo
      prisma.brand.count({ where: { businessId } }),
      prisma.category.findMany({
        where: { businessId },
        select: { id: true, name: true },
      }),
      prisma.model.count({ where: { businessId } }),
      // Top productos: el ranking se ordena en BD por el conteo DEL PERIODO.
      // Antes era product.findMany con orderBy reservations._count desc —
      // ese orderBy usa el total SIN el where del _count anidado, así que
      // con filtro de fechas el "top 5" se ordenaba por el histórico y no
      // por el periodo (los números sí eran del periodo: ranking mentiroso).
      prisma.reservation.groupBy({
        by: ["productId"],
        where: { ...reservationWhere, product: { isActive: true } },
        _count: { _all: true },
        orderBy: { _count: { productId: "desc" } },
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
        where: reservationWhere,
        include: {
          user: { select: { name: true } },
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      // Top clientes: mismo defecto de orden que topProducts — el groupBy
      // ordena por las compras COMPLETED del periodo de verdad.
      prisma.reservation.groupBy({
        by: ["userId"],
        where: {
          ...reservationWhere,
          status: "COMPLETED",
          user: { role: "CUSTOMER", status: "APPROVED" },
        },
        _count: { _all: true },
        orderBy: { _count: { userId: "desc" } },
        take: 10,
      }),
    ])

    // Calcular estadísticas de stock
    let totalStock = 0
    // Valuación en centavos: wholesalePrice es Float en pesos — la suma fila
    // a fila en pesos arrastra epsilon binario.
    let totalStockValueCents = 0
    let lowStockProducts = 0
    let outOfStockProducts = 0

    for (const product of allProducts) {
      totalStock += product.stock
      totalStockValueCents += product.stock * Math.round((product.wholesalePrice ?? 0) * 100)
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

    // Segunda tanda: solo los detalles de los grupos ya rankeados en BD
    // (5 productos, 10 clientes, las ligas producto↔marca de las 5 marcas).
    const [topProductRows, topClientRows, brandProductLinks] = await Promise.all([
      prisma.product.findMany({
        where: { businessId, id: { in: topProductGroups.map((g) => g.productId) } },
        select: { id: true, name: true, stock: true },
      }),
      prisma.user.findMany({
        where: { businessId, id: { in: topClientGroups.map((g) => g.userId) } },
        select: { id: true, name: true, email: true, customerType: true },
      }),
      // Conteo de productos por marca en UNA consulta: antes era un
      // product.count por marca (N+1) — las ligas ProductModel→model.brandId
      // llegan de una vez y se agrupan aquí.
      prisma.productModel.findMany({
        where: {
          businessId,
          model: { brandId: { in: topBrandsData.map((b) => b.id) } },
          product: { businessId },
        },
        select: { productId: true, model: { select: { brandId: true } } },
      }),
    ])

    // Top productos: conserva el orden del groupBy (conteo del periodo).
    const productById = new Map(topProductRows.map((p) => [p.id, p]))
    const topProducts = topProductGroups.flatMap((g) => {
      const p = productById.get(g.productId)
      return p ? [{ id: p.id, name: p.name, stock: p.stock, reservationCount: g._count._all }] : []
    })

    // Top marcas: productos distintos por marca (un producto con varios
    // modelos de la misma marca cuenta una vez).
    const productsByBrand = new Map<string, Set<string>>()
    for (const link of brandProductLinks) {
      const set = productsByBrand.get(link.model.brandId) ?? new Set<string>()
      set.add(link.productId)
      productsByBrand.set(link.model.brandId, set)
    }
    const topBrands = topBrandsData
      .map((b) => ({ id: b.id, name: b.name, productCount: productsByBrand.get(b.id)?.size ?? 0 }))
      .sort((a, b) => b.productCount - a.productCount)

    // Top clientes: conserva el orden del groupBy.
    const clientById = new Map(topClientRows.map((u) => [u.id, u]))
    const topClients = topClientGroups.flatMap((g) => {
      const u = clientById.get(g.userId)
      return u ? [{
        id: u.id,
        name: u.name,
        email: u.email,
        customerType: u.customerType,
        completedReservations: g._count._all,
      }] : []
    })

    // Stock bajo por categoría: se reagrupa la pasada de allProducts en vez
    // de volver a traer cada producto anidado por categoría.
    const productsByCategory = new Map<string, typeof allProducts>()
    for (const p of allProducts) {
      const list = productsByCategory.get(p.categoryId)
      if (list) list.push(p)
      else productsByCategory.set(p.categoryId, [p])
    }
    const lowStockByCategory = categories
      .map(cat => {
        const catProducts = productsByCategory.get(cat.id) ?? []
        const lowStockItems = catProducts.filter(p => p.stock <= p.minStock)
        return {
          id: cat.id,
          name: cat.name,
          totalProducts: catProducts.length,
          lowStockCount: lowStockItems.length,
          outOfStockCount: catProducts.filter(p => p.stock === 0).length,
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
      totalStockValue: totalStockValueCents / 100,
      lowStockProducts,
      outOfStockProducts,
      totalUsers,
      activeUsers,
      pendingUsers,
      totalReservations,
      // "Pendientes" = TODA reserva abierta que pide acción, no solo la que
      // llegó: las que esperan comprobante, con depósito verificado y las
      // aprobadas por recoger también son trabajo pendiente (antes el
      // conteo ignoraba PENDING_PAYMENT/DEPOSIT_VERIFIED/APPROVED).
      pendingReservations:
        (statusMap.get("PENDING") || 0) +
        (statusMap.get("PENDING_PAYMENT") || 0) +
        (statusMap.get("DEPOSIT_VERIFIED") || 0) +
        (statusMap.get("APPROVED") || 0),
      completedReservations: statusMap.get("COMPLETED") || 0,
      cancelledReservations: statusMap.get("CANCELLED") || 0,
      expiredReservations: statusMap.get("EXPIRED") || 0,
      totalBrands,
      totalCategories: categories.length,
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

    return NextResponse.json(response, { headers: NO_STORE })
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
// Los buckets de día/mes son del HORARIO DEL NEGOCIO (BUSINESS_TIME_ZONE),
// igual que los filtros from/to: un día del reporte cubre 00:00–23:59 en
// México, así que las claves se derivan con businessDayKey/businessMonthKey
// (no toISOString, que es UTC) y el rango empieza en el día MX actual.
// Los días/meses sin datos se rellenan en cero.
async function buildReportSeries(businessId: string, branchIds?: readonly string[] | null) {
  const now = new Date()
  const days = lastDayKeys(30, now)
  const months = lastMonthKeys(6, now)
  // Inicio real (UTC) del primer día/mes del rango en la zona del negocio.
  const since30 = parseBusinessDateParam(days[0], "start")!
  const since6m = parseBusinessDateParam(`${months[0]}-01`, "start")!
  // Recorte por sucursal: ventas/caja/cobros/órdenes de las asignadas.
  const branchScope = branchIds?.length ? { in: [...branchIds] } : undefined
  // Lista de sucursales para el IN(...) de las consultas raw (misma frontera
  // que branchScope en los groupBy).
  const scoped = branchIds?.length ? [...branchIds] : null

  // Las series se agregan en SQL (un renglón por día/mes en vez de todas las
  // filas de la ventana). El bucket es el día/mes del horario del negocio:
  // createdAt se guarda como timestamp UTC, así que primero se interpreta en
  // UTC (`AT TIME ZONE 'UTC'` → timestamptz) y luego se re-expresa en
  // BUSINESS_TIME_ZONE — mismo criterio que businessDayKey/businessMonthKey
  // de business-time.ts, no el día UTC del servidor.
  const [
    salesByDayRows,
    cashByDayRows,
    repairMoneyRows,
    modelGroups,
    partGroups,
    statusGroups,
    customersByMonthRows,
    customerGroups,
  ] = await Promise.all([
    // Ventas de los últimos 30 días: solo COMPLETED cuenta como ingreso
    // (DRAFT/OPEN son documentos vivos sin comprometer; VOIDED se excluye).
    // Sale.total es el importe de CATÁLOGO; lo cobrado de verdad es
    // total − discountCents (descuento autorizado al cobrar). El centavo se
    // redondea por fila igual que toCents: SUM de valores enteros es exacta.
    prisma.$queryRaw<{ day: string; salesCents: number; count: number }[]>`
      SELECT to_char(("Sale"."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM-DD') AS "day",
             SUM(ROUND("total" * 100) - "discountCents")::float8 AS "salesCents",
             COUNT(*)::int AS "count"
      FROM "Sale"
      WHERE "businessId" = ${businessId}
        AND "status" = 'COMPLETED'
        AND "createdAt" >= ${since30}
        ${scoped ? Prisma.sql`AND "branchId" IN (${Prisma.join(scoped)})` : Prisma.empty}
      GROUP BY 1
    `,
    // Movimientos de caja: IN suma efectivo, OUT lo retira (la caja lleva
    // la sucursal; movimiento sin registro abierto queda fuera del recorte).
    prisma.$queryRaw<{ day: string; inCents: number; outCents: number }[]>`
      SELECT to_char(("CashMovement"."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM-DD') AS "day",
             COALESCE(SUM(CASE WHEN "CashMovement"."type" = 'IN' THEN ROUND("CashMovement"."amount" * 100) END), 0)::float8 AS "inCents",
             COALESCE(SUM(CASE WHEN "CashMovement"."type" <> 'IN' THEN ROUND("CashMovement"."amount" * 100) END), 0)::float8 AS "outCents"
      FROM "CashMovement"
      ${scoped ? Prisma.sql`JOIN "CashRegister" ON "CashRegister"."id" = "CashMovement"."registerId"` : Prisma.empty}
      WHERE "CashMovement"."businessId" = ${businessId}
        AND "CashMovement"."createdAt" >= ${since30}
        ${scoped ? Prisma.sql`AND "CashRegister"."branchId" IN (${Prisma.join(scoped)})` : Prisma.empty}
      GROUP BY 1
    `,
    // Cobros de taller netos: CONFIRMED suma anticipos/abonos/liquidaciones
    // y REFUNDED resta las devoluciones (su amount ya es negativo) — sin las
    // refundidas el reporte inflaba el ingreso. PENDING_REVIEW no es dinero
    // confirmado y VOIDED describe pagos anulados junto con su venta.
    prisma.$queryRaw<{ day: string; paymentsCents: number }[]>`
      SELECT to_char(("Payment"."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM-DD') AS "day",
             SUM(ROUND("Payment"."amount" * 100))::float8 AS "paymentsCents"
      FROM "Payment"
      ${scoped ? Prisma.sql`JOIN "RepairOrder" ON "RepairOrder"."id" = "Payment"."repairOrderId"` : Prisma.empty}
      WHERE "Payment"."businessId" = ${businessId}
        AND "Payment"."repairOrderId" IS NOT NULL
        AND "Payment"."status" IN ('CONFIRMED', 'REFUNDED')
        AND "Payment"."createdAt" >= ${since30}
        ${scoped ? Prisma.sql`AND "RepairOrder"."currentBranchId" IN (${Prisma.join(scoped)})` : Prisma.empty}
      GROUP BY 1
    `,
    // Modelos más reparados (histórico, brand+model concatenados abajo).
    prisma.repairOrder.groupBy({
      by: ["brand", "model"],
      where: { businessId, ...(branchScope ? { currentBranchId: branchScope } : {}) },
      _count: { _all: true },
    }),
    // Refacciones más usadas; solo las autorizadas cuentan como cobradas.
    // groupBy (descripción, precio): la corrida histórica traía UNA fila por
    // pieza instalada — con años de órdenes eran decenas de miles de filas
    // para un top 10; el agregado en BD devuelve un renglón por par
    // descripción+precio. Ingreso = qty × precio de cada variante.
    prisma.repairPart.groupBy({
      by: ["description", "unitPriceCents"],
      where: { businessId, status: "APPROVED", ...(branchScope ? { order: { currentBranchId: branchScope } } : {}) },
      _sum: { qty: true },
    }),
    // Órdenes de reparación agrupadas por estado (histórico).
    prisma.repairOrder.groupBy({
      by: ["status"],
      where: { businessId, ...(branchScope ? { currentBranchId: branchScope } : {}) },
      _count: { _all: true },
    }),
    // Clientes (User rol CUSTOMER) dados de alta en los últimos 6 meses;
    // la lista por sucursal no aplica (las altas son por negocio).
    prisma.$queryRaw<{ month: string; count: number }[]>`
      SELECT to_char(("User"."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIME_ZONE}, 'YYYY-MM') AS "month",
             COUNT(*)::int AS "count"
      FROM "User"
      WHERE "businessId" = ${businessId}
        AND "role" = 'CUSTOMER'
        AND "createdAt" >= ${since6m}
      GROUP BY 1
    `,
    // Clientes del taller con más órdenes (histórico).
    prisma.repairOrder.groupBy({
      by: ["customerName"],
      where: { businessId, ...(branchScope ? { currentBranchId: branchScope } : {}) },
      _count: { _all: true },
      _sum: { approvedQuoteCents: true },
    }),
  ])

  // Las filas ya vienen agregadas por día/mes del negocio desde SQL; fillDays/
  // fillMonths rellenan con cero las claves sin datos y descartan las que caen
  // fuera del rango (mismo contrato que tenía la agregación en memoria).
  const salesByDay = fillDays(
    days,
    salesByDayRows.map((r) => ({ day: r.day, salesCents: Math.round(r.salesCents), count: r.count })),
    { salesCents: 0, count: 0 }
  )

  const cashByDay = fillDays(
    days,
    cashByDayRows.map((r) => ({ day: r.day, inCents: Math.round(r.inCents), outCents: Math.round(r.outCents) })),
    { inCents: 0, outCents: 0 }
  )

  const repairMoney = fillDays(
    days,
    repairMoneyRows.map((r) => ({ day: r.day, paymentsCents: Math.round(r.paymentsCents) })),
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
  // Las variantes de descripción que solo difieren en espacios se fusionan.
  const partAgg = new Map<string, { count: number; revenueCents: number }>()
  for (const p of partGroups) {
    const label = p.description.trim()
    if (!label) continue
    const qty = p._sum.qty ?? 0
    const a = partAgg.get(label) ?? { count: 0, revenueCents: 0 }
    a.count += qty
    a.revenueCents += qty * p.unitPriceCents
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

  // Clientes nuevos por mes del negocio (ya agrupados en SQL).
  const customersByMonth = fillMonths(
    months,
    customersByMonthRows.map((r) => ({ month: r.month, count: r.count })),
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
