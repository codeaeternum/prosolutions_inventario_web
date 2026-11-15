import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { platformDirectoryStats } from "@/lib/platform"
import { checkAndRecord } from "@/lib/rate-limit"

/**
 * GET /api/platform/directory-stats — Consola Reficio (solo superadmin).
 *
 * Telemetría del directorio público /mercado: totales de búsquedas/clicks/
 * solicitudes, términos más buscados, vitrinas más visitadas y eventos por
 * día para el mini-gráfico del dashboard. `?days=` fija la ventana (7–90,
 * default 30) — la lib clampea a su máximo interno además de este.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  // Freno suave por operador: 120 lecturas por minuto.
  if (!checkAndRecord("platform-read", auth.session.user.id, 60 * 1000, 120)) {
    return NextResponse.json(
      { error: "Demasiadas consultas, espera un momento" },
      { status: 429, headers: { "Retry-After": "60" } }
    )
  }

  try {
    const raw = Number(new URL(req.url).searchParams.get("days") ?? "30")
    const days = Number.isFinite(raw) ? Math.min(90, Math.max(7, Math.trunc(raw))) : 30
    const stats = await platformDirectoryStats(days)

    return NextResponse.json(
      { stats },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[platform] Error leyendo métricas del directorio:", error)
    return NextResponse.json(
      { error: "Error al cargar las métricas del directorio" },
      { status: 500 }
    )
  }
}
