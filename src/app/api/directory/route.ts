import { NextResponse } from "next/server"
import { listDirectoryBusinesses } from "@/lib/directory"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

// GET /api/directory — Directorio público global: todos los negocios activos
// que optaron por aparecer (showInDirectory). Sin auth: solo campos que ya son
// públicos en la vitrina /<slug> (nunca emails, teléfonos de usuarios ni datos
// internos).
//
// Cacheable en CDN: el directorio cambia poco y se tolera un minuto de atraso.
const CACHE = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
} as const

// Límite generoso contra scraping (el CDN absorbe el tráfico normal).
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 60

export async function GET(req: Request) {
  try {
    if (!checkAndRecord("directory", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Intenta de nuevo en un minuto." },
        { status: 429, headers: { "Cache-Control": "no-store" } },
      )
    }

    const businesses = await listDirectoryBusinesses()
    return NextResponse.json({ businesses }, { headers: CACHE })
  } catch (error) {
    console.error("[directory] Error al listar negocios:", error)
    return NextResponse.json(
      { error: "No pudimos cargar el directorio. Intenta más tarde." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
