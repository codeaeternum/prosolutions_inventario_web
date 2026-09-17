import { NextResponse } from "next/server"
import { DIRECTORY_SEARCH_LIMIT, DIRECTORY_SEARCH_MIN } from "@/lib/directory"
import { recordDirectoryEvent } from "@/lib/directory-events"
import { browseDirectoryProducts } from "@/lib/directory-filters"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

// GET /api/directory/products?q=&cat= — Búsqueda pública de productos a
// través de TODAS las empresas del directorio (isActive && showInDirectory).
// Solo productos que la vitrina ya mostraría: isActive && marketplaceVisible
// (la misma flag de /<slug>/market). Se exponen nombre, precio de menudeo,
// imagen, disponibilidad binaria y el negocio (nombre + slug) — nunca costos,
// mayoreo ni stock exacto.
//
// `cat` (nombre de Category) es opcional: solo limita a esa categoría — con
// q también presente filtra el texto dentro de ella, y sin q permite el
// browse por categoría sin escribir nada.
const CACHE = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 30

export async function GET(req: Request) {
  try {
    if (!checkAndRecord("directory-products", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas búsquedas. Intenta de nuevo en un minuto." },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      )
    }

    const params = new URL(req.url).searchParams
    const q = (params.get("q") ?? "").trim().slice(0, 60)
    const cat = (params.get("cat") ?? "").trim().slice(0, 80)

    // Sin categoría se exige el mínimo de caracteres (evita scrapear el
    // catálogo completo); con categoría basta el filtro para explorar.
    if (!cat && q.length < DIRECTORY_SEARCH_MIN) {
      return NextResponse.json(
        { products: [], limit: DIRECTORY_SEARCH_LIMIT, minChars: DIRECTORY_SEARCH_MIN },
        { headers: CACHE },
      )
    }

    const products = await browseDirectoryProducts(q, cat || null)

    // Telemetría: solo búsquedas con resultados (las vacías aportan poco y
    // el mínimo de caracteres ya filtra ruido). Fire-and-forget — nunca
    // bloquea ni rompe la respuesta.
    if (products.length > 0) {
      void recordDirectoryEvent("search", { query: q || cat })
    }

    return NextResponse.json({ products }, { headers: CACHE })
  } catch (error) {
    console.error("[directory] Error al buscar productos:", error)
    return NextResponse.json(
      { error: "No pudimos buscar productos. Intenta más tarde." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
