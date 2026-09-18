import { afterEach, describe, expect, it, vi } from "vitest"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
describe("login throttling", () => {
  it("does not trust user supplied forwarding headers on desktop/direct access", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false")
    expect(getClientIp(new Request("https://app.invalid", { headers: { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" } }))).toBe("direct-clients")
  })
  it("trusts only explicitly configured overwritten real IP and validates it", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true")
    expect(getClientIp(new Request("https://app.invalid", { headers: { "x-real-ip": "5.6.7.8", "x-forwarded-for": "attacker" } }))).toBe("5.6.7.8")
    expect(getClientIp(new Request("https://app.invalid", { headers: { "x-real-ip": "random" } }))).toBe("unknown")
  })
  it("prefers CF-Connecting-IP behind Cloudflare Tunnel, then first X-Forwarded-For", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true")
    // cloudflared escribe CF-Connecting-IP + X-Forwarded-For; nunca X-Real-IP.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.1.1.1", "x-real-ip": "10.2.2.2" },
    }))).toBe("203.0.113.9")
    // Sin CF-Connecting-IP cae al primer IP de X-Forwarded-For.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "x-forwarded-for": "198.51.100.7, 172.16.0.1, 10.0.0.1", "x-real-ip": "10.2.2.2" },
    }))).toBe("198.51.100.7")
    // CF-Connecting-IP inválido no cuenta: se sigue la cadena de fallbacks.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "forjado", "x-forwarded-for": "198.51.100.8" },
    }))).toBe("198.51.100.8")
    // IPv6 también se acepta como IP válida.
    expect(getClientIp(new Request("https://app.invalid", {
      headers: { "cf-connecting-ip": "2001:db8::1" },
    }))).toBe("2001:db8::1")
  })
  it("blocks exhausted account keys and expires the window", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
  })
  it("fails open under saturation: a full store evicts the oldest instead of blocking login", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    // Llenar el mapa hasta MAX_KEYS (10000) con llaves vivas de un solo prefijo.
    for (let i = 0; i < 10000; i++) {
      expect(checkAndRecord("flood", `attacker-${i}`, 60_000, 5)).toBe(true)
    }
    // Con el mapa lleno, una llave NUEVA (otro usuario) no debe recibir false:
    // la víctima no paga el flood del atacante.
    expect(checkAndRecord("login", "victima-legitima", 60_000, 5)).toBe(true)
    // La evicción es por lote: entran varias llaves nuevas sin quedarse a medias.
    expect(checkAndRecord("register", "otro-usuario", 60_000, 5)).toBe(true)
  })
})
