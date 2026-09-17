import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { platformDirectoryStats } from "@/lib/platform"

/**
 * GET /api/platform/directory-stats — Consola Reficio (solo superadmin).
 *
 * Telemetría del directorio público /mercado en los últimos 30 días:
 * totales de búsquedas/clicks/solicitudes, términos más buscados, vitrinas
 * más visitadas y eventos por día para el mini-gráfico del dashboard.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const stats = await platformDirectoryStats(30)

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
