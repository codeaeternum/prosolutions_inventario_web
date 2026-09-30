import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getTurnos } from "@/lib/turnos"
import { businessFailure } from "@/lib/domain/http"

// GET /api/actividad/turnos?dias=14 — turnos derivados de la actividad real:
// primer→último movimiento de cada empleado por día del negocio. Solo admin.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)
    const dias = Math.min(60, Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 14))
    const turnos = await getTurnos(businessId, dias)
    return NextResponse.json({ turnos }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}
