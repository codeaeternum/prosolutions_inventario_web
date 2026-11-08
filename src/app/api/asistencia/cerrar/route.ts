import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { recordAudit } from "@/lib/audit"

const NO_STORE = { "Cache-Control": "private, no-store" } as const

// Roles que operan el reloj: un CUSTOMER jamás tiene jornadas que corregir.
const STAFF_ROLES: readonly string[] = ["ADMIN", "EMPLOYEE", "WORKSHOP"]

const cerrarSchema = z.object({
  userId: z.string().min(1),
  outAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(280).optional(),
})

const mxDateTime = (instant: Date) =>
  instant.toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" })

/**
 * POST /api/asistencia/cerrar — solo ADMIN del mismo tenant.
 *
 * Cierra una jornada que quedó abierta o abandonada creando el OUT que la
 * persona olvidó marcar. El candidato es el IN sin pareja más ANTIGUO que
 * sea compatible con `outAt`:
 * - "Sin pareja" = el evento siguiente del usuario NO es OUT (un IN ya
 *   pareado no se puede volver a cerrar sin corregir antes su OUT).
 * - Compatible = IN.at ≤ outAt y ningún evento intermedio robaría la pareja
 *   al derivar jornadas (si existe evento posterior al IN, su `at` debe ser
 *   > outAt: de lo contrario el OUT nuevo se emparejaría con otra marca o
 *   quedaría huérfano).
 *
 * Si el par resultante supera 16 h se crea igual — el derivador lo seguirá
 * marcando openEnded y la corrección honesta es pedirle al admin una hora
 * válida, no rechazarla.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const body = cerrarSchema.parse(await request.json())

    const now = new Date()
    const outAt = new Date(body.outAt)
    if (Number.isNaN(outAt.getTime())) {
      return NextResponse.json({ error: "La hora de salida no es válida." }, { status: 400 })
    }
    if (outAt.getTime() > now.getTime()) {
      return NextResponse.json({ error: "La salida no puede quedar en el futuro." }, { status: 400 })
    }

    // Staff del tenant: un id ajeno, inexistente o de un cliente responde
    // 404 igual — no se filtra a quién pertenece la cuenta.
    const target = await prisma.user.findFirst({
      where: { id: body.userId, businessId },
      select: { id: true, name: true, role: true },
    })
    if (!target || !STAFF_ROLES.includes(target.role)) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    const events = await prisma.clockEvent.findMany({
      where: { businessId, userId: target.id },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    })

    let candidate: (typeof events)[number] | null = null
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      if (e.type !== "IN") continue
      const next = events[i + 1] ?? null
      // IN ya consumido por un OUT posterior: esa jornada ya tiene cierre.
      if (next?.type === "OUT") continue
      if (e.at.getTime() > outAt.getTime()) continue // cerrar antes de entrar no tiene sentido
      // Un evento intermedio a ≤ outAt se interpone: el OUT nuevo no
      // emparejaría con ESTE IN al derivarse.
      if (next && next.at.getTime() <= outAt.getTime()) continue
      candidate = e // el más antiguo compatible (events viene ordenado)
      break
    }

    if (!candidate) {
      return NextResponse.json(
        { error: "No hay una jornada abierta que cerrar con esa hora de salida." },
        { status: 409 }
      )
    }

    // La sucursal del OUT es la misma que la del IN que cierra: son una sola
    // jornada; el snapshot escalar ya lo documenta el schema.
    const event = await prisma.clockEvent.create({
      data: {
        businessId,
        userId: target.id,
        branchId: candidate.branchId ?? null,
        type: "OUT",
        at: outAt,
        note: body.note?.trim() || "Salida corregida por un administrador",
      },
    })

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "ASISTENCIA_CIERRE",
      entity: "asistencia",
      entityId: event.id,
      entityName: target.name,
      summary: `Cerró la jornada de "${target.name}": entrada ${mxDateTime(candidate.at)} → salida ${mxDateTime(outAt)}`,
      changes: {
        usuarioId: { before: null, after: target.id },
        salida: { before: null, after: outAt.toISOString() },
        entradaEvento: { before: null, after: candidate.id },
      },
    })

    return NextResponse.json({ event }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return businessFailure(error)
  }
}
