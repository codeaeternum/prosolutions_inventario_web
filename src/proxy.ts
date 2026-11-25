import { auth } from "@/lib/auth"
import { getAuthRedirect } from "@/lib/auth.config"
import { NextResponse } from "next/server"
import type { NextFetchEvent, NextRequest } from "next/server"

// --- x-request-id: correlación extremo a extremo ----------------------------
// Todo request sale con un x-request-id: el que venga del cliente/edge (si es
// sano: no vacío, máx 128 chars) o uno nuevo con crypto.randomUUID(). Se
// propaga en DOS lugares:
//   · request upstream — NextResponse.next/rewrite({ request: { headers } })
//     reescribe los headers que ve el route handler / server component (así
//     businessFailure y cualquier handler lo leen con req.headers/headers()).
//   · response — para que el cliente/edge y los logs del docker json-file se
//     puedan cruzar (el túnel de Cloudflare no lo genera por nosotros).
// La mutación de req.headers de ensureRequestId() hace que TODA derivación
// posterior dentro de la cadena del proxy vea el mismo id — incluido el clone
// del request que next-auth crea para el callback de auth (reqWithEnvURL copia
// headers). Los headers de un NextRequest son mutables en la práctica; el
// try/catch cubre el caso exótico en que no lo fueran (degrada a ids
// independientes por punto de respuesta, nunca a un 500).
const REQUEST_ID_HEADER = "x-request-id"

function ensureRequestId(req: NextRequest): string {
  const existing = req.headers.get(REQUEST_ID_HEADER)
  if (existing && existing.length <= 128) return existing
  const id = crypto.randomUUID()
  try { req.headers.set(REQUEST_ID_HEADER, id) } catch { /* headers inmutables: la respuesta igual queda sellada */ }
  return id
}

/** Headers del request clonados con el x-request-id garantizado (para upstream). */
function requestHeadersWithId(req: NextRequest): Headers {
  const headers = new Headers(req.headers)
  headers.set(REQUEST_ID_HEADER, ensureRequestId(req))
  return headers
}

/** Sella cualquier respuesta con el x-request-id del request y la devuelve. */
function stampWithId<T extends Response>(req: NextRequest, res: T): T {
  try { res.headers.set(REQUEST_ID_HEADER, ensureRequestId(req)) } catch { /* respuesta inmutable: no romper el request por telemetría */ }
  return res
}

/** NextResponse.next() con propagación del id en request (upstream) y response. */
function nextWithId(req: NextRequest): NextResponse {
  const res = NextResponse.next({ request: { headers: requestHeadersWithId(req) } })
  res.headers.set(REQUEST_ID_HEADER, ensureRequestId(req))
  return res
}
// ------------------------------------------------------------------------------

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

// Hosts cuyo Origin se acepta: el de NEXTAUTH_URL (URL pública canónica —
// cubre requests que entran por un host interno pero traen el Origin
// público), el origen LAN del taller y ALLOWED_ORIGINS en CSV.
// El Host de la request YA NO cuenta: en un DNS-rebinding el navegador
// mandaría Origin == Host del atacante y pasaría la barrera — la allowlist
// se deriva solo de configuración, nunca del propio request.
// Única excepción: fuera de producción (next dev, tests) se acepta el
// propio host para no romper el flujo local — el rebinding no aplica en
// loopback.
function allowedOriginHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>()
  if (process.env.NODE_ENV !== "production") {
    const own = req.headers.get("host") ?? req.nextUrl.host
    if (own) hosts.add(own.toLowerCase())
  }
  try {
    if (process.env.NEXTAUTH_URL) hosts.add(new URL(process.env.NEXTAUTH_URL).host.toLowerCase())
  } catch { /* NEXTAUTH_URL malformada no tumba la barrera */ }
  // Origen LAN del taller: la app se publica en http://<APP_BIND_IP>:3005
  // (bind del compose) y los formularios del taller postean con ese Origin.
  // APP_BIND_IP no viaja al contenedor como env: el default replica el del
  // compose (192.168.1.195); si cambia el bind hay que definir la env en el
  // contenedor o añadir el host a ALLOWED_ORIGINS.
  const lanIp = (process.env.APP_BIND_IP ?? "").trim().replace(/^\[|\]$/g, "") || "192.168.1.195"
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(lanIp)) {
    hosts.add(`${lanIp}:3005`)
  } else if (lanIp.includes(":")) {
    hosts.add(`[${lanIp}]:3005`) // IPv6 literal con puerto va entre corchetes
  }
  // Un APP_BIND_IP que no sea IP no abre ningún origen extra: un typo en la
  // env no debe convertirse en una entrada de la allowlist.
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

