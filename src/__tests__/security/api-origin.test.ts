import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ getAuthRedirect: vi.fn(), sessionHandler: vi.fn() }))
// auth(handler) devuelve el handler espiado: en producción envuelve la sesión;
// aquí además registra cuándo se ejecuta, para comprobar que /api nunca llega
// al handler con sesión (la barrera de origen corre antes, sin auth()).
vi.mock("@/lib/auth", () => ({
  auth: (arg?: unknown) => {
    if (typeof arg !== "function") return null
    mocks.sessionHandler.mockImplementation(arg as (req: unknown) => unknown)
    return mocks.sessionHandler
  },
}))
vi.mock("@/lib/auth.config", () => ({ getAuthRedirect: mocks.getAuthRedirect }))

import { proxy } from "@/proxy"

const run = (req: NextRequest): Response => (proxy as any)(req)
const request = (path: string, method = "POST", headers: Record<string, string> = {}) =>
  new NextRequest(`https://reficio.app${path}`, { method, headers })
const post = (path: string, headers: Record<string, string> = {}) => request(path, "POST", headers)

beforeEach(() => {
  mocks.getAuthRedirect.mockReturnValue(null)
  mocks.sessionHandler.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("API Origin/Fetch-Metadata barrier (CSRF)", () => {
  it("rejects a cross-site POST declaring both Origin and Sec-Fetch-Site", () => {
    const res = run(post("/api/sales", { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(403)
    expect(res.headers.get("cache-control")).toContain("no-store")
    return res.json().then((body) => expect(body.error).toBe("Origen no permitido"))
  })

  it("rejects a POST whose only signal is a foreign Origin", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = run(request("/api/users", method, { origin: "https://evil.com" }))
      expect(res.status).toBe(403)
    }
  })

  it("rejects Sec-Fetch-Site: cross-site even without an Origin header", () => {
    const res = run(post("/api/sales", { "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(403)
  })

  it("lets a same-host Origin through", () => {
    const res = run(post("/api/sales", { origin: "https://reficio.app", "sec-fetch-site": "same-origin" }))
    expect(res.status).toBe(200)
  })

  it("lets clients without Origin or Fetch-Metadata through (curl/server-to-server)", () => {
    const res = run(post("/api/sales"))
    expect(res.status).toBe(200)
  })

  it("lets Sec-Fetch-Site same-origin/same-site/none through when Origin is absent", () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      const res = run(post("/api/sales", { "sec-fetch-site": site }))
      expect(res.status).toBe(200)
    }
  })

  it("exempts NextAuth callbacks (Auth.js has its own CSRF checks)", () => {
    const res = run(post("/api/auth/callback/credentials", { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(200)
  })

  it("does not apply to read-only methods or CORS preflight", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const res = run(request("/api/sales", method, { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
      expect(res.status).toBe(200)
    }
  })

  it("exempts CRON_SECRET-protected cron endpoints", () => {
    const res = run(post("/api/cron/purge-events"))
    expect(res.status).toBe(200)
    // Y también con un Origin del propio scheduler (el secreto es la barrera real).
    const withOrigin = run(post("/api/reservations/check-expiring", { origin: "https://cron-job.org" }))
    expect(withOrigin.status).toBe(200)
  })

  it("rejects foreign subdomains even when Sec-Fetch-Site says same-site", () => {
    // same-site incluye subdominios, pero aquí no hay tenants en subdominios:
    // la regla Origin manda sobre Fetch Metadata.
    const res = run(post("/api/sales", { origin: "https://foo.reficio.app", "sec-fetch-site": "same-site" }))
    expect(res.status).toBe(403)
  })

  it("falls back to Referer when Origin is missing", () => {
    expect(run(post("/api/sales", { referer: "https://evil.com/page" })).status).toBe(403)
    expect(run(post("/api/sales", { referer: "https://reficio.app/admin/ventas" })).status).toBe(200)
  })

  it("rejects malformed or null Origins", () => {
    for (const origin of ["null", "not a url"]) {
      expect(run(post("/api/sales", { origin })).status).toBe(403)
    }
  })

  it("accepts the NEXTAUTH_URL host when the request hits an internal host", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://reficio.app")
    // La request entra por host interno (docker/healthcheck) con el Origin público.
    const res = run(new NextRequest("http://internal:3005/api/sales", { method: "POST", headers: { origin: "https://reficio.app" } }))
    expect(res.status).toBe(200)
  })

  it("honors ALLOWED_ORIGINS as URLs or bare hosts", () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://preview.example.com, tenant.reficio.mx")
    expect(run(post("/api/sales", { origin: "https://preview.example.com" })).status).toBe(200)
    expect(run(post("/api/sales", { origin: "https://tenant.reficio.mx" })).status).toBe(200)
    expect(run(post("/api/sales", { origin: "https://other.example.com" })).status).toBe(403)
  })

  it("never invokes the session handler for /api (no DB session lookup)", () => {
    // Mutables bloqueados y permitidos, y lecturas: ninguno debe tocar auth().
    run(post("/api/sales", { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
    run(post("/api/sales"))
    run(request("/api/sales", "GET", { origin: "https://evil.com" }))
    expect(mocks.sessionHandler).not.toHaveBeenCalled()
    // Una página sí pasa por el handler con sesión.
    run(request("/admin/ventas", "GET"))
    expect(mocks.sessionHandler).toHaveBeenCalled()
  })

  it("does not interfere with non-API paths", () => {
    const res = run(request("/admin/ventas", "POST", { origin: "https://evil.com" }))
    expect(res.status).toBe(200)
  })
})
