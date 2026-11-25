import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Cabeceras de seguridad — dos capas que esta suite congela:
 *
 * 1. next.config.ts → headers(): endurecimiento global para TODAS las rutas
 *    (sirve igual detrás de Cloudflare Tunnel que en :3005 LAN, donde no hay
 *    proxy que añada nada). El test importa el config exportado y evalúa la
 *    estructura que Next aplicará en cada respuesta.
 *
 * 2. Cache-Control: no-store en las APIs públicas con token
 *    (/api/seguimiento, /api/cotizacion, /api/evidencia): datos privados del
 *    cliente que viajan por link de WhatsApp/QR — ni el navegador ni un CDN
 *    intermedio deben retenerlos. Se ejercitan los handlers reales con la
 *    capa de datos mockeada, verificando que TODA respuesta (200, 4xx, 429)
 *    salga con no-store.
 */

// ─── Capa 1: headers() del config ────────────────────────────────────────

import nextConfig from "../../../next.config"

type HeaderRule = { source: string; headers: { key: string; value: string }[] }

async function rules(): Promise<HeaderRule[]> {
  expect(nextConfig.headers).toBeTypeOf("function")
  return (await nextConfig.headers!()) as HeaderRule[]
}

function headerMap(rule: HeaderRule): Map<string, string> {
  return new Map(rule.headers.map(h => [h.key.toLowerCase(), h.value]))
}

describe("next.config headers() — endurecimiento global", () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it("aplica las cabeceras base en todas las rutas (/:path*)", async () => {
    const global = (await rules()).find(r => r.source === "/:path*")
    expect(global, "falta la regla global /:path*").toBeDefined()
    const h = headerMap(global!)

    // Anti MIME-sniffing: un upload servido con tipo incorrecto no se ejecuta.
    expect(h.get("x-content-type-options")).toBe("nosniff")
    // El referrer solo cruza origen-recorte: tokens en query (?t=…) no deben
    // filtrarse a terceros por enlaces salientes.
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    // Clickjacking: nada en la app se embebe en iframes externos. SAMEORIGIN
    // basta (la impresión de tickets/etiquetas usa window.print / window.open,
    // no iframes — la dependencia react-to-print que lo justificaba ya no existe;
    // DENY sería viable hoy pero SAMEORIGIN cubre igual el framing externo).
    expect(h.get("x-frame-options")).toBe("SAMEORIGIN")
  })

  it("permite la cámara solo para sí mismo: el escáner POS/QR la necesita", async () => {
    const h = headerMap((await rules()).find(r => r.source === "/:path*")!)
    const pp = h.get("permissions-policy") ?? ""
    // camera=() rompería html5-qrcode (POS, evidencias, seguimiento técnico).
    expect(pp).toMatch(/camera=\(\s*self\s*\)/)
    expect(pp).not.toMatch(/camera=\(\s*\)/)
    // Micrófono y geolocalización no se usan: cerrados del todo.
    expect(pp).toMatch(/microphone=\(\s*\)/)
    expect(pp).toMatch(/geolocation=\(\s*\)/)
  })

  it("NO emite CSP desde el config: la enforce con nonce la pone el proxy", async () => {
    const h = headerMap((await rules()).find(r => r.source === "/:path*")!)
    // La CSP es por-request (nonce) y necesita estar en el REQUEST upstream
    // para que el renderer la parsee — imposible desde headers() estáticos.
    // Si el config la fijara además del proxy, la respuesta llevaría DOS
    // headers CSP y el browser aplicaría la intersección (rompiendo todo).
    expect(h.has("content-security-policy")).toBe(false)
    expect(h.has("content-security-policy-report-only")).toBe(false)
  })

  it("HSTS solo en producción (en LAN :3005 es HTTP plano)", async () => {
    vi.stubEnv("NODE_ENV", "test")
    let h = headerMap((await rules()).find(r => r.source === "/:path*")!)
    expect(h.has("strict-transport-security")).toBe(false)

    vi.stubEnv("NODE_ENV", "production")
    h = headerMap((await rules()).find(r => r.source === "/:path*")!)
    expect(h.get("strict-transport-security")).toContain("max-age=")
  })

  it("nunca cachea el service worker ni los comprobantes de pago privados", async () => {
    const all = await rules()
    const sw = all.find(r => r.source === "/sw.js")
    expect(headerMap(sw!).get("cache-control")).toContain("no-store")
    for (const source of ["/api/payment-proofs/:path*", "/uploads/payments/:path*"]) {
      const rule = all.find(r => r.source === source)
      expect(rule, `falta regla para ${source}`).toBeDefined()
      expect(headerMap(rule!).get("cache-control")).toBe("private, no-store")
    }
  })
})

