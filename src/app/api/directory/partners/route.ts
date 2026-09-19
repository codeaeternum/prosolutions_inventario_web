import { NextResponse } from "next/server"
import { requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

// GET /api/directory/partners — Directorio INTERNO de talleres reparadores:
// los negocios activos que aceptan recibir órdenes delegadas de captadores
// (SystemSettings["partner_intake_enabled"] = "true" en SU tenant). Lo usa la
// configuración del negocio captador para elegir a qué taller mandar equipos.
// Requiere staff autenticado — no es el directorio público de /api/directory.
//
// Solo expone id, nombre y slug: lo mínimo para poblar el selector.
export async function GET() {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(auth.session)

    // El propio negocio se excluye: un captador no puede ser su propio
    // taller reparador (el PATCH de settings también lo rechaza).
    const partners = await prisma.business.findMany({
      where: {
        isActive: true,
        id: { not: businessId },
        systemSettings: {
          some: { key: "partner_intake_enabled", value: "true" },
        },
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    })

    return NextResponse.json(
      { partners },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[directory] Error al listar talleres asociados:", error)
    return NextResponse.json(
      { error: "No pudimos cargar los talleres asociados. Intenta más tarde." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
