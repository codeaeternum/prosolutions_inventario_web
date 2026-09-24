import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { fetchActivityFeed, parseCursor, parseDateParam } from "@/lib/activity"

export type { ActivityItem } from "@/lib/activity"

/**
 * GET /api/activity — bitácora unificada "quién hizo qué" (solo ADMIN).
 * El núcleo (merge de AuditEvent + BusinessOperation + RepairEvent,
 * etiquetas, filtros y paginación por cursor) vive en src/lib/activity.ts y
 * lo comparte el export CSV de /api/activity/export.
 *
 * Filtros: actorId, source (audit|operation|repair), entity (tipo de
 * entidad — "sale", "product", "repair"…), from, to, q, cursor, take.
 * Devuelve { items, nextCursor, actors, entities } — `entities` lista los
 * tipos de entidad presentes para poblar el filtro de la UI.
 */

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const sp = new URL(req.url).searchParams
    const sourceParam = sp.get("source")?.trim()
    const takeParam = Number(sp.get("take") ?? "50")
    const take = Math.min(100, Math.max(1, Number.isFinite(takeParam) ? Math.trunc(takeParam) : 50))

    const feed = await fetchActivityFeed({
      businessId,
      actorId: sp.get("actorId"),
      source: sourceParam === "audit" || sourceParam === "operation" || sourceParam === "repair" ? sourceParam : null,
      entity: sp.get("entity"),
      q: sp.get("q"),
      from: parseDateParam(sp.get("from"), "start"),
      to: parseDateParam(sp.get("to"), "end"),
      cursor: parseCursor(sp.get("cursor")),
      take,
    })

    return NextResponse.json(
      { items: feed.items, nextCursor: feed.nextCursor, actors: feed.actors, entities: feed.entities },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}