// ─── Capa 1b: CSP enforce con nonce por request (src/proxy.ts) ───────────
// La política sale del proxy, no del config: nonce impredecible por request,
// inyectado en el request upstream (de ahí lo parsea el renderer de Next para
// estamparlo en sus scripts) y en la respuesta como header enforce.

const proxyMocks = vi.hoisted(() => ({ getAuthRedirect: vi.fn(), sessionHandler: vi.fn() }))
// Mismo patrón que security/api-origin.test.ts: auth(handler) devuelve el
// handler espiado sin sesión — aquí solo interesa la cadena de headers.
vi.mock("@/lib/auth", () => ({
  auth: (arg?: unknown) => {
    if (typeof arg !== "function") return null
    proxyMocks.sessionHandler.mockImplementation(arg as (req: unknown) => unknown)
    return proxyMocks.sessionHandler
  },
}))
vi.mock("@/lib/auth.config", () => ({ getAuthRedirect: proxyMocks.getAuthRedirect }))

import { NextRequest } from "next/server"
import { proxy } from "@/proxy"

const runProxy = (req: NextRequest): Promise<Response> => (proxy as any)(req)
const proxyReq = (path: string, method = "GET", headers: Record<string, string> = {}) =>
  new NextRequest(`https://reficio.app${path}`, { method, headers })

const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1] ?? null

