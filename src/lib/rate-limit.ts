/**
 * Rate limiter en memoria (una instancia = un proceso).
 * Útil para limitar intentos de login/registro por IP.
 * En múltiples instancias (varios pods) usar un store externo (Redis/Upstash).
 */

const store = new Map<string, number[]>() // key -> timestamps de intentos
const WINDOW_MS = 15 * 60 * 1000 // 15 minutos

function getKey(prefix: string, ip: string): string {
  return `${prefix}:${ip}`
}

/** Limpia intentos fuera de la ventana y devuelve cuántos quedan */
function pruneAndCount(key: string, windowMs: number): number {
  const now = Date.now()
  const timestamps = store.get(key) ?? []
  const valid = timestamps.filter((t) => now - t < windowMs)
  store.set(key, valid)
  return valid.length
}

/**
 * Registra un intento y devuelve true si está dentro del límite, false si debe bloquearse.
 * @param prefix - Ej: "login" o "register"
 * @param ip - IP del cliente
 * @param windowMs - Ventana en ms (ej. 15 * 60 * 1000)
 * @param maxAttempts - Máximo de intentos en la ventana
 */
export function checkAndRecord(
  prefix: string,
  ip: string,
  windowMs: number = WINDOW_MS,
  maxAttempts: number = 10
): boolean {
  const key = getKey(prefix, ip)
  const count = pruneAndCount(key, windowMs)
  if (count >= maxAttempts) return false
  const timestamps = store.get(key) ?? []
  timestamps.push(Date.now())
  store.set(key, timestamps)
  return true
}

/**
 * Obtiene la IP del cliente desde headers (proxy/Cloudflare) o conexión.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp.trim()
  return "unknown"
}
