import type { RepairStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * Salud global de la plataforma (consola Reficio, solo superadmin).
 *
 * Métricas agregadas cross-tenant para el panel /platform/health y su
 * endpoint /api/platform/health. Misma regla que lib/platform.ts: solo
 * conteos y sumas — jamás datos de negocios individuales ni de usuarios
 * finales (sin nombres, correos, teléfonos ni folios).
 */

// Cierres de la reparación: cualquier otro estado cuenta como orden abierta.
// Mismo conjunto terminal que /api/platform/overview y /api/reports/sucursales.
const TERMINAL_ORDER_STATUSES: readonly RepairStatus[] = [
  "DELIVERED",
  "CANCELLED",
  "NOT_REPAIRED",
  "NOT_AUTHORIZED",
]

export interface PlatformHealth {
  businesses: {
    total: number
    active: number
    suspended: number
    /** Visibles en /mercado: activas y con vitrina habilitada (criterio de la consola). */
    inDirectory: number
  }
  users: {
    total: number
    /** Roles que operan un negocio: ADMIN + EMPLOYEE + WORKSHOP. */
    staff: number
    /** CUSTOMER. */
    customers: number
    /** status PENDING: altas que aún no se aprueban. */
    pendingApproval: number
  }
  sales: {
    /** Documentos COMPLETED (DRAFT/OPEN son vivos, VOIDED se excluye). */
    totalCompleted: number
    /** Σ Sale.total de COMPLETED × 100 — total está en pesos (Float). */
    totalRevenueCents: number
  }
  repairs: {
    /** Órdenes en cualquier estado no terminal. */
    openCount: number
  }
  platformEvents: {
    total: number
    lastAt: Date | null
  }
  generatedAt: Date
}

/** Agregados globales en un solo Promise.all (sin filtro por businessId). */
export async function getPlatformHealth(): Promise<PlatformHealth> {
  const [
    businessesTotal,
    businessesActive,
    businessesInDirectory,
    usersTotal,
    usersStaff,
    usersCustomers,
    usersPending,
    salesCompleted,
    ordersOpen,
    eventsTotal,
    eventsLast,
  ] = await Promise.all([
    prisma.business.count(),
    prisma.business.count({ where: { isActive: true } }),
    // "En directorio" replica isInDirectory de la consola: suspendida = fuera.
    prisma.business.count({ where: { isActive: true, showInDirectory: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: { in: ["ADMIN", "EMPLOYEE", "WORKSHOP"] } } }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.sale.aggregate({
      where: { status: "COMPLETED" },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.repairOrder.count({
      where: { status: { notIn: [...TERMINAL_ORDER_STATUSES] } },
    }),
    prisma.platformEvent.count(),
    prisma.platformEvent.aggregate({ _max: { createdAt: true } }),
  ])

  return {
    businesses: {
      total: businessesTotal,
      active: businessesActive,
      suspended: businessesTotal - businessesActive,
      inDirectory: businessesInDirectory,
    },
    users: {
      total: usersTotal,
      staff: usersStaff,
      customers: usersCustomers,
      pendingApproval: usersPending,
    },
    sales: {
      totalCompleted: salesCompleted._count._all,
      totalRevenueCents: Math.round((salesCompleted._sum.total ?? 0) * 100),
    },
    repairs: { openCount: ordersOpen },
    platformEvents: { total: eventsTotal, lastAt: eventsLast._max.createdAt },
    generatedAt: new Date(),
  }
}