describe("proxy — Content-Security-Policy enforce con nonce", () => {
  beforeEach(() => {
    proxyMocks.getAuthRedirect.mockReturnValue(null)
    proxyMocks.sessionHandler.mockClear()
  })

  it("emite Content-Security-Policy enforce (y ya no report-only)", async () => {
    const res = await runProxy(proxyReq("/api/sales"))
    const csp = res.headers.get("content-security-policy")
    expect(csp, "falta el header enforce").toBeTruthy()
    expect(res.headers.has("content-security-policy-report-only")).toBe(false)
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it("script-src usa nonce + strict-dynamic, sin unsafe-inline ni unsafe-eval", async () => {
    const res = await runProxy(proxyReq("/api/sales"))
    const csp = res.headers.get("content-security-policy")!
    const scriptSrc = csp.split(";").map(d => d.trim()).find(d => d.startsWith("script-src"))!
    expect(scriptSrc).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/)
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    // NODE_ENV=test se comporta como producción: React no evalúa fuera de dev.
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(nonceOf(csp)).toBeTruthy()
  })

  it("el nonce es único por request y consistente entre upstream y response", async () => {
    const resA = await runProxy(proxyReq("/api/sales"))
    const resB = await runProxy(proxyReq("/api/sales"))
    const cspA = resA.headers.get("content-security-policy")!
    const cspB = resB.headers.get("content-security-policy")!
    expect(nonceOf(cspA)).not.toBe(nonceOf(cspB))

    // El renderer de Next parsea el CSP del REQUEST upstream para estampar
    // el nonce en sus scripts: si no coincide con el de la respuesta,
    // ningún script ejecuta. x-middleware-request-* es como Next serializa
    // los headers upstream que el proxy fijó.
    const upstreamCsp = resA.headers.get("x-middleware-request-content-security-policy")
    expect(upstreamCsp).toBe(cspA)
    const upstreamNonce = resA.headers.get("x-middleware-request-x-nonce")
    expect(upstreamNonce).toBe(nonceOf(cspA))
  })

  it("jamás honra un x-nonce enviado por el cliente", async () => {
    const res = await runProxy(proxyReq("/api/sales", "GET", { "x-nonce": "nonce-del-atacante" }))
    const csp = res.headers.get("content-security-policy")!
    expect(nonceOf(csp)).toBeTruthy()
    expect(nonceOf(csp)).not.toBe("nonce-del-atacante")
    expect(csp).not.toContain("nonce-del-atacante")
  })

  it("sellan la CSP tanto las páginas (vía auth) como los 403 de la barrera CSRF", async () => {
    const page = await runProxy(proxyReq("/admin"))
    expect(nonceOf(page.headers.get("content-security-policy") ?? "")).toBeTruthy()

    const denied = await runProxy(proxyReq("/api/sales", "POST", {
      origin: "https://evil.com", "sec-fetch-site": "cross-site",
    }))
    expect(denied.status).toBe(403)
    expect(nonceOf(denied.headers.get("content-security-policy") ?? "")).toBeTruthy()
  })

  it("style-src conserva unsafe-inline (atributos style de React no admiten nonce)", async () => {
    const res = await runProxy(proxyReq("/api/sales"))
    const csp = res.headers.get("content-security-policy")!
    const styleSrc = csp.split(";").map(d => d.trim()).find(d => d.startsWith("style-src"))!
    expect(styleSrc).toContain("'unsafe-inline'")
    // Un nonce en style-src haría que CSP3 IGNORE unsafe-inline y rompería
    // todos los style attributes — no debe estar.
    expect(styleSrc).not.toContain("nonce-")
  })

  it("connect-src queda en 'self' y worker-src cubre el service worker", async () => {
    const res = await runProxy(proxyReq("/api/sales"))
    const csp = res.headers.get("content-security-policy")!
    expect(csp).toContain("connect-src 'self';")
    // Sin el https: amplio del report-only: era el canal de exfiltración
    // más ancho de la política y no hay fetch cliente a hosts externos.
    expect(csp).not.toContain("connect-src 'self' https:")
    // worker-src explícito: con strict-dynamic el fallback a script-src
    // invalidaría los host-sources y ahogaría el registro de /sw.js.
    expect(csp).toContain("worker-src 'self'")
    // LAN del taller es HTTP plano: upgrade-insecure-requests rompería todo.
    expect(csp).not.toContain("upgrade-insecure-requests")
  })

  it("img-src cubre los tiles de OpenStreetMap sin abrir https: amplio", async () => {
    const res = await runProxy(proxyReq("/api/sales"))
    const csp = res.headers.get("content-security-policy")!
    const imgSrc = csp.split(";").map(d => d.trim()).find(d => d.startsWith("img-src"))!
    // /mercado monta Leaflet con tiles de OSM (mercado-map-inner.tsx) —
    // sin este host el mapa queda en blanco. Es el ÚNICO host externo de
    // imágenes que usa la app (logos/productos son /uploads, mismo origen;
    // previews y QR impresos van por blob:/data:).
    expect(imgSrc).toContain("https://tile.openstreetmap.org")
    expect(imgSrc).toContain("data:")
    expect(imgSrc).toContain("blob:")
    // El https: amplio (scheme-only, cualquier host) era la vía de
    // exfiltración por <img> inyectada: como token pelado no debe volver.
    expect(imgSrc.split(/\s+/)).not.toContain("https:")
  })
})

// ─── Capa 2: no-store en APIs públicas con token ─────────────────────────

const mocks = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  photoCreate: vi.fn(),
  photoDelete: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
  checkAndRecord: vi.fn(() => true),
  getBusinessSetting: vi.fn(async () => null),
  getOrderFolioDigits: vi.fn(async () => 6),
  loadQuoteServiceLines: vi.fn(async () => []),
  notifyStaff: vi.fn(async () => {}),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique },
    repairPhoto: { create: mocks.photoCreate, delete: mocks.photoDelete },
    repairEvent: { create: mocks.eventCreate },
    $transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: mocks.checkAndRecord,
  checkOnly: vi.fn(() => true),
  recordFailure: vi.fn(),
  getClientIp: vi.fn(() => "1.2.3.4"),
}))
vi.mock("@/lib/settings", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getBusinessSetting: mocks.getBusinessSetting,
  getOrderFolioDigits: mocks.getOrderFolioDigits,
}))
vi.mock("@/lib/public-quote", () => ({ loadQuoteServiceLines: mocks.loadQuoteServiceLines }))
// La ruta approve importa el canal SSE entero (api-auth, tenant, prisma):
// se corta en la frontera — solo interesa que la respuesta salga con no-store.
vi.mock("@/app/api/notifications/stream/route", () => ({
  sendNotificationToStaff: mocks.notifyStaff,
  sendNotificationToAdmins: vi.fn(async () => {}),
}))

import { GET as seguimientoGET } from "@/app/api/seguimiento/route"
import { GET as cotizacionGET } from "@/app/api/cotizacion/[token]/route"
import { POST as approvePOST } from "@/app/api/cotizacion/[token]/approve/route"
import { GET as evidenciaGET, POST as evidenciaPOST } from "@/app/api/evidencia/[token]/route"

const params = (token: string) => ({ params: Promise.resolve({ token }) })
const noStore = (res: Response) =>
  expect(res.headers.get("cache-control"), `esperaba no-store (status ${res.status})`).toContain("no-store")

const trackedOrder = () => ({
  number: 7, businessId: "biz-1", status: "IN_REPAIR",
  equipmentType: "Celular", brand: "Apple", model: "iPhone 13",
  reportedIssue: "Pantalla rota", serviceName: "Cambio de pantalla",
  promisedAt: new Date(), createdAt: new Date(),
  approvedQuoteCents: null, warrantyUntil: null,
  currentBranch: { name: "Centro" },
  events: [{ id: "e1", type: "NOTE", detail: "Equipo en reparación.", isPublic: true, createdAt: new Date() }],
  photos: [], payments: [], parts: [],
  customerPhone: "5551234567",
  business: { name: "Taller", phone: "5512345678", isActive: true },
})

