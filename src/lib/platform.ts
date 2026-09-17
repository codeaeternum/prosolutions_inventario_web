import { prisma } from "@/lib/prisma"
import { repairFolio } from "@/lib/workshop-labels"

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
  /** Suma de Sale.total de ventas COMPLETED (las anuladas no suman). */
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
    // Ventas acumuladas: solo COMPLETED suma ingresos reales.
    prisma.sale.groupBy({
      by: ["businessId"],
      where: { status: "COMPLETED" },
      _sum: { total: true },
    }),
    // Última actividad: cualquier venta cuenta (incluidas las anuladas).
    prisma.sale.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
    prisma.repairOrder.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
  ])

  const totalMap = new Map(salesTotals.map(r => [r.businessId, r._sum.total ?? 0]))
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

  const [users, orders, sales, salesTotal, lastOrder, lastSale] = await Promise.all([
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
      _sum: { total: true },
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
  ])

  return {
    ...toSummary(business, salesTotal._sum.total ?? 0, lastOrder?.createdAt ?? null, lastSale?.createdAt ?? null),
    updatedAt: business.updatedAt,
    phone: business.phone,
    address: business.address,
    logoUrl: business.logoUrl,
    users,
    recentRepairOrders: orders.map(o => ({
      id: o.id,
      folio: repairFolio(o.number),
      status: o.status,
      createdAt: o.createdAt,
      totalCents: o.approvedQuoteCents ?? o.quoteCents,
    })),
    recentSales: sales.map(s => ({
      id: s.id,
      folio: saleFolio(s.number),
      status: s.status,
      createdAt: s.createdAt,
      total: s.total,
    })),
  }
}
