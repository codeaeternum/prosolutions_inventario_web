import { NextResponse } from "next/server"
import { requireModule } from "@/lib/api-auth"
import { checkAndRecord } from "@/lib/rate-limit"

// GET /api/settings/geocode?q= — Geocoding server-side contra Nominatim
// (OpenStreetMap) para ubicar el negocio en el mapa de /mercado. Solo el
// módulo configuración (la única pantalla que geocodifica): el cliente nunca
// llama Nominatim directo, así la política de uso de OSM (User-Agent
// identificable + volumen bajo) se cumple desde el servidor.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const USER_AGENT = "Reficio/1.0 (reficio.app)"
const TIMEOUT_MS = 8_000

// Nominatim pide <=1 req/s; con 15/min por negocio quedamos muy por debajo.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 15

const MIN_QUERY = 3
const MAX_QUERY = 200

const NO_STORE = { "Cache-Control": "private, no-store" } as const

export async function GET(req: Request) {
  try {
    const auth = await requireModule("configuracion")
    if (auth.error) return auth.error
    const businessId = auth.session.user.businessId

    if (!checkAndRecord("geocode", businessId, WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas búsquedas. Intenta de nuevo en un minuto." },
        { status: 429, headers: NO_STORE }
      )
    }

    const q = (new URL(req.url).searchParams.get("q") ?? "")
      .trim()
      .slice(0, MAX_QUERY)
    if (q.length < MIN_QUERY) {
      return NextResponse.json(
        { error: "Escribe una dirección más completa para ubicarla" },
        { status: 400, headers: NO_STORE }
      )
    }

    const url = new URL(NOMINATIM_URL)
    url.searchParams.set("format", "json")
    url.searchParams.set("limit", "1")
    url.searchParams.set("q", q)

    let res: Response
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Accept-Language": "es",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      })
    } catch (error) {
      // Timeout o red caída contra OSM: el usuario puede reintentar o pegar coords.
      console.error("[geocode] Nominatim no respondió:", error)
      return NextResponse.json(
        { error: "El servicio de mapas no respondió. Intenta de nuevo o pega las coordenadas." },
        { status: 502, headers: NO_STORE }
      )
    }

    if (!res.ok) {
      console.error(`[geocode] Nominatim respondió ${res.status}`)
      return NextResponse.json(
        { error: "El servicio de mapas no respondió. Intenta de nuevo o pega las coordenadas." },
        { status: 502, headers: NO_STORE }
      )
    }

    const results = await res.json().catch(() => null)
    const first = Array.isArray(results) ? results[0] : null
    const lat = Number(first?.lat)
    const lng = Number(first?.lon)
    if (!first || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: "No encontramos esa dirección. Prueba con más datos o pega el link de Google Maps." },
        { status: 404, headers: NO_STORE }
      )
    }

    return NextResponse.json(
      {
        lat,
        lng,
        displayName: typeof first.display_name === "string" ? first.display_name : "",
      },
      { headers: NO_STORE }
    )
  } catch (error) {
    console.error("[geocode] Error al geocodificar:", error)
    return NextResponse.json(
      { error: "No pudimos buscar la dirección. Intenta más tarde." },
      { status: 500, headers: NO_STORE }
    )
  }
}
