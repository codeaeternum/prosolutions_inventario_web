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

// proxy() es async (espera al handler de sesión en las rutas de páginas);
// aunque la rama /api resuelve sin awaits, el retorno siempre es una Promise.
const run = (req: NextRequest): Promise<Response> => (proxy as any)(req)
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
  it("rejects a cross-site POST declaring both Origin and Sec-Fetch-Site", async () => {
    const res = await run(post("/api/sales", { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(403)
    expect(res.headers.get("cache-control")).toContain("no-store")
    return res.json().then((body) => expect(body.error).toBe("Origen no permitido"))
  })

  it("rejects a POST whose only signal is a foreign Origin", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await run(request("/api/users", method, { origin: "https://evil.com" }))
      expect(res.status).toBe(403)
    }
  })

  it("rejects Sec-Fetch-Site: cross-site even without an Origin header", async () => {
    const res = await run(post("/api/sales", { "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(403)
  })

  it("lets a same-host Origin through", async () => {
    const res = await run(post("/api/sales", { origin: "https://reficio.app", "sec-fetch-site": "same-origin" }))
    expect(res.status).toBe(200)
  })

  it("lets clients without Origin or Fetch-Metadata through (curl/server-to-server)", async () => {
    const res = await run(post("/api/sales"))
    expect(res.status).toBe(200)
  })

  it("lets Sec-Fetch-Site same-origin/same-site/none through when Origin is absent", async () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      const res = await run(post("/api/sales", { "sec-fetch-site": site }))
      expect(res.status).toBe(200)
    }
  })

  it("exempts NextAuth callbacks (Auth.js has its own CSRF checks)", async () => {
    const res = await run(post("/api/auth/callback/credentials", { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
    expect(res.status).toBe(200)
  })

  it("does not apply to read-only methods or CORS preflight", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const res = await run(request("/api/sales", method, { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
      expect(res.status).toBe(200)
    }
  })

  it("exempts CRON_SECRET-protected cron endpoints", async () => {
    const res = await run(post("/api/cron/purge-events"))
    expect(res.status).toBe(200)
    // Y también con un Origin del propio scheduler (el secreto es la barrera real).
    const withOrigin = await run(post("/api/reservations/check-expiring", { origin: "https://cron-job.org" }))
    expect(withOrigin.status).toBe(200)
  })

  it("rejects foreign subdomains even when Sec-Fetch-Site says same-site", async () => {
    // same-site incluye subdominios, pero aquí no hay tenants en subdominios:
    // la regla Origin manda sobre Fetch Metadata.
    const res = await run(post("/api/sales", { origin: "https://foo.reficio.app", "sec-fetch-site": "same-site" }))
    expect(res.status).toBe(403)
  })

  it("falls back to Referer when Origin is missing", async () => {
    expect((await run(post("/api/sales", { referer: "https://evil.com/page" }))).status).toBe(403)
    expect((await run(post("/api/sales", { referer: "https://reficio.app/admin/ventas" }))).status).toBe(200)
  })

  it("rejects malformed or null Origins", async () => {
    for (const origin of ["null", "not a url"]) {
      expect((await run(post("/api/sales", { origin }))).status).toBe(403)
    }
  })

  it("accepts the NEXTAUTH_URL host when the request hits an internal host", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://reficio.app")
    // La request entra por host interno (docker/healthcheck) con el Origin público.
    const res = await run(new NextRequest("http://internal:3005/api/sales", { method: "POST", headers: { origin: "https://reficio.app" } }))
    expect(res.status).toBe(200)
  })

  it("honors ALLOWED_ORIGINS as URLs or bare hosts", async () => {
    vi.stubEnv("ALLOWED_ORIGINS", "https://preview.example.com, tenant.reficio.mx")
    expect((await run(post("/api/sales", { origin: "https://preview.example.com" }))).status).toBe(200)
    expect((await run(post("/api/sales", { origin: "https://tenant.reficio.mx" }))).status).toBe(200)
    expect((await run(post("/api/sales", { origin: "https://other.example.com" }))).status).toBe(403)
  })

  it("in production the request Host is NOT an implicit allowlist entry (DNS-rebinding)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_URL", "https://reficio.app")
    // Un Origin == Host ya no pasa por ser "propio": en rebinding el
    // navegador mandaría exactamente eso — la allowlist sale solo de envs.
    const rebound = await run(new NextRequest("https://rebind.attacker.example/api/sales", {
      method: "POST",
      headers: { host: "rebind.attacker.example", origin: "https://rebind.attacker.example" },
    }))
    expect(rebound.status).toBe(403)
    // Los orígenes configurados siguen entrando en producción.
    expect((await run(post("/api/sales", { origin: "https://reficio.app" }))).status).toBe(200)
  })

  it("in production the workshop LAN origin is allowed by default and via APP_BIND_IP", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXTAUTH_URL", "https://reficio.app")
    // Default del compose (192.168.1.195): los formularios del taller
    // postean a http://192.168.1.195:3005 y su Origin entra en la allowlist.
    expect((await run(post("/api/sales", { origin: "http://192.168.1.195:3005" }))).status).toBe(200)
    // Otro bind de LAN se deriva de APP_BIND_IP.
    vi.stubEnv("APP_BIND_IP", "10.20.30.40")
    expect((await run(post("/api/sales", { origin: "http://10.20.30.40:3005" }))).status).toBe(200)
    // Pero un origen LAN distinto no es comodín: host no configurado → 403.
    expect((await run(post("/api/sales", { origin: "http://10.20.30.41:3005" }))).status).toBe(403)
  })

  it("never invokes the session handler for /api (no DB session lookup)", async () => {
    // Mutables bloqueados y permitidos, y lecturas: ninguno debe tocar auth().
    await run(post("/api/sales", { origin: "https://evil.com", "sec-fetch-site": "cross-site" }))
    await run(post("/api/sales"))
    await run(request("/api/sales", "GET", { origin: "https://evil.com" }))
    expect(mocks.sessionHandler).not.toHaveBeenCalled()
    // Una página sí pasa por el handler con sesión.
    await run(request("/admin/ventas", "GET"))
    expect(mocks.sessionHandler).toHaveBeenCalled()
  })

  it("does not interfere with non-API paths", async () => {
    const res = await run(request("/admin/ventas", "POST", { origin: "https://evil.com" }))
    expect(res.status).toBe(200)
  })
})
