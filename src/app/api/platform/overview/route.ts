import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/platform/overview — Consola Reficio (solo superadmin).
 *
 * Centro de mando del operador: KPIs globales de la instancia (empresas,
 * usuarios, órdenes, ventas, productos) y la "salud por negocio" — las 50
 * empresas con actividad más reciente con sus conteos operativos.
 *
 * Todo es agregado cross-tenant a propósito: nunca expone nombres,
 * teléfonos ni contenido de órdenes/ventas de los clientes finales.
 */

// Cierres de la reparación: cualquier otro estado cuenta como orden abierta.
const TERMINAL_ORDER_STATUSES = ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"] as const

const HEALTH_LIMIT = 50
const DAY_MS = 24 * 60 * 60 * 1000

interface HealthRow {
  id: string
  name: string
  slug: string
  category: string
  isActive: boolean
  createdAt: Date
  usersCount: number
  ordersCount: number
  lastOrderAt: Date | null
  salesLast30d: number
  pendingUsers: number
}

export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const now = Date.now()
    const since30d = new Date(now - 30 * DAY_MS)
    const since7d = new Date(now - 7 * DAY_MS)

    const [
      businessesTotal,
      businessesActive,
      businessesNew,
      usersTotal,
      usersPending,
      usersByRole,
      ordersTotal,
      ordersOpen,
      ordersLast7d,
      salesCountTotal,
      salesLast30d,
      productsTotal,
      ordersActivity,
      salesActivity,
    ] = await Promise.all([
      prisma.business.count(),
      prisma.business.count({ where: { isActive: true } }),
      prisma.business.count({ where: { createdAt: { gte: since30d } } }),
      prisma.user.count(),
      prisma.user.count({ where: { status: "PENDING" } }),
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.repairOrder.count(),
      prisma.repairOrder.count({ where: { status: { notIn: [...TERMINAL_ORDER_STATUSES] } } }),
      prisma.repairOrder.count({ where: { createdAt: { gte: since7d } } }),
      prisma.sale.count(),
      prisma.sale.aggregate({
        where: { status: "COMPLETED", createdAt: { gte: since30d } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      prisma.product.count(),
      // Actividad por empresa: la orden o venta más reciente de cada una.
      prisma.repairOrder.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
      prisma.sale.groupBy({ by: ["businessId"], _max: { createdAt: true } }),
    ])

    const byRole: Record<"ADMIN" | "EMPLOYEE" | "WORKSHOP" | "CUSTOMER", number> = {
      ADMIN: 0,
      EMPLOYEE: 0,
      WORKSHOP: 0,
      CUSTOMER: 0,
    }
    for (const row of usersByRole) byRole[row.role] = row._count._all

    // Ranking de salud: max(última orden, última venta) por empresa.
    const lastOrderAt = new Map(ordersActivity.map(r => [r.businessId, r._max.createdAt]))
    const activity = new Map<string, number>()
    for (const r of ordersActivity) {
      if (r._max.createdAt) {
        activity.set(r.businessId, Math.max(activity.get(r.businessId) ?? 0, r._max.createdAt.getTime()))
      }
    }
    for (const r of salesActivity) {
      if (r._max.createdAt) {
        activity.set(r.businessId, Math.max(activity.get(r.businessId) ?? 0, r._max.createdAt.getTime()))
      }
    }

    const healthIds = [...activity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, HEALTH_LIMIT)
      .map(([id]) => id)
    // Empresas sin actividad aún (recién dadas de alta) cierran la lista.
    if (healthIds.length < HEALTH_LIMIT) {
      const newcomers = await prisma.business.findMany({
        where: { id: { notIn: healthIds } },
        orderBy: { createdAt: "desc" },
        take: HEALTH_LIMIT - healthIds.length,
        select: { id: true },
      })
      healthIds.push(...newcomers.map(b => b.id))
    }

    // Agregados por negocio solo para las 50 listadas (no N+1: un groupBy
    // por recurso filtrado a esos ids).
    let health: HealthRow[] = []
    if (healthIds.length > 0) {
      const inHealth = { businessId: { in: healthIds } }
      const [rows, usersPerBiz, pendingPerBiz, ordersPerBiz, salesPerBiz] = await Promise.all([
        prisma.business.findMany({
          where: { id: { in: healthIds } },
          select: { id: true, name: true, slug: true, category: true, isActive: true, createdAt: true },
        }),
        prisma.user.groupBy({ by: ["businessId"], where: inHealth, _count: { _all: true } }),
        prisma.user.groupBy({ by: ["businessId"], where: { ...inHealth, status: "PENDING" }, _count: { _all: true } }),
        prisma.repairOrder.groupBy({ by: ["businessId"], where: inHealth, _count: { _all: true } }),
        prisma.sale.groupBy({
          by: ["businessId"],
          where: { ...inHealth, createdAt: { gte: since30d } },
          _count: { _all: true },
        }),
      ])

      const rowMap = new Map(rows.map(b => [b.id, b]))
      const toCountMap = (list: { businessId: string; _count: { _all: number } }[]) =>
        new Map(list.map(r => [r.businessId, r._count._all]))
      const usersMap = toCountMap(usersPerBiz)
      const pendingMap = toCountMap(pendingPerBiz)
      const ordersMap = toCountMap(ordersPerBiz)
      const salesMap = toCountMap(salesPerBiz)

      health = healthIds
        .map(id => rowMap.get(id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined)
        .map(b => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          category: b.category,
          isActive: b.isActive,
          createdAt: b.createdAt,
          usersCount: usersMap.get(b.id) ?? 0,
          ordersCount: ordersMap.get(b.id) ?? 0,
          lastOrderAt: lastOrderAt.get(b.id) ?? null,
          salesLast30d: salesMap.get(b.id) ?? 0,
          pendingUsers: pendingMap.get(b.id) ?? 0,
        }))
    }

    return NextResponse.json(
      {
        businesses: {
          total: businessesTotal,
          active: businessesActive,
          inactive: businessesTotal - businessesActive,
          newLast30d: businessesNew,
        },
        users: {
          total: usersTotal,
          pendingApprovals: usersPending,
          byRole,
        },
        orders: {
          total: ordersTotal,
          openNow: ordersOpen,
          last7d: ordersLast7d,
        },
        sales: {
          countTotal: salesCountTotal,
          sumLast30d: salesLast30d._sum.total ?? 0,
          countLast30d: salesLast30d._count._all,
        },
        products: { total: productsTotal },
        health,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[platform] Error cargando el resumen:", error)
    return NextResponse.json(
      { error: "Error al cargar el resumen de plataforma" },
      { status: 500 }
    )
  }
}
