import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession, requireAuth } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { businessDayKey, parseBusinessDateParam } from "@/lib/business-time"
import { deriveJornadas, JORNADA_MAX_MS, type ClockEventLike } from "@/lib/asistencia"

const DAY_MS = 24 * 60 * 60 * 1000
// Mismo horizonte que /api/actividad/nomina: un trimestre con clamp hacia
// atrás; el periodo de la respuesta siempre refleja el rango EFECTIVO.
const MAX_PERIOD_DAYS = 93
// Doble-tap: repetir la misma checada a <60 s de la última devuelve el
// evento existente (idempotente), no crea duplicado ni cuenta como 409.
const DEDUP_MS = 60_000

const clockSchema = z.object({
  type: z.enum(["IN", "OUT"]),
  note: z.string().trim().max(280).optional(),
})

const NO_STORE = { "Cache-Control": "private, no-store" } as const

/**
 * POST /api/asistencia — el usuario autenticado (APPROVED) registra SU
 * propia checada. En v1 nadie marca por otro: el actor es siempre la sesión.
 *
 * Reglas:
 * - OUT exige una jornada abierta (IN previo a ≤16 h, sin OUT posterior);
 *   de lo contrario 409 — incluido el IN abandonado hace >16 h, que ya no
 *   es jornada abierta (el usuario solo puede marcar IN de nuevo).
 * - IN con jornada abierta → 409. Si el último IN tiene >16 h (jornada
 *   abandonada) el nuevo IN sí se acepta y la jornada vieja queda
 *   `openEnded` al derivarse.
 * - Mismo tipo a <60 s del último evento → devuelve el existente.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const userId = session.user.id
    const body = clockSchema.parse(await request.json())

    const last = await prisma.clockEvent.findFirst({
      where: { businessId, userId },
      orderBy: { at: "desc" },
    })
    const now = new Date()

    if (last && last.type === body.type && now.getTime() - last.at.getTime() < DEDUP_MS) {
      return NextResponse.json(
        { event: last, openShift: last.type === "IN" ? { since: last.at } : null, deduplicated: true },
        { headers: NO_STORE }
      )
    }

    // Jornada abierta = IN a ≤16 h sin OUT posterior (la ventana máxima del
    // checador; más allá la jornada quedó abandonada y ya no es "abierta").
    const jornadaAbierta = last?.type === "IN" && now.getTime() - last.at.getTime() <= JORNADA_MAX_MS

    if (body.type === "OUT" && !jornadaAbierta) {
      return NextResponse.json(
        { error: "No hay una jornada abierta: primero registra tu entrada (IN)." },
        { status: 409 }
      )
    }
    if (body.type === "IN" && jornadaAbierta) {
      return NextResponse.json(
        { error: "Ya tienes una jornada abierta: registra tu salida (OUT) antes de volver a entrar.", since: last!.at },
        { status: 409 }
      )
    }

    // La sesión JWT no carga sucursal activa (auth.config.ts); si algún día
    // viaja en session.user se respeta — hoy el respaldo es la sucursal
    // base del usuario (homeBranchId), misma lectura que usan ventas/caja.
    const sessionBranchId = (session.user as { branchId?: string | null }).branchId ?? null
    const me = sessionBranchId
      ? null
      : await prisma.user.findUnique({ where: { id: userId }, select: { homeBranchId: true } })
    const branchId = sessionBranchId ?? me?.homeBranchId ?? null

    const event = await prisma.clockEvent.create({
      data: { businessId, userId, branchId, type: body.type, note: body.note ?? null },
    })

    return NextResponse.json(
      { event, openShift: event.type === "IN" ? { since: event.at } : null, deduplicated: false },
      { status: 201, headers: NO_STORE }
    )
  } catch (error) {
    return businessFailure(error)
  }
}

/**
 * GET /api/asistencia?userId=&from=&to= — historial del checador.
 *
 * - `userId` propio: cualquier usuario APPROVED ve su historial.
 * - `userId` ajeno o SIN userId (todos los del negocio): solo ADMIN.
 * - `from`/`to` son días-negocio (mismo parse/clamp que nómina): default
 *   últimos 14 días, máximo 93; `from` > `to` → 400.
 *
 * Devuelve los eventos ordenados por usuario + sus jornadas derivadas
 * (pares IN→OUT con minutos; abierta = IN sin OUT a ≤16 h; un OUT que
 * llega >16 h después del IN marca `openEnded` y no inventa el cierre).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const isAdmin = session.user.role === "ADMIN"

    const params = new URL(request.url).searchParams
    const requestedUserId = params.get("userId")?.trim() || null
    if (!isAdmin && (!requestedUserId || requestedUserId !== session.user.id)) {
      // Sin userId la respuesta cubre a TODO el negocio: es vista de dueño.
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

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

    // Usuario específico: debe existir en ESTE negocio (un id de otro tenant
    // o inexistente responde igual: 404, sin filtrar pertenencia).
    let targetUser: { id: string; name: string } | null = null
    if (requestedUserId) {
      targetUser = await prisma.user.findFirst({
        where: { id: requestedUserId, businessId },
        select: { id: true, name: true },
      })
      if (!targetUser) {
        return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
      }
    }

    const events = await prisma.clockEvent.findMany({
      where: {
        businessId,
        ...(requestedUserId ? { userId: requestedUserId } : {}),
        at: { gte: from, lte: to },
      },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    })

    const byUser = new Map<string, ClockEventLike[]>()
    for (const e of events) {
      const list = byUser.get(e.userId)
      if (list) list.push(e)
      else byUser.set(e.userId, [e])
    }

    const names = new Map<string, string>()
    if (targetUser) {
      names.set(targetUser.id, targetUser.name)
    }
    const missing = [...byUser.keys()].filter(id => !names.has(id))
    if (missing.length > 0) {
      const users = await prisma.user.findMany({
        where: { businessId, id: { in: missing } },
        select: { id: true, name: true },
      })
      for (const u of users) names.set(u.id, u.name)
    }

    const now = new Date()
    const users = [...byUser.entries()].map(([userId, evs]) => ({
      userId,
      name: names.get(userId) ?? "Usuario eliminado",
      events: evs,
      jornadas: deriveJornadas(evs, now),
    }))
    // El detalle de un usuario pedido sale aunque no tenga eventos; la vista
    // de negocio (admin, sin userId) solo lista a quien sí checó en el rango.
    if (targetUser && !byUser.has(targetUser.id)) {
      users.push({ userId: targetUser.id, name: targetUser.name, events: [], jornadas: [] })
    }
    users.sort((a, b) => a.name.localeCompare(b.name, "es"))

    return NextResponse.json(
      { period: { from: businessDayKey(from), to: businessDayKey(to) }, users },
      { headers: NO_STORE }
    )
  } catch (error) {
    return businessFailure(error)
  }
}
