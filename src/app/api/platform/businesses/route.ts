import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { listPlatformBusinesses } from "@/lib/platform"

/**
 * GET /api/platform/businesses — Consola Reficio (solo superadmin).
 *
 * Lista TODAS las empresas de la instancia con conteos de sus recursos
 * (usuarios, productos, órdenes, ventas, sucursales), ventas acumuladas
 * (suma de Sale.total en ventas COMPLETED) y última actividad operativa.
 * Sin datos sensibles: no incluye correos ni teléfonos de usuarios.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const businesses = await listPlatformBusinesses()

    return NextResponse.json(
      { businesses },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[platform] Error listando empresas:", error)
    return NextResponse.json(
      { error: "Error al listar las empresas" },
      { status: 500 }
    )
  }
}