const quotedOrder = () => ({
  ...trackedOrder(),
  customerName: "Cliente", equipmentColor: "Negro",
  diagnosis: "Cristal estrellado", quoteCents: 150000,
  quoteApprovedAt: null, quoteExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
})

describe("Cache-Control en /api/seguimiento (rastreo público)", () => {
  beforeEach(() => { mocks.checkAndRecord.mockReturnValue(true) })

  it("429 del rate limit también sale sin caché", async () => {
    mocks.checkAndRecord.mockReturnValue(false)
    noStore(await seguimientoGET(new Request("https://app.invalid/api/seguimiento?t=x")))
  })

  it("404 genérico (folio/teléfono inválido u orden ausente) sale sin caché", async () => {
    noStore(await seguimientoGET(new Request("https://app.invalid/api/seguimiento?folio=abc&phone=x")))
    mocks.orderFindUnique.mockResolvedValue(null)
    noStore(await seguimientoGET(new Request("https://app.invalid/api/seguimiento?t=no-existe")))
  })

  it("200 con datos de la orden sale sin caché", async () => {
    mocks.orderFindUnique.mockResolvedValue(trackedOrder())
    const res = await seguimientoGET(new Request("https://app.invalid/api/seguimiento?t=token-uuid"))
    expect(res.status).toBe(200)
    noStore(res)
  })
})

describe("Cache-Control en /api/cotizacion/[token] (cotización pública)", () => {
  beforeEach(() => { mocks.checkAndRecord.mockReturnValue(true) })

  it("429 y 404 salen sin caché", async () => {
    mocks.checkAndRecord.mockReturnValue(false)
    noStore(await cotizacionGET(new Request("https://app.invalid/api/cotizacion/t"), params("t")))
    mocks.checkAndRecord.mockReturnValue(true)
    mocks.orderFindUnique.mockResolvedValue(null)
    noStore(await cotizacionGET(new Request("https://app.invalid/api/cotizacion/t"), params("t")))
  })

  it("200 con la cotización sale sin caché", async () => {
    mocks.orderFindUnique.mockResolvedValue(quotedOrder())
    const res = await cotizacionGET(new Request("https://app.invalid/api/cotizacion/t"), params("t"))
    expect(res.status).toBe(200)
    noStore(res)
  })
})

describe("Cache-Control en /api/cotizacion/[token]/approve (decisión del cliente)", () => {
  beforeEach(() => {
    mocks.checkAndRecord.mockReturnValue(true)
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({ repairOrder: { findUnique: mocks.orderFindUnique } }))
  })

  const post = (body: unknown) =>
    approvePOST(new Request("https://app.invalid/api/cotizacion/t/approve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), params("t"))

  it("429, 400 y 404 (BusinessError) salen sin caché", async () => {
    mocks.checkAndRecord.mockReturnValue(false)
    noStore(await post({}))
    mocks.checkAndRecord.mockReturnValue(true)
    noStore(await post({})) // body inválido → ZodError → 400
    mocks.orderFindUnique.mockResolvedValue(null) // token inexistente → 404 genérico
    noStore(await post({ action: "APPROVE", expectedLaborCents: 100 }))
  })
})

describe("Cache-Control en /api/evidencia/[token] (subida pública por QR)", () => {
  beforeEach(() => { mocks.checkAndRecord.mockReturnValue(true) })

  it("GET: 429, 404 y 200 salen sin caché", async () => {
    mocks.checkAndRecord.mockReturnValue(false)
    noStore(await evidenciaGET(new Request("https://app.invalid/api/evidencia/t"), params("t")))
    mocks.checkAndRecord.mockReturnValue(true)
    mocks.orderFindUnique.mockResolvedValue(null)
    noStore(await evidenciaGET(new Request("https://app.invalid/api/evidencia/t"), params("t")))
    mocks.orderFindUnique.mockResolvedValue({
      number: 9, businessId: "biz-1", uploadTokenExpiresAt: null,
      business: { isActive: true }, photos: [],
    })
    const res = await evidenciaGET(new Request("https://app.invalid/api/evidencia/t"), params("t"))
    expect(res.status).toBe(200)
    noStore(res)
  })

  it("POST: rechazo por rate limit sale sin caché", async () => {
    mocks.checkAndRecord.mockReturnValue(false)
    const form = new FormData()
    form.append("file", new File([new Uint8Array([1, 2, 3])], "foto.png", { type: "image/png" }))
    const res = await evidenciaPOST(new Request("https://app.invalid/api/evidencia/t", {
      method: "POST", body: form,
    }), params("t"))
    expect(res.status).toBe(429)
    noStore(res)
  })
})
