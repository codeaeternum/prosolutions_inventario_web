import { prisma } from "@/lib/prisma"
import { getOrderFolioDigits } from "@/lib/settings"
import { repairFolio } from "@/lib/workshop-labels"
import { orderTotalCents } from "@/lib/workshop-money"

/**
 * Datos de la consola de plataforma (consola Reficio, solo superadmin).
 *
 * Son consultas agregadas por empresa pensadas para operación del SaaS:
 * conteos de recursos, ventas acumuladas y última actividad. No exponen
 * datos sensibles de los tenants (sin contraseñas; los correos solo van en
 * el detalle, donde el operador los necesita para soporte).
 */

export interface PlatformBusinessCounts {
  users: number
  products: number
  repairOrders: number
  sales: number
  branches: number
}

export interface PlatformBusinessSummary {
  id: string
  name: string
  slug: string
  category: string
  isActive: boolean
  createdAt: Date
  counts: PlatformBusinessCounts
  /** Cobrado neto acumulado: Σ(Sale.total − discountCents/100) de ventas COMPLETED (las anuladas no suman). */
  salesTotal: number
  /** Última actividad operativa: max(createdAt) entre órdenes y ventas. */
  lastActivityAt: Date | null
}

interface CountedBusiness {
  id: string
  name: string
  slug: string
  category: string
  isActive: boolean
  createdAt: Date
  _count: {
    users: number
    products: number
    repairOrders: number
    sales: number
    branches: number
  }
}

function toSummary(
  business: CountedBusiness,
  salesTotal: number,
  lastOrderAt: Date | null,
  lastSaleAt: Date | null,
): PlatformBusinessSummary {
  const stamps = [lastOrderAt, lastSaleAt].filter((d): d is Date => d !== null)
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    category: business.category,
    isActive: business.isActive,
    createdAt: business.createdAt,
    counts: {
      users: business._count.users,
      products: business._count.products,
      repairOrders: business._count.repairOrders,
      sales: business._count.sales,
      branches: business._count.branches,
    },
    salesTotal,
    lastActivityAt: stamps.length ? new Date(Math.max(...stamps.map(d => d.getTime()))) : null,
  }
}

const BUSINESS_SELECT = {
  id: true,
  name: true,
  slug: true,
  category: true,
  isActive: true,
  createdAt: true,
  _count: {
    select: { users: true, products: true, repairOrders: true, sales: true, branches: true },
  },
} as const

/** Lista todas las empresas con conteos y métricas (3 consultas en total). */
export async function listPlatformBusinesses(): Promise<PlatformBusinessSummary[]> {
  const [businesses, salesTotals, salesActivity, ordersActivity] = await Promise.all([
    prisma.business.findMany({ orderBy: { createdAt: "desc" }, select: BUSINESS_SELECT }),
    // Ventas acumuladas: solo COMPLETED suma ingresos reales, y lo cobrado
    // es el catálogo menos el descuento (discountCents viene en centavos).
    prisma.sale.groupBy({
      by: ["businessId"],
      where: { status: "COMPLETED" },
      _sum: { total: true, discountCents: true },
    }),
    // Última actividad: cualquier venta cuenta (incluidas las anuladas).
    prisma.sale.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
    prisma.repairOrder.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
  ])

  const totalMap = new Map(salesTotals.map(r => [r.businessId, (r._sum.total ?? 0) - (r._sum.discountCents ?? 0) / 100]))
  const saleAtMap = new Map(salesActivity.map(r => [r.businessId, r._max.createdAt]))
  const orderAtMap = new Map(ordersActivity.map(r => [r.businessId, r._max.createdAt]))

  return businesses.map(b =>
    toSummary(b, totalMap.get(b.id) ?? 0, orderAtMap.get(b.id) ?? null, saleAtMap.get(b.id) ?? null)
  )
}

export interface PlatformBusinessUser {
  id: string
  name: string
  email: string | null
  role: string
  status: string
  jobTitle: string | null
  isSuperAdmin: boolean
  createdAt: Date
}

export interface PlatformRecentOrder {
  id: string
  folio: string
  status: string
  createdAt: Date
  /** Cotización aprobada o, si no hay, la propuesta; null si aún no se cotiza. */
  totalCents: number | null
}

