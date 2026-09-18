import { isIP } from "node:net"
const store = new Map<string, { attempts: number; expires: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_KEYS = 10000
// Al saturar el mapa se evicta este porcentaje de las llaves más viejas de una
// vez, para no pagar un barrido por cada request que llega con el mapa lleno.
const EVICTION_BATCH = Math.ceil(MAX_KEYS * 0.05)

/**
 * Single desktop process limiter. Expired keys are removed on each call.
 * Fail-open on saturation: a full Map must not take down login/signup for
 * everyone, so the oldest keys are evicted to make room instead of rejecting.
 */
export function checkAndRecord(prefix: string, identifier: string, windowMs = WINDOW_MS, maxAttempts = 10): boolean {
  const now = Date.now()
  for (const [key, value] of store) if (value.expires <= now) store.delete(key)
  const key = `${prefix}:${identifier}`
  const current = store.get(key)
  if (current) {
    if (current.attempts >= maxAttempts) return false
    current.attempts++
    return true
  }
  if (store.size >= MAX_KEYS) {
    // Map preserva orden de inserción: los primeros son los más viejos.
    let evicted = 0
    for (const oldest of store.keys()) {
      if (evicted >= EVICTION_BATCH || store.size < MAX_KEYS) break
      store.delete(oldest)
      evicted++
    }
  }
  store.set(key, { attempts: 1, expires: now + windowMs })
  return true
}

/**
 * IP del cliente para rate limiting. Solo confía en headers de proxy cuando
 * TRUST_PROXY_HEADERS === "true" — actívalo únicamente detrás de un proxy
 * exclusivo que los sobrescribe y bloquea el acceso directo.
 *
 * Producción (reficio.app) va siempre tras Cloudflare Tunnel: cloudflared
 * reescribe `CF-Connecting-IP` y `X-Forwarded-For` con la IP real del
 * visitante, pero NO escribe `X-Real-IP`. Orden de preferencia:
 *   1. `CF-Connecting-IP` — lo fija Cloudflare; el cliente no lo puede forjar
 *      cuando el origen solo es alcanzable vía el tunnel.
 *   2. Primer IP de `X-Forwarded-For` — la cadena proxy; el primer valor es el
 *      cliente original según Cloudflare.
 *   3. `X-Real-IP` — proxies clásicos (nginx) que sí lo sobrescriben.
 * Sin el flag (acceso directo, dev) todos los buckets comparten
 * "direct-clients": un header forjado nunca abre un bucket nuevo.
 */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "direct-clients"
  const cfIp = req.headers.get("cf-connecting-ip")?.trim() ?? ""
  if (isIP(cfIp)) return cfIp
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
  if (isIP(forwarded)) return forwarded
  const realIp = req.headers.get("x-real-ip")?.trim() ?? ""
  return isIP(realIp) ? realIp : "unknown"
}
