import { isIP } from "node:net"
import { createHash, timingSafeEqual } from "node:crypto"
const store = new Map<string, { attempts: number; expires: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_KEYS = 10000
// Al saturar el mapa se evicta este porcentaje de las llaves más viejas de una
// vez, para no pagar un barrido por cada request que llega con el mapa lleno.
const EVICTION_BATCH = Math.ceil(MAX_KEYS * 0.05)

// Bitácora en memoria de rechazos (429) por scope: vive en el proceso, así
// que se resetea con cada reinicio/deploy — observabilidad ligera para
// /platform/health, no persistencia.
const deniedLog = new Map<string, number[]>()
const DENIED_WINDOW_MS = 24 * 60 * 60 * 1000
// Techo por scope para que un flood sostenido no infle la memoria del mapa.
const MAX_DENIED_STAMPS = 10000

function recordDenied(scope: string, now: number) {
  const stamps = (deniedLog.get(scope) ?? []).filter(t => now - t < DENIED_WINDOW_MS)
  if (stamps.length < MAX_DENIED_STAMPS) stamps.push(now)
  deniedLog.set(scope, stamps)
}

export interface RateLimitStats {
  /** Respuestas 429 servidas en las últimas 24 h (memoria del proceso). */
  deniedLast24h: number
  /** Desglose por scope del limiter ("platform-business-update", "login", …). */
  byRoute: Record<string, number>
}

/** Conteo de 429 servidas en las últimas 24 h, agregado por scope. */
export function getRateLimitStats(): RateLimitStats {
  const now = Date.now()
  const byRoute: Record<string, number> = {}
  let deniedLast24h = 0
  for (const [scope, stamps] of deniedLog) {
    const live = stamps.filter(t => now - t < DENIED_WINDOW_MS)
    if (live.length === 0) {
      deniedLog.delete(scope)
      continue
    }
    deniedLog.set(scope, live)
    byRoute[scope] = live.length
    deniedLast24h += live.length
  }
  return { deniedLast24h, byRoute }
}

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
    if (current.attempts >= maxAttempts) {
      recordDenied(prefix, now)
      return false
    }
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
 * Consulta si la llave sigue dentro del límite sin incrementar intentos.
 * Úsalo junto con `recordFailure` cuando un intento exitoso no debe quemar
 * presupuesto del usuario (p. ej. login-account).
 */
export function checkOnly(prefix: string, identifier: string, maxAttempts = 10): boolean {
  const now = Date.now()
  for (const [key, value] of store) if (value.expires <= now) store.delete(key)
  const current = store.get(`${prefix}:${identifier}`)
  if (current && current.attempts >= maxAttempts) {
    recordDenied(prefix, now)
    return false
  }
  return true
}

/** Registra un intento fallido en el bucket de rate-limit. */
export function recordFailure(prefix: string, identifier: string, windowMs = WINDOW_MS): void {
  const now = Date.now()
  for (const [key, value] of store) if (value.expires <= now) store.delete(key)
  const key = `${prefix}:${identifier}`
  const current = store.get(key)
  if (current) {
    current.attempts++
    return
  }
  if (store.size >= MAX_KEYS) {
    let evicted = 0
    for (const oldest of store.keys()) {
      if (evicted >= EVICTION_BATCH || store.size < MAX_KEYS) break
      store.delete(oldest)
      evicted++
    }
  }
  store.set(key, { attempts: 1, expires: now + windowMs })
}

/**
 * Registra un fallo con backoff exponencial, pensado para el bucket por
 * par (IP, cuenta) del login. A diferencia de `recordFailure` — que fija la
 * ventana una sola vez en el primer fallo — aquí cada intento rearma el
 * vencimiento con una ventana que se duplica por ciclo de `stepAttempts`
 * acumulados: 15 min → 30 min → 1 h → 2 h… hasta `maxWindowMs`. Un atacante
 * que insiste sobre un bloqueo propio estira SU castigo sin tocar el bucket
 * de la víctima; el usuario legítimo tras su ventana base vuelve a entrar.
 * El bloqueo lo decide `checkOnly` (attempts >= max): los intentos ya
 * bloqueados también pasan por aquí para seguir escalando la ventana.
 */
export function recordFailureBackoff(
  prefix: string,
  identifier: string,
  baseWindowMs: number,
  stepAttempts: number,
  maxWindowMs: number,
): void {
  const now = Date.now()
  for (const [key, value] of store) if (value.expires <= now) store.delete(key)
  const key = `${prefix}:${identifier}`
  const current = store.get(key)
  if (!current && store.size >= MAX_KEYS) {
    let evicted = 0
    for (const oldest of store.keys()) {
      if (evicted >= EVICTION_BATCH || store.size < MAX_KEYS) break
      store.delete(oldest)
      evicted++
    }
  }
  const attempts = (current?.attempts ?? 0) + 1
  const cycle = Math.floor((attempts - 1) / stepAttempts)
  const windowMs = Math.min(baseWindowMs * 2 ** cycle, maxWindowMs)
  store.set(key, { attempts, expires: now + windowMs })
}

// ─── Lockout de login (lo consume authorize() en auth.ts) ─────────────────
// El contador de fallos vive por par (IP, identificador): un atacante que
// fuerza fallos contra una cuenta ajena solo llena SU bucket — comparte IP
// consigo, no con la víctima, que conserva sus intentos desde su propia IP.
// Antes la llave era solo el identificador: N fallos por ventana bastaban
// para mantener bloqueada la cuenta de otro (lockout DoS).
const LOGIN_SCOPE_PAIR = "login-account-ip"
const LOGIN_SCOPE_ACCOUNT = "login-account"
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILURES = 10 // por par (IP, identificador)
// Techo por cuenta sumando todas las IPs: más alto que el del par para que
// un solo atacante no alcance a bloquear a la víctima, pero un stuffing
// distribuido (>50 fallos/ventana desde IPs distintas) sí se detenga. Su
// ventana expira sola — los intentos bloqueados no la rearman.
const LOGIN_ACCOUNT_MAX_FAILURES = 50
// Techo del backoff exponencial del par bloqueado (ver recordFailureBackoff):
// cada ciclo de LOGIN_MAX_FAILURES duplica la ventana (15 min → 4 h máx).
const LOGIN_MAX_LOCKOUT_MS = 4 * 60 * 60 * 1000

/**
 * Llave del bucket por par (IP, cuenta): sha256 para no duplicar el
 * identificador en claro en las llaves del mapa en memoria.
 */
export function loginPairKey(ip: string, rateKey: string): string {
  return createHash("sha256").update(`${ip}\n${rateKey}`).digest("hex").slice(0, 32)
}

/**
 * ¿Puede intentarse el login con esta IP + identificador? Se evalúa el par
 * primero: insistir sobre un par ya bloqueado rearma su ventana con backoff
 * exponencial (castigo solo del atacante); el bucket de la cuenta no se
 * rearma en intentos bloqueados — si se rearmara, un solo atacante podría
 * mantener a la víctima fuera indefinidamente.
 */
export function loginAttemptAllowed(ip: string, rateKey: string): boolean {
  const pairKey = loginPairKey(ip, rateKey)
  if (!checkOnly(LOGIN_SCOPE_PAIR, pairKey, LOGIN_MAX_FAILURES)) {
    recordFailureBackoff(LOGIN_SCOPE_PAIR, pairKey, LOGIN_WINDOW_MS, LOGIN_MAX_FAILURES, LOGIN_MAX_LOCKOUT_MS)
    return false
  }
  return checkOnly(LOGIN_SCOPE_ACCOUNT, rateKey, LOGIN_ACCOUNT_MAX_FAILURES)
}

/** Registra un fallo real de credenciales en ambos buckets (par + cuenta). */
export function recordLoginFailure(ip: string, rateKey: string): void {
  recordFailureBackoff(LOGIN_SCOPE_PAIR, loginPairKey(ip, rateKey), LOGIN_WINDOW_MS, LOGIN_MAX_FAILURES, LOGIN_MAX_LOCKOUT_MS)
  recordFailure(LOGIN_SCOPE_ACCOUNT, rateKey, LOGIN_WINDOW_MS)
}

// Aviso único por proceso: sin TRUST_PROXY_SECRET los headers de proxy se
// honran de CUALQUIER peer que alcance el origen (la app también se publica
// en LAN :3005 para el taller) — se advierte una sola vez, no por request.
let warnedNoProxySecret = false

/**
 * ¿El request demuestra haber pasado por el proxy exclusivo? Con
 * TRUST_PROXY_SECRET configurado, los headers de IP solo se honran cuando el
 * request trae `x-origin-secret` === TRUST_PROXY_SECRET. Ese header lo
 * inyecta una Transform Rule de Cloudflare (manual, documentada en
 * .env.docker.example) y cloudflared lo reenvía al origen: un cliente que
 * entra directo (LAN, puerto publicado, tailnet) no lo conoce.
 * Comparación timing-safe, mismo patrón que CRON_SECRET en /api/cron/*.
 */
function hasProxySecret(req: Request): boolean {
  const expected = process.env.TRUST_PROXY_SECRET
  if (!expected) return false
  const provided = req.headers.get("x-origin-secret") ?? ""
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  return a.length === b.length && timingSafeEqual(a, b)
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
 *
 * Gate por secreto (TRUST_PROXY_SECRET): la app también responde en la LAN
 * del taller (:3005), donde cualquier peer puede mandar CF-Connecting-IP
 * falso y abrir un bucket nuevo por request — esquivar el límite y además
 * sembrar la IP falsa en auditoría. Con el secreto configurado, los headers
 * de IP SOLO cuentan si el request trae `x-origin-secret` válido; un peer
 * sin él cae al bucket compartido "direct-clients" (Next standalone no
 * expone la IP del socket, así que sin headers confiables no hay IP real:
 * mejor un bucket apretado compartido que buckets infinitos por spoof).
 * Sin el secreto configurado se conserva el comportamiento anterior y se
 * avisa una vez al primer uso.
 * Sin el flag (acceso directo, dev) todos los buckets comparten
 * "direct-clients": un header forjado nunca abre un bucket nuevo.
 */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "direct-clients"
  if (process.env.TRUST_PROXY_SECRET) {
    if (!hasProxySecret(req)) return "direct-clients"
  } else if (!warnedNoProxySecret) {
    warnedNoProxySecret = true
    console.warn(
      "[rate-limit] TRUST_PROXY_HEADERS=true sin TRUST_PROXY_SECRET: cualquier " +
      "cliente que alcance el origen (incluida la LAN :3005) puede forjar " +
      "CF-Connecting-IP/X-Forwarded-For y abrir buckets infinitos. Configura " +
      "TRUST_PROXY_SECRET + la Transform Rule de Cloudflare documentada en " +
      ".env.docker.example."
    )
  }
  const cfIp = req.headers.get("cf-connecting-ip")?.trim() ?? ""
  if (isIP(cfIp)) return cfIp
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
  if (isIP(forwarded)) return forwarded
  const realIp = req.headers.get("x-real-ip")?.trim() ?? ""
  return isIP(realIp) ? realIp : "unknown"
}
