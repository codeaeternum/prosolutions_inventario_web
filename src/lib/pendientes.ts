import { prisma } from "@/lib/prisma"
import { businessIdOf } from "@/lib/tenant"
import { hasModule, type ModuleKey } from "@/lib/access"
import { ACTIVE_RESERVATIONS } from "@/lib/domain/reservations"

export type PendienteSeverity = "alta" | "media" | "baja"

export interface PendienteItem {
  key: string
  severity: PendienteSeverity
  /** Texto de la fila, ya con conteo si aplica. */
  title: string
  detail?: string
  href: string
  module: ModuleKey
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * "Pendientes" del Inicio: la cola de cosas que exigen acción hoy.
 * Tenant-scoped siempre; empleados con sucursales asignadas ven solo lo de
 * las suyas. Cada item se filtra por módulo — Kevin con inventario+taller no
 * ve solicitudes de gasto que solo el admin autoriza.
 */
export async function getPendientes(session: {
  user: { role: string; id: string; allowedModules?: string[] | null; allowedBranchIds?: string[] | null }
}): Promise<PendienteItem[]> {
  const businessId = businessIdOf(session as never)
  const user = session.user
  const branches = user.role === "ADMIN" ? null : user.allowedBranchIds ?? null
  const branchScope = branches?.length ? { in: branches } : undefined

  const now = Date.now()
  const soon = new Date(now + DAY_MS)
  const stale = new Date(now - DAY_MS)

  const [
    cashRequests,
    encargos,
    solicitudesAliados,
    apartadosVenciendo,
    ordenesListas,
    conteosAbiertos,
    cajasOlvidadas,
    stockBajo,
  ] = await Promise.all([
    prisma.cashRequest.count({
      where: { businessId, status: "PENDING", ...(branchScope ? { branchId: branchScope } : {}) },
    }),
    prisma.encargo.count({
      where: { businessId, status: "PENDING", ...(branchScope ? { branchId: branchScope } : {}) },
    }),
    // Pedidos que aliados/visitantes nos hacen a nosotros (somos el vendedor).
    prisma.marketplaceRequest.count({
      where: { businessId, status: "PENDING", OR: [{ requestedById: null }, { requestedBy: { businessId: { not: businessId } } }] },
    }),
    prisma.reservation.count({
      where: {
        businessId,
        status: { in: [...ACTIVE_RESERVATIONS] },
        expiresAt: { lt: soon },
        ...(branchScope ? { OR: [{ branchId: branchScope }, { branchId: null }] } : {}),
      },
    }),
    prisma.repairOrder.count({
      where: { businessId, status: "READY", updatedAt: { lt: stale }, ...(branchScope ? { branchId: branchScope } : {}) },
    }),
    prisma.inventoryCount.count({
      where: { businessId, status: "OPEN", ...(branchScope ? { branchId: branchScope } : {}) },
    }),
    prisma.cashRegister.count({
      where: { businessId, status: "OPEN", openedAt: { lt: stale }, ...(branchScope ? { branchId: branchScope } : {}) },
    }),
    prisma.product.findMany({
      where: { businessId, isActive: true },
      select: { stock: true, minStock: true },
    }).then(rows => rows.filter(p => p.stock <= p.minStock).length),
  ])

  const items: PendienteItem[] = [
    {
      key: "cash-requests",
      severity: "alta",
      title: `${cashRequests} solicitud${cashRequests === 1 ? "" : "es"} de gasto por autorizar`,
      href: "/admin/caja?tab=solicitudes",
      module: "caja",
    },
    {
      key: "caja-olvidada",
      severity: "alta",
      title: `Caja abierta desde hace más de un día`,
      detail: "Alguien dejó el turno abierto — haz el corte",
      href: "/admin/caja",
      module: "caja",
    },
    {
      key: "encargos",
      severity: "media",
      title: `${encargos} encargo${encargos === 1 ? "" : "s"} esperando pedir`,
      detail: "Clientes apartaron piezas que no hay — revisa aliados",
      href: "/admin/inventario?tab=encargos",
      module: "inventario",
    },
    {
      key: "solicitudes-aliados",
      severity: "media",
      title: `${solicitudesAliados} solicitud${solicitudesAliados === 1 ? "" : "es"} de aliados sin responder`,
      href: "/admin/mercado?tab=solicitudes",
      module: "mercado",
    },
    {
      key: "ordenes-listas",
      severity: "media",
      title: `${ordenesListas} orden${ordenesListas === 1 ? "" : "es"} lista${ordenesListas === 1 ? "" : "s"} sin entregar`,
      detail: "El equipo está reparado — avisa al cliente",
      href: "/admin/taller",
      module: "taller",
    },
    {
      key: "apartados-vencen",
      severity: "media",
      title: `${apartadosVenciendo} apartado${apartadosVenciendo === 1 ? "" : "s"} por vencer en 24h`,
      href: "/admin/clientes?tab=pedidos",
      module: "clientes",
    },
    {
      key: "conteos",
      severity: "baja",
      title: `${conteosAbiertos} conteo${conteosAbiertos === 1 ? "" : "s"} físico${conteosAbiertos === 1 ? "" : "s"} sin aplicar`,
      href: "/admin/inventario",
      module: "inventario",
    },
    {
      key: "stock-bajo",
      severity: "baja",
      title: `${stockBajo} producto${stockBajo === 1 ? "" : "s"} en stock mínimo`,
      href: "/admin/inventario?tab=stock&lowStock=true",
      module: "inventario",
    },
  ]

  const counts: Record<string, number> = {
    "cash-requests": cashRequests,
    "caja-olvidada": cajasOlvidadas,
    encargos,
    "solicitudes-aliados": solicitudesAliados,
    "ordenes-listas": ordenesListas,
    "apartados-vencen": apartadosVenciendo,
    conteos: conteosAbiertos,
    "stock-bajo": stockBajo,
  }

  const order: Record<PendienteSeverity, number> = { alta: 0, media: 1, baja: 2 }
  return items
    .filter(item => (counts[item.key] ?? 0) > 0 && hasModule(user, item.module))
    .sort((a, b) => order[a.severity] - order[b.severity])
}
