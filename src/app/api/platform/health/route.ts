import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { getPlatformHealth } from "@/lib/platform-health"

/**
 * GET /api/platform/health — Consola Reficio (solo superadmin).
 *
 * Salud global de la instancia: conteos de empresas (activas, suspendidas,
 * visibles en el directorio), usuarios por tipo (staff, clientes,
 * pendientes de aprobación), ventas completadas con su ingreso acumulado,
 * órdenes de taller abiertas y volumen de la bitácora de plataforma.
 *
 * Todo es agregado cross-tenant a propósito: nunca expone datos de
 * negocios individuales ni de usuarios finales.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const health = await getPlatformHealth()
    return NextResponse.json(health, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    console.error("[platform] Error cargando la salud global:", error)
    return NextResponse.json(
      { error: "Error al cargar la salud de la plataforma" },
      { status: 500 }
    )
  }
}
