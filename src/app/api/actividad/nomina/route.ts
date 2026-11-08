import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { businessDayKey, parseBusinessDateParam } from "@/lib/business-time"
import { diasDesdeReloj, type ClockEventLike } from "@/lib/asistencia"

const DAY_MS = 24 * 60 * 60 * 1000
// Un trimestre: el estimado recorre `from` al límite cuando el rango pedido
// lo excede — el periodo de la respuesta siempre refleja el rango EFECTIVO.
const MAX_PERIOD_DAYS = 93
// SALARY: payRateCents es el sueldo por QUINCENA; se prorratea por día
// natural del periodo (días del rango / 15), no por días trabajados.
const SALARY_PERIOD_DAYS = 15

interface NominaEmployee {
  userId: string
  name: string
  jobTitle: string | null
  payType: string
  payRateCents: number | null
  commissionPct: number | null
  daysActive: number
  minutesActive: number
  /** "clock" = checador real (ClockEvent) · "activity" = reconstruido de
   *  bitácora+operaciones. El reloj manda: con una sola checada en el
   *  rango, los minutos del empleado salen SOLO de pares IN→OUT. */
  minutesSource: "clock" | "activity"
  /** Días con jornada abandonada (IN sin cierre confiable >16 h): sus
   *  minutos reales son desconocidos — no se inventan. Solo con "clock". */
  openEndedDays: number
  salesTotalCents: number
  salesCount: number
  estimatedCents: number
  breakdown: {
    hourly?: { hours: number; rateCents: number }
    salary?: { rateCents: number; daysInPeriod: number; dailyRateCents: number }
    commission?: { pct: number; baseCents: number }
  }
}