export interface PlatformRecentSale {
  id: string
  folio: string
  status: string
  createdAt: Date
  total: number
}

export interface PlatformBusinessDetail extends PlatformBusinessSummary {
  updatedAt: Date
  phone: string | null
  address: string | null
  logoUrl: string | null
  /** Staff (ADMIN/EMPLOYEE/WORKSHOP); los clientes solo cuentan en `counts.users`. */
  users: PlatformBusinessUser[]
  recentRepairOrders: PlatformRecentOrder[]
  recentSales: PlatformRecentSale[]
  /** Acciones de plataforma sobre este negocio (suspender/reactivar/borrar). */
  platformEvents: PlatformEventItem[]
}

export interface PlatformEventItem {
  id: string
  kind: string
  actorEmail: string | null
  createdAt: Date
}

const saleFolio = (number: number) => `V-${String(number).padStart(6, "0")}`

/** Detalle de una empresa para la consola; null si no existe. */
export async function getPlatformBusinessDetail(id: string): Promise<PlatformBusinessDetail | null> {
  const business = await prisma.business.findUnique({
    where: { id },
    select: {
      ...BUSINESS_SELECT,
      updatedAt: true,
      phone: true,
      address: true,
      logoUrl: true,
    },
  })
  if (!business) return null

  // El folio de las órdenes recientes respeta los dígitos configurados por
  // ESE negocio (order_folio_digits), no un formato fijo de la consola.
  const [users, orders, sales, salesTotal, lastOrder, lastSale, folioDigits, platformEvents] = await Promise.all([
    prisma.user.findMany({
      where: { businessId: id, role: { in: ["ADMIN", "EMPLOYEE", "WORKSHOP"] } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        jobTitle: true,
        isSuperAdmin: true,
        createdAt: true,
      },
    }),
    prisma.repairOrder.findMany({
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        number: true,
        status: true,
        createdAt: true,
        quoteCents: true,
        approvedQuoteCents: true,
        diagnosticFeeCents: true,
        // Refacciones autorizadas: se cobran además de la mano de obra.
        parts: { where: { status: "APPROVED" }, select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true } },
      },
    }),
    prisma.sale.findMany({
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, number: true, status: true, createdAt: true, total: true },
    }),
    prisma.sale.aggregate({
      where: { businessId: id, status: "COMPLETED" },
      _sum: { total: true, discountCents: true },
    }),
    prisma.repairOrder.findFirst({
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.sale.findFirst({
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    getOrderFolioDigits(id),
    prisma.platformEvent.findMany({
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, kind: true, actorEmail: true, createdAt: true },
    }),
  ])

  return {
    ...toSummary(business, (salesTotal._sum.total ?? 0) - (salesTotal._sum.discountCents ?? 0) / 100, lastOrder?.createdAt ?? null, lastSale?.createdAt ?? null),
    updatedAt: business.updatedAt,
    phone: business.phone,
    address: business.address,
    logoUrl: business.logoUrl,
    users,
    recentRepairOrders: orders.map(o => ({
      id: o.id,
      folio: repairFolio(o.number, folioDigits),
      status: o.status,
      createdAt: o.createdAt,
      // Total real de la orden: mano de obra + refacciones autorizadas (o el
      // cargo de diagnóstico en cierres sin reparación) — workshop-money.
      totalCents: orderTotalCents(o, o.parts),
    })),
    recentSales: sales.map(s => ({
      id: s.id,
      folio: saleFolio(s.number),
      status: s.status,
      createdAt: s.createdAt,
      total: s.total,
    })),
    platformEvents,
  }
}

/* ---------- Telemetría del directorio público (/mercado) ---------- */

export interface PlatformDirectoryTopQuery {
  query: string
  count: number
}

export interface PlatformDirectoryTopBusiness {
  businessId: string
  name: string
  slug: string
  clicks: number
}

export interface PlatformDirectoryDay {
  /** YYYY-MM-DD (UTC) — llave estable para el mini-gráfico. */
  date: string
  searches: number
  clicks: number
  requests: number
  total: number
}

