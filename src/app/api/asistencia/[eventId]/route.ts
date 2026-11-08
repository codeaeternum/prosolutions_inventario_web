import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { recordAudit, type AuditChanges } from "@/lib/audit"

const NO_STORE = { "Cache-Control": "private, no-store" } as const

// Corrección administrativa de UNA marca del checador: mover `at` (la hora
// real que debió registrar) o anotarla. `note` nullable = limpiar la nota.
const patchSchema = z
  .object({
    at: z.iso.datetime({ offset: true }).optional(),
    note: z.string().trim().max(280).nullable().optional(),
  })
  .refine(body => body.at !== undefined || body.note !== undefined, {
    message: "Nada que corregir: envía 'at' y/o 'note'.",
  })

// Hora legible en la zona del negocio para el resumen de la bitácora.
const mxDateTime = (instant: Date) =>
  instant.toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" })

/**
 * PATCH /api/asistencia/[eventId] — solo ADMIN del mismo tenant.
 *
 * Corrige la hora de una checada olvidada/errónea o le cambia la nota.
 * Coherencia de la secuencia IN→OUT: un IN no puede quedar DESPUÉS de su
 * OUT pareado (el primer evento posterior, cuando es OUT, es su pareja — el
 * derivador se lo asigna siempre, sea cierre <16 h o abandono) ni un OUT
 * ANTES de su IN pareado (el evento inmediatamente anterior, cuando es IN).
 * Cruzarse con eventos del mismo tipo es legal: el derivador re-pareja de
 * forma determinista y el admin puede arreglar la otra marca después.
 *
 * Todo cambio real queda en AuditEvent (hora anterior → nueva); un no-op
 * (mismos valores) responde 200 sin ensuciar la bitácora.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const { eventId } = await params
    const body = patchSchema.parse(await request.json())

    // El evento solo existe si es de ESTE negocio: un id ajeno o inventado
    // responde 404 igual, sin filtrar a qué tenant pertenece.
    const event = await prisma.clockEvent.findFirst({
      where: { id: eventId, businessId },
      include: { user: { select: { name: true } } },
    })
    if (!event) {
      return NextResponse.json({ error: "Marca de asistencia no encontrada" }, { status: 404 })
    }

    const now = new Date()
    let newAt: Date | null = null
    if (body.at !== undefined) {
      newAt = new Date(body.at)
      if (Number.isNaN(newAt.getTime())) {
        return NextResponse.json({ error: "La hora corregida no es válida." }, { status: 400 })
      }
      if (newAt.getTime() > now.getTime()) {
        return NextResponse.json({ error: "La marca corregida no puede quedar en el futuro." }, { status: 400 })
      }
    }

    // Solo cuando la hora se mueve de verdad hay que validar el orden.
    if (newAt && newAt.getTime() !== event.at.getTime()) {
      const events = await prisma.clockEvent.findMany({
        where: { businessId, userId: event.userId },
        orderBy: [{ at: "asc" }, { id: "asc" }],
      })
      const idx = events.findIndex(e => e.id === event.id)
      const prev = idx > 0 ? events[idx - 1] : null
      const next = idx >= 0 ? (events[idx + 1] ?? null) : null
      if (event.type === "IN" && next?.type === "OUT" && newAt.getTime() > next.at.getTime()) {
        return NextResponse.json(
          {
            error:
              "La entrada no puede quedar después de su salida registrada: primero corrige la marca de salida.",
          },
          { status: 409 }
        )
      }
      if (event.type === "OUT" && prev?.type === "IN" && newAt.getTime() < prev.at.getTime()) {
        return NextResponse.json(
          {
            error:
              "La salida no puede quedar antes de su entrada: primero corrige la marca de entrada.",
          },
          { status: 409 }
        )
      }
    }

    // Nota: undefined = no tocar; null o texto vacío = limpiar.
    const newNote = body.note === undefined ? undefined : body.note || null
    const atChanged = newAt !== null && newAt.getTime() !== event.at.getTime()
    const noteChanged = body.note !== undefined && newNote !== (event.note ?? null)

    const updated = await prisma.clockEvent.update({
      where: { id: event.id },
      data: {
        ...(atChanged ? { at: newAt! } : {}),
        ...(noteChanged ? { note: newNote } : {}),
      },
    })

    if (atChanged || noteChanged) {
      const tipoMarca = event.type === "IN" ? "entrada" : event.type === "OUT" ? "salida" : `marca ${event.type}`
      const changes: AuditChanges = {}
      const parts: string[] = []
      if (atChanged) {
        changes.hora = { before: event.at.toISOString(), after: newAt!.toISOString() }
        parts.push(`Hora de ${tipoMarca} ${mxDateTime(event.at)} → ${mxDateTime(newAt!)}`)
      }
      if (noteChanged) {
        changes.nota = {
          before: (event.note ?? null) as Prisma.InputJsonValue,
          after: (newNote ?? null) as Prisma.InputJsonValue,
        }
        parts.push("Nota de la marca actualizada")
      }
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "ASISTENCIA_UPDATE",
        entity: "asistencia",
        entityId: event.id,
        entityName: event.user.name,
        summary: `Corrigió la ${tipoMarca} de "${event.user.name}": ${parts.join(" · ")}`,
        changes,
      })
    }

    return NextResponse.json({ event: updated }, { headers: NO_STORE })
  } catch (error) {
    return businessFailure(error)
  }
}
