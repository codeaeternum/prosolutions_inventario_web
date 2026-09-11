import { isIP } from "node:net"
const store = new Map<string, { attempts: number; expires: number }>()
const WINDOW_MS = 15 * 60 * 1000
const MAX_KEYS = 10000

/** Single desktop process limiter. Expired keys are removed; saturation fails closed. */
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
  if (store.size >= MAX_KEYS) return false
  store.set(key, { attempts: 1, expires: now + windowMs })
  return true
}

/** Only enable behind an exclusive proxy which overwrites X-Real-IP and blocks direct access. */
export function getClientIp(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "direct-clients"
  const ip = req.headers.get("x-real-ip")?.trim() ?? ""
  return isIP(ip) ? ip : "unknown"
}
