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
  it("blocks exhausted account keys and expires the window", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-11T12:00:00Z"))
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(checkAndRecord("test", "account", 1000, 2)).toBe(true)
  })
})
