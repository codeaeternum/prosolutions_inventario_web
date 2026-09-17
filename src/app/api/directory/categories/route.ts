import { NextResponse } from "next/server"
import { listDirectoryCategories } from "@/lib/directory-filters"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

// GET /api/directory/categories — Categorías reales presentes en el catálogo
// público del directorio: distinct de Product.category.name sobre los mismos
// productos que /api/directory/products expone (isActive &&
// marketplaceVisible, de negocios isActive && showInDirectory), con conteo
// por categoría. Sin auth: solo nombres de categoría y conteos — datos que
// la vitrina /<slug>/market ya muestra.
//
// Cacheable en CDN: el catálogo cambia poco y se tolera un minuto de atraso.
const CACHE = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 60

export async function GET(req: Request) {
  try {
    if (!checkAndRecord("directory-categories", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Intenta de nuevo en un minuto." },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      )
    }

    const categories = await listDirectoryCategories()
    return NextResponse.json({ categories }, { headers: CACHE })
  } catch (error) {
    console.error("[directory] Error al listar categorías:", error)
    return NextResponse.json(
      { error: "No pudimos cargar las categorías. Intenta más tarde." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
