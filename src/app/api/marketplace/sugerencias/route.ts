import { NextResponse } from "next/server"
import { getSession, requireMarketplaceViewer } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { ALLY_CATALOG_LEVELS } from "@/lib/market-visibility"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

const MIN_CHARS = 2
const MAX_RESULTS = 10

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 60

// GET /api/marketplace/sugerencias?q=texto
// Búsqueda B2B en el catálogo de OTROS negocios: productos activos con
// marketVisibility ALLIES o PUBLIC, de negocios activos distintos al del
// caller. Alimenta la sugerencia de encargos y "Pedidos que hago" en
// /admin/mercado ("un aliado la tiene").
//
// Auth: staff aprobado de cualquier tenant o WORKSHOP aprobado
// (requireMarketplaceViewer). wholesalePrice sale solo porque todo caller
// válido es staff o aliado aprobado; jamás se expone a anónimos.
// `branchNames` = sucursales del proveedor con la pieza (solo nombres —
// nunca cantidades) y `available` es binario.
export async function GET(req: Request) {
  try {
    if (!checkAndRecord("marketplace-sugerencias", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas búsquedas. Intenta de nuevo en un minuto." },
        { status: 429, headers: { "Cache-Control": "no-store" } }
      )
    }

    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60)
    if (q.length < MIN_CHARS) {
      return NextResponse.json(
        { suggestions: [], minChars: MIN_CHARS },
        { headers: catalogResponseHeaders }
      )
    }

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        marketVisibility: { in: [...ALLY_CATALOG_LEVELS] },
        // Otros negocios activos — nunca el propio.
        business: { isActive: true, id: { not: businessId } },
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { barcode: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { name: "asc" },
      take: MAX_RESULTS,
      select: {
        id: true,
        name: true,
        retailPrice: true,
        wholesalePrice: true,
        stock: true,
        marketVisibility: true,
        business: { select: { id: true, name: true, slug: true } },
        stocks: {
          where: { quantity: { gt: 0 } },
          select: { branch: { select: { name: true, isActive: true } } },
        },
      },
    })

    const suggestions = products.map((p) => {
      const branchNames = p.stocks
        .filter((s) => s.branch.isActive)
        .map((s) => s.branch.name)
        .sort((a, b) => a.localeCompare(b, "es"))
      return {
        id: p.id,
        name: p.name,
        retailPrice: p.retailPrice,
        wholesalePrice: p.wholesalePrice,
        marketVisibility: p.marketVisibility,
        business: p.business,
        branchNames,
        available: p.stock > 0 || branchNames.length > 0,
      }
    })

    return NextResponse.json(
      { suggestions },
      { headers: catalogResponseHeaders }
    )
  } catch (error) {
    console.error("Error en sugerencias de mercado:", error)
    return NextResponse.json({ error: "Error al buscar sugerencias" }, { status: 500 })
  }
}
