import { auth } from "@/lib/auth"
import { getAuthRedirect } from "@/lib/auth.config"
import { NextResponse } from "next/server"
import type { NextFetchEvent, NextRequest } from "next/server"

// --- Barrera anti-CSRF para /api/* (Origin + Fetch Metadata) ------------------
// Solo métodos que mutan estado. GET/HEAD son lecturas (cada route valida su
// propia autorización) y OPTIONS es el preflight CORS del navegador — bloquearlo
// rompería cualquier CORS legítimo futuro.
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// Prefijos /api exentos de la barrera de origen:
//  · /api/auth/ → Auth.js valida su propio CSRF (csrfToken + state cookie) y
//    algunos flujos llegan como form-post del IdP. El prefijo cubre también
//    register/password-reset/switch: sin sesión no hay cookie que montar, y
//    SameSite=Lax ya impide que un POST cross-site viaje con sesión.
//  · /api/cron/ y /api/reservations/check-expiring → se autentican con
//    CRON_SECRET (Authorization: Bearer / x-cron-secret, timingSafeEqual), no
//    con cookies: el CSRF es imposible y un scheduler externo podría mandar un
//    Origin propio.
// Todo lo demás (sales, users, asistencia, signup, reservations, evidencia…)
// queda protegido: la app solo los llama same-origin.
const ORIGIN_EXEMPT_PREFIXES = ["/api/auth/", "/api/cron/", "/api/reservations/check-expiring"]

// Hosts cuyo Origin se acepta: el propio de la request (incluye puerto en dev),
// el de NEXTAUTH_URL (URL pública canónica — cubre requests que entran por un
// host interno pero traen el Origin público) y ALLOWED_ORIGINS en CSV.
function allowedOriginHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>()
  const own = req.headers.get("host") ?? req.nextUrl.host
  if (own) hosts.add(own.toLowerCase())
  try {
    if (process.env.NEXTAUTH_URL) hosts.add(new URL(process.env.NEXTAUTH_URL).host.toLowerCase())
  } catch { /* NEXTAUTH_URL malformada no tumba la barrera */ }
  for (const entry of (process.env.ALLOWED_ORIGINS ?? "").split(",")) {
    const value = entry.trim()
    if (!value) continue
    try {
      hosts.add(new URL(value).host.toLowerCase())
    } catch {
      // También admite hosts pelados: "preview.example.com:8443"
      if (/^[\w.-]+(:\d{1,5})?$/.test(value)) hosts.add(value.toLowerCase())
    }
  }
  return hosts
}

const forbiddenOrigin = () =>
  NextResponse.json(
    { error: "Origen no permitido" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  )

// Devuelve el 403 cuando la request /api es un mutable cross-site, o null si
// pasa. Función pura: solo Web APIs + process.env, corre sin wrapper auth.
function apiOriginDenied(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl
  if (!pathname.startsWith("/api/")) return null
  if (!MUTATING_METHODS.has(req.method)) return null
  if (ORIGIN_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null

  const origin = req.headers.get("origin")
  const referer = req.headers.get("referer")
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase()

  // Sin Origin, Referer ni Fetch-Metadata es un cliente no-navegador (curl,
  // server-to-server, cron interno): no puede montar CSRF con cookies.
  if (!origin && !referer && !fetchSite) return null

  // Fetch Metadata lo emite el navegador y JS no puede falsificarlo:
  // cross-site es rechazo directo aunque no haya Origin.
  if (fetchSite === "cross-site") return forbiddenOrigin()

  // Regla estricta: cuando Origin (o Referer de fallback) está presente, su
  // host debe estar en la allowlist SIEMPRE. Sec-Fetch-Site: same-site admite
  // subdominios y aquí no hay tenants en subdominios — un Origin de host
  // distinto no es confiable aunque el navegador lo etiquete same-site.
  const source = origin ?? referer
  if (!source) return null // solo quedaba un Sec-Fetch-Site same-*/none
  try {
    return allowedOriginHosts(req).has(new URL(source).host.toLowerCase()) ? null : forbiddenOrigin()
  } catch {
    return forbiddenOrigin() // "null" o header malformado → no confiable
  }
}
// ------------------------------------------------------------------------------

// Solo páginas/archivos pasan por auth(): resuelve sesión para req.auth.
const authHandler = auth((req) => {
  // Defensa en profundidad: la rama /api de proxy() ya aplica esta barrera
  // antes de auth; la dejamos aquí por si alguna request /api alcanzara el
  // wrapper (p. ej. un refactor futuro). Es barata: solo lectura de headers.
  const denied = apiOriginDenied(req)
  if (denied) return denied

  const pathname = req.nextUrl.pathname
  const lowerPathname = pathname.toLowerCase()
  // Intercept legacy public files BEFORE Next's static file handler, including file extensions.
  // Case-insensitive: filesystems that ignore case could otherwise serve the file statically.
  if (lowerPathname.startsWith("/uploads/payments/")) {
    if (!req.auth?.user || req.auth.user.status !== "APPROVED") return new NextResponse(null, { status: 401, headers: { "Cache-Control": "private, no-store" } })
    const target = req.nextUrl.clone()
    target.pathname = `/api/payment-proofs/${pathname.slice("/uploads/payments/".length)}`
    return NextResponse.rewrite(target)
  }
  // Proof images must never be cached or fetched without the authenticated file handler.
  if (lowerPathname === "/_next/image") {
    let imageUrl = req.nextUrl.searchParams.get("url") ?? ""
    try { imageUrl = decodeURIComponent(imageUrl).toLowerCase() } catch { return new NextResponse(null, { status: 400 }) }
    if (imageUrl.includes("/uploads/payments/") || imageUrl.includes("/api/payment-proofs/")) return new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store" } })
    return NextResponse.next()
  }
  const redirect = getAuthRedirect(req.auth, req.nextUrl)
  return redirect ?? NextResponse.next()
})

// /api/* nunca resuelve sesión aquí: cada route handler hace su propia auth,
// así que la barrera de origen corre como función pura y listo. El resto
// (páginas, /uploads/payments, /_next/image) va por authHandler → auth().
export function proxy(req: NextRequest, event: NextFetchEvent) {
  const pathname = req.nextUrl.pathname
  if (pathname.startsWith("/api/")) {
    // GET/HEAD/OPTIONS son lecturas o preflight CORS: la barrera actual ya
    // los deja pasar, así que ni siquiera evaluamos headers.
    if (!MUTATING_METHODS.has(req.method)) return NextResponse.next()
    return apiOriginDenied(req) ?? NextResponse.next()
  }
  return authHandler(req as never, event as never)
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*|icons|uploads).*)", "/api/:path*", "/uploads/payments/:path*", "/_next/image"],
}
