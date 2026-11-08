import { prisma } from "@/lib/prisma"
import { businessDayKey } from "@/lib/business-time"
import { diasDesdeReloj, type ClockEventLike } from "@/lib/asistencia"

export interface TurnoDia {
  /** "YYYY-MM-DD" en horario del negocio. */
  dia: string
  actorId: string
  actorName: string
  firstAt: string
  lastAt: string
  /** Minutos entre el primer y último movimiento del día (fuente "activity")
   *  o suma de jornadas IN→OUT del día (fuente "clock"; una jornada
   *  abandonada aporta 0, una abierta cuenta hasta ahora). */
  minutosActivo: number
  eventos: number
  /** Conteo por tipo (PRODUCT_UPDATE, SALE, ENCARGO_STATUS, ... o "IN"/"OUT"). */
  porTipo: Record<string, number>
  /** "clock" = checador real (ClockEvent); "activity" = reconstruido de la
   *  bitácora. Un empleado con ClockEvents en el rango reporta SOLO por
   *  reloj: su actividad ya no define la jornada. */
  source: "clock" | "activity"
  /** Día con al menos una jornada abandonada (IN sin cierre confiable >16 h)
   *  o corriendo ahora mismo; solo aplica cuando source = "clock". */
  openEnded?: boolean
  open?: boolean
}

/**
 * Turnos: cuando el empleado tiene eventos de checador (ClockEvent) en el
 * rango, su jornada sale de pares IN→OUT reales (lib/asistencia). Sin
 * checadas se mantiene el fallback histórico: la jornada se reconstruye con
 * el primer y último movimiento que el empleado dejó en AuditEvent +
 * BusinessOperation dentro del mismo día del negocio (America/Mexico_City).
 *
 * Devuelve los últimos `dias` días, más reciente primero.
 */
export async function getTurnos(businessId: string, dias = 14): Promise<TurnoDia[]> {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)

  const [audit, ops, users, clock] = await Promise.all([
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
    prisma.clockEvent.findMany({
      where: { businessId, at: { gte: desde } },
      select: { id: true, userId: true, type: true, at: true, branchId: true },
      orderBy: { at: "asc" },
    }),
  ])

  const nameOf = new Map(users.map(u => [u.id, u.name]))

  // Empleados que usaron el checador en el rango: su jornada es la real.
  const clockByUser = new Map<string, ClockEventLike[]>()
  for (const e of clock) {
    const list = clockByUser.get(e.userId)
    if (list) list.push(e)
    else clockByUser.set(e.userId, [e])
  }

  const turnos: TurnoDia[] = []

  // Fuente reloj: jornadas derivadas, atribuidas al día-negocio de su IN.
  for (const [actorId, evs] of clockByUser) {
    for (const [dia, d] of diasDesdeReloj(evs)) {
      turnos.push({
        dia,
        actorId,
        actorName: nameOf.get(actorId) ?? "Usuario eliminado",
        firstAt: d.firstAt,
        lastAt: d.lastAt,
        minutosActivo: d.minutos,
        eventos: d.eventos,
        porTipo: d.porTipo,
        source: "clock",
        open: d.open,
        openEnded: d.openEnded,
      })
    }
  }

  // Fuente actividad (fallback): bucket por actor+día, solo para quien NO
  // tiene checadas en el rango — la actividad de quien usa el checador ya
  // no define su jornada (sigue existiendo, pero no es asistencia).
  const buckets = new Map<string, { first: Date; last: Date; eventos: number; porTipo: Record<string, number> }>()
  const push = (actorId: string, tipo: string, at: Date) => {
    if (clockByUser.has(actorId)) return
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

  for (const [key, b] of buckets.entries()) {
    const [actorId, dia] = key.split("|")
    turnos.push({
      dia,
      actorId,
      actorName: nameOf.get(actorId) ?? "Usuario eliminado",
      firstAt: b.first.toISOString(),
      lastAt: b.last.toISOString(),
      minutosActivo: Math.round((b.last.getTime() - b.first.getTime()) / 60000),
      eventos: b.eventos,
      porTipo: b.porTipo,
      source: "activity",
    })
  }

  return turnos.sort((a, b) => b.dia.localeCompare(a.dia) || b.lastAt.localeCompare(a.lastAt))
}