/**
 * GET /api/actividad/nomina?from=YYYY-MM-DD&to=YYYY-MM-DD — estimado de
 * nómina por empleado a partir de datos reales. Solo ADMIN.
 *
 * Fuentes:
 * - Tiempo activo → ClockEvent cuando el empleado checó en el rango (pares
 *   IN→OUT reales; jornada abierta cuenta hasta ahora y una abandonada
 *   >16 h aporta 0 marcada en openEndedDays); sin checadas, AuditEvent +
 *   BusinessOperation por día del negocio (misma reconstrucción que
 *   lib/turnos: primer→último movimiento del día).
 * - Ventas → Sale.sellerId, solo COMPLETED, importe neto cobrado
 *   (total de catálogo − discountCents), igual que /api/actividad/desempeno.
 *
 * Esquemas (User.payType): HOURLY = minutosActivos/60 × tarifa ·
 * SALARY = sueldo por quincena prorrateado a los días naturales del rango ·
 * COMMISSION = % sobre sus ventas cobradas · NONE = estimado 0.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const params = new URL(request.url).searchParams
    const todayKey = businessDayKey(new Date())
    const to =
      parseBusinessDateParam(params.get("to"), "end") ??
      parseBusinessDateParam(todayKey, "end")!
    let from =
      parseBusinessDateParam(params.get("from"), "start") ??
      parseBusinessDateParam(businessDayKey(new Date(Date.now() - 14 * DAY_MS)), "start")!
    if (from > to) {
      return NextResponse.json({ error: "Rango inválido: 'from' es posterior a 'to'" }, { status: 400 })
    }
    const minFrom = parseBusinessDateParam(
      businessDayKey(new Date(to.getTime() - (MAX_PERIOD_DAYS - 1) * DAY_MS)),
      "start"
    )!
    if (from < minFrom) from = minFrom

    const toDayStart = parseBusinessDateParam(businessDayKey(to), "start")!
    const daysInPeriod = Math.round((toDayStart.getTime() - from.getTime()) / DAY_MS) + 1
    const range = { gte: from, lte: to }

    const [users, sales, audit, ops, clock] = await Promise.all([
      prisma.user.findMany({
        where: { businessId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } },
        select: { id: true, name: true, jobTitle: true, payType: true, payRateCents: true, commissionPct: true },
      }),
      prisma.sale.findMany({
        where: { businessId, status: "COMPLETED", createdAt: range },
        select: { sellerId: true, total: true, discountCents: true },
      }),
      prisma.auditEvent.findMany({
        where: { businessId, createdAt: range },
        select: { actorId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.businessOperation.findMany({
        where: { businessId, createdAt: range },
        select: { actorId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.clockEvent.findMany({
        where: { businessId, at: range },
        select: { id: true, userId: true, type: true, at: true, branchId: true },
        orderBy: { at: "asc" },
      }),
    ])

    // Empleados con checador en el rango: sus minutos son los reales
    // (IN→OUT). El fallback por actividad aplica solo a quien NO checó.
    const clockByUser = new Map<string, ClockEventLike[]>()
    for (const e of clock) {
      const list = clockByUser.get(e.userId)
      if (list) list.push(e)
      else clockByUser.set(e.userId, [e])
    }

    // Minutos activos por empleado: por cada día del negocio con huella,
    // primer→último movimiento (un solo evento = día activo con 0 minutos).
    const dayBuckets = new Map<string, { first: Date; last: Date }>()
    const pushEvent = (actorId: string, at: Date) => {
      if (clockByUser.has(actorId)) return // su jornada la manda el reloj
      const key = `${actorId}|${businessDayKey(at)}`
      const b = dayBuckets.get(key)
      if (!b) dayBuckets.set(key, { first: at, last: at })
      else {
        if (at < b.first) b.first = at
        if (at > b.last) b.last = at
      }
    }
    for (const e of audit) pushEvent(e.actorId, e.createdAt)
    for (const e of ops) pushEvent(e.actorId, e.createdAt)

    const activity = new Map<string, { daysActive: number; minutesActive: number; openEndedDays: number; source: "clock" | "activity" }>()
    for (const [key, b] of dayBuckets) {
      const actorId = key.split("|")[0]
      const a = activity.get(actorId) ?? { daysActive: 0, minutesActive: 0, openEndedDays: 0, source: "activity" as const }
      a.daysActive++
      a.minutesActive += Math.max(0, Math.round((b.last.getTime() - b.first.getTime()) / 60000))
      activity.set(actorId, a)
    }
    // Fuente reloj: cada jornada se atribuye al día-negocio de su IN; una
    // jornada abandonada no aporta minutos (no se inventa el cierre) y una
    // abierta cuenta hasta ahora.
    const now = new Date()
    for (const [userId, evs] of clockByUser) {
      const a = { daysActive: 0, minutesActive: 0, openEndedDays: 0, source: "clock" as const }
      for (const d of diasDesdeReloj(evs, now).values()) {
        a.daysActive++
        a.minutesActive += d.minutos
        if (d.openEnded) a.openEndedDays++
      }
      activity.set(userId, a)
    }

    // Ventas en centavos por fila: Sale.total es Float en pesos y sumar
    // pesos arrastra epsilon binario; el cobrado neto resta discountCents.
    const salesBy = new Map<string, { salesTotalCents: number; salesCount: number }>()
    for (const s of sales) {
      const agg = salesBy.get(s.sellerId) ?? { salesTotalCents: 0, salesCount: 0 }
      agg.salesTotalCents += Math.round(s.total * 100) - s.discountCents
      agg.salesCount++
      salesBy.set(s.sellerId, agg)
    }

    const employees: NominaEmployee[] = users.map(u => {
      const { daysActive = 0, minutesActive = 0, openEndedDays = 0, source: minutesSource = "activity" as const } = activity.get(u.id) ?? {}
      const { salesTotalCents = 0, salesCount = 0 } = salesBy.get(u.id) ?? {}
      const rate = u.payRateCents ?? 0
      let estimatedCents = 0
      const breakdown: NominaEmployee["breakdown"] = {}
      switch (u.payType) {
        case "HOURLY": {
          const hours = minutesActive / 60
          estimatedCents = Math.round(hours * rate)
          breakdown.hourly = { hours: Math.round(hours * 100) / 100, rateCents: rate }
          break
        }
        case "SALARY": {
          const dailyRateCents = Math.round(rate / SALARY_PERIOD_DAYS)
          estimatedCents = dailyRateCents * daysInPeriod
          breakdown.salary = { rateCents: rate, daysInPeriod, dailyRateCents }
          break
        }
        case "COMMISSION": {
          const pct = u.commissionPct ?? 0
          estimatedCents = Math.round((salesTotalCents * pct) / 100)
          breakdown.commission = { pct, baseCents: salesTotalCents }
          break
        }
      }
      return {
        userId: u.id,
        name: u.name,
        jobTitle: u.jobTitle,
        payType: u.payType,
        payRateCents: u.payRateCents,
        commissionPct: u.commissionPct,
        daysActive,
        minutesActive,
        minutesSource,
        openEndedDays,
        salesTotalCents,
        salesCount,
        estimatedCents,
        breakdown,
      }
    })

    employees.sort(
      (a, b) =>
        b.estimatedCents - a.estimatedCents ||
        b.minutesActive - a.minutesActive ||
        a.name.localeCompare(b.name, "es")
    )

    return NextResponse.json(
      {
        period: { from: businessDayKey(from), to: businessDayKey(to) },
        employees,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    return businessFailure(error)
  }
}