const forbiddenOrigin = (req: NextRequest) =>
  stampWithId(req, NextResponse.json(
    { error: "Origen no permitido" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  ))

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
  if (fetchSite === "cross-site") return forbiddenOrigin(req)

  // Regla estricta: cuando Origin (o Referer de fallback) está presente, su
  // host debe estar en la allowlist SIEMPRE. Sec-Fetch-Site: same-site admite
  // subdominios y aquí no hay tenants en subdominios — un Origin de host
  // distinto no es confiable aunque el navegador lo etiquete same-site.
  const source = origin ?? referer
  if (!source) return null // solo quedaba un Sec-Fetch-Site same-*/none
  try {
    return allowedOriginHosts(req).has(new URL(source).host.toLowerCase()) ? null : forbiddenOrigin(req)
  } catch {
    return forbiddenOrigin(req) // "null" o header malformado → no confiable
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
    if (!req.auth?.user || req.auth.user.status !== "APPROVED") return stampWithId(req, new NextResponse(null, { status: 401, headers: { "Cache-Control": "private, no-store" } }))
    const target = req.nextUrl.clone()
    target.pathname = `/api/payment-proofs/${pathname.slice("/uploads/payments/".length)}`
    return stampWithId(req, NextResponse.rewrite(target, { request: { headers: requestHeadersWithId(req) } }))
  }
  // Proof images must never be cached or fetched without the authenticated file handler.
  if (lowerPathname === "/_next/image") {
    let imageUrl = req.nextUrl.searchParams.get("url") ?? ""
    try { imageUrl = decodeURIComponent(imageUrl).toLowerCase() } catch { return stampWithId(req, new NextResponse(null, { status: 400 })) }
    if (imageUrl.includes("/uploads/payments/") || imageUrl.includes("/api/payment-proofs/")) return stampWithId(req, new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store" } }))
    return nextWithId(req)
  }
  const redirect = getAuthRedirect(req.auth, req.nextUrl)
  return redirect ? stampWithId(req, redirect) : nextWithId(req)
})

// /api/* nunca resuelve sesión aquí: cada route handler hace su propia auth,
// así que la barrera de origen corre como función pura y listo. El resto
// (páginas, /uploads/payments, /_next/image) va por authHandler → auth().
export async function proxy(req: NextRequest, event: NextFetchEvent) {
  ensureRequestId(req) // una sola vez por request: todas las ramas derivan el mismo id
  const pathname = req.nextUrl.pathname
  if (pathname.startsWith("/api/")) {
    // GET/HEAD/OPTIONS son lecturas o preflight CORS: la barrera actual ya
    // los deja pasar, así que ni siquiera evaluamos headers.
    if (!MUTATING_METHODS.has(req.method)) return nextWithId(req)
    return apiOriginDenied(req) ?? nextWithId(req)
  }
  // Sello central: cubre también los redirects que produce el callback
  // `authorized` de auth.config (esas respuestas no pasan por los helpers de
  // arriba) — las que ya traen el sello reciben el mismo valor, idempotente.
  // El `void` del tipo de authHandler es el fallback interno de next-auth
  // (nuestro callback siempre devuelve respuesta): el ?? solo satisface a TS.
  const res = await authHandler(req as never, event as never)
  return stampWithId(req, res ?? nextWithId(req))
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*|icons|uploads).*)", "/api/:path*", "/uploads/payments/:path*", "/_next/image"],
}
