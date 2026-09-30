import { prisma } from "@/lib/prisma"
import { businessDayKey } from "@/lib/business-time"

export interface TurnoDia {
  /** "YYYY-MM-DD" en horario del negocio. */
  dia: string
  actorId: string
  actorName: string
  firstAt: string
  lastAt: string
  /** Minutos entre el primer y último movimiento del día. */
  minutosActivo: number
  eventos: number
  /** Conteo por tipo (PRODUCT_UPDATE, SALE, ENCARGO_STATUS, ...). */
  porTipo: Record<string, number>
}

/**
 * Turnos derivados: no hay checador — la jornada se reconstruye sola con el
 * primer y último movimiento que cada empleado dejó en AuditEvent +
 * BusinessOperation (las dos fuentes que cubren ediciones admin y toda la
 * operación transaccional). Un "turno" = todos los eventos de un actor dentro
 * del mismo día del negocio (America/Mexico_City).
 *
 * Devuelve los últimos `dias` días, más reciente primero.
 */
export async function getTurnos(businessId: string, dias = 14): Promise<TurnoDia[]> {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

  const [audit, ops, users] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { businessId, createdAt: { gte: desde } },
      select: { actorId: true, action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.businessOperation.findMany({
      where: { businessId, createdAt: { gte: desde } },
      select: { actorId: true, kind: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { businessId },
      select: { id: true, name: true },
    }),
  ])

  const nameOf = new Map(users.map(u => [u.id, u.name]))

  // bucket por actor+día
  const buckets = new Map<string, { first: Date; last: Date; eventos: number; porTipo: Record<string, number> }>()
  const push = (actorId: string, tipo: string, at: Date) => {
    const key = `${actorId}|${businessDayKey(at)}`
    const b = buckets.get(key)
    if (!b) {
      buckets.set(key, { first: at, last: at, eventos: 1, porTipo: { [tipo]: 1 } })
    } else {
      if (at < b.first) b.first = at
      if (at > b.last) b.last = at
      b.eventos++
      b.porTipo[tipo] = (b.porTipo[tipo] ?? 0) + 1
    }
  }
  for (const e of audit) push(e.actorId, e.action, e.createdAt)
  for (const e of ops) push(e.actorId, e.kind, e.createdAt)

  return [...buckets.entries()]
    .map(([key, b]) => {
      const [actorId, dia] = key.split("|")
      return {
        dia,
        actorId,
        actorName: nameOf.get(actorId) ?? "Usuario eliminado",
        firstAt: b.first.toISOString(),
        lastAt: b.last.toISOString(),
        minutosActivo: Math.round((b.last.getTime() - b.first.getTime()) / 60000),
        eventos: b.eventos,
        porTipo: b.porTipo,
      }
    })
    .sort((a, b) => b.dia.localeCompare(a.dia) || b.lastAt.localeCompare(a.lastAt))
}
