import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/platform/businesses — Consola Reficio (solo superadmin).
 *
 * Lista TODAS las empresas de la instancia con el conteo de sus recursos
 * principales. Es la semilla de la futura consola de plataforma: de momento
 * solo lectura, sin datos sensibles (sin correos ni teléfonos de usuarios).
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const businesses = await prisma.business.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            users: true,
            products: true,
            repairOrders: true,
            sales: true,
          },
        },
      },
    })

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