export interface PlatformDirectoryStats {
  /** Tamaño de la ventana medida (días hacia atrás desde hoy). */
  windowDays: number
  totals: { searches: number; clicks: number; requests: number }
  /** Términos/categorías más buscados (top 10, query no nulo). */
  topQueries: PlatformDirectoryTopQuery[]
  /** Vitrinas con más clicks (top 10, con nombre y slug del negocio). */
  topBusinesses: PlatformDirectoryTopBusiness[]
  /** Eventos por día, más viejo → más reciente (rellena días sin eventos). */
  daily: PlatformDirectoryDay[]
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Métricas del directorio para la consola: qué busca la gente, a qué
 * vitrinas entra y cuántas solicitudes se generan en los últimos `days`
 * días. DirectoryEvent es global (sin tenant) — esta vista es justamente
 * la inteligencia de mercado que ningún tenant puede ver por su cuenta.
 */
export async function platformDirectoryStats(days = 30): Promise<PlatformDirectoryStats> {
  const windowDays = Math.max(1, Math.min(days, 365))
  // Medianoche UTC de hace `days` días: ventana alineada al mini-gráfico.
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - (windowDays - 1))
  const inWindow = { createdAt: { gte: since } }

  const [searches, clicks, requests, topQueryRows, topBusinessRows, dailyRows] =
    await Promise.all([
      prisma.directoryEvent.count({ where: { kind: "search", ...inWindow } }),
      prisma.directoryEvent.count({ where: { kind: "click", ...inWindow } }),
      prisma.directoryEvent.count({ where: { kind: "request", ...inWindow } }),
      prisma.directoryEvent.groupBy({
        by: ["query"],
        where: { kind: "search", ...inWindow, query: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { query: "desc" } },
        take: 10,
      }),
      prisma.directoryEvent.groupBy({
        by: ["businessId"],
        where: { kind: "click", ...inWindow, businessId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { businessId: "desc" } },
        take: 10,
      }),
      // La serie diaria se agrega en SQL (kind × día UTC): el findMany
      // anterior materializaba hasta 365 días de eventos solo para
      // agruparlos en memoria. to_char sobre la columna timestamp (UTC por
      // convención de Prisma) da la misma llave YYYY-MM-DD que utcDay().
      prisma.$queryRaw<{ kind: string; day: string; n: number }[]>`
        SELECT "kind", to_char("createdAt", 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "n"
        FROM "DirectoryEvent"
        WHERE "createdAt" >= ${since}
        GROUP BY "kind", to_char("createdAt", 'YYYY-MM-DD')
      `,
    ])

  // Join defensivo de nombres: un negocio borrado conserva sus clicks
  // (onDelete: SetNull) pero ya no aparece con nombre.
  const businessIds = topBusinessRows
    .map(r => r.businessId)
    .filter((id): id is string => id !== null)
  const businesses = businessIds.length
    ? await prisma.business.findMany({
        where: { id: { in: businessIds } },
        select: { id: true, name: true, slug: true },
      })
    : []
  const businessMap = new Map(businesses.map(b => [b.id, b]))

  const byDay = new Map<string, PlatformDirectoryDay>()
  for (const row of dailyRows) {
    const day = byDay.get(row.day) ?? { date: row.day, searches: 0, clicks: 0, requests: 0, total: 0 }
    if (row.kind === "search") day.searches += row.n
    else if (row.kind === "click") day.clicks += row.n
    else if (row.kind === "request") day.requests += row.n
    day.total += row.n
    byDay.set(row.day, day)
  }
  // Rellena días sin eventos para que la gráfica no tenga huecos falsos.
  const daily: PlatformDirectoryDay[] = []
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(since)
    d.setUTCDate(since.getUTCDate() + i)
    const date = utcDay(d)
    daily.push(byDay.get(date) ?? { date, searches: 0, clicks: 0, requests: 0, total: 0 })
  }

  return {
    windowDays,
    totals: { searches, clicks, requests },
    topQueries: topQueryRows
      .filter((r): r is typeof r & { query: string } => r.query !== null)
      .map(r => ({ query: r.query, count: r._count._all })),
    topBusinesses: topBusinessRows
      .filter((r): r is typeof r & { businessId: string } => r.businessId !== null)
      .map(r => ({
        businessId: r.businessId,
        name: businessMap.get(r.businessId)?.name ?? "Negocio eliminado",
        slug: businessMap.get(r.businessId)?.slug ?? "",
        clicks: r._count._all,
      })),
    daily,
  }
}
