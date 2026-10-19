import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { fetchActivityFeed, parseDateParam, type ActivityItem } from "@/lib/activity"
import { csvCell } from "@/lib/csv"

/**
 * GET /api/activity/export — la misma bitácora de /api/activity como CSV
 * descargable (solo ADMIN). Mismos filtros menos paginación: actorId, source,
 * entity, from, to, q. Tope duro de 2000 filas (las más recientes del merge).
 * La convención de archivo sigue a /api/export: celdas siempre entre comillas
 * con comillas internas duplicadas, BOM UTF-8 para Excel y \r\n por fila.
 * csvCell (lib/csv, compartida con /api/export) neutraliza CSV-injection.
 */

const MAX_ROWS = 2000

const SOURCE_LABELS: Record<ActivityItem["source"], string> = {
  audit: "Edición",
  operation: "Operación",
  repair: "Taller",
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrador",
  EMPLOYEE: "Empleado",
  WORKSHOP: "Taller aliado",
  CUSTOMER: "Cliente",
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvCell).join(",")]
  for (const row of rows) lines.push(row.map(csvCell).join(","))
  // BOM para que Excel respete UTF-8 (acentos, ñ)
  return "\uFEFF" + lines.join("\r\n")
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const sp = new URL(req.url).searchParams
    const sourceParam = sp.get("source")?.trim()

    const feed = await fetchActivityFeed({
      businessId,
      actorId: sp.get("actorId"),
      source: sourceParam === "audit" || sourceParam === "operation" || sourceParam === "repair" ? sourceParam : null,
      entity: sp.get("entity"),
      q: sp.get("q"),
      from: parseDateParam(sp.get("from"), "start"),
      to: parseDateParam(sp.get("to"), "end"),
      take: MAX_ROWS,
      // Lee el tope por fuente para que el merge recorte a las 2000 más
      // recientes entre las tres fuentes (con q/entity el filtro corre en
      // memoria y puede quedar por debajo del tope, igual que en el feed).
      perSource: MAX_ROWS,
      // Sin lista de actores: cada fila ya trae nombre y rol del actor.
      withActors: false,
    })

    const headers = ["fecha", "empleado", "rol", "fuente", "accion", "resumen", "entidad", "cambios"]
    const rows = feed.items.map(item => [
      item.createdAt,
      item.actorName,
      ROLE_LABELS[item.actorRole] ?? item.actorRole,
      SOURCE_LABELS[item.source] ?? item.source,
      item.label,
      item.summary,
      item.entity ?? "",
      item.changes && item.changes.length > 0 ? JSON.stringify(item.changes) : "",
    ])

    const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    return new NextResponse(toCsv(headers, rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="actividad-${yyyymmdd}.csv"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    return businessFailure(error)
  }
}
