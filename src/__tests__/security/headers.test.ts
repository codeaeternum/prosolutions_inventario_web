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
    // (no DENY) porque react-to-print monta un iframe de mismo origen para
    // imprimir tickets/etiquetas.
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

  it("emite CSP en modo report-only (nunca enforce: no romper inline de Next)", async () => {
    const h = headerMap((await rules()).find(r => r.source === "/:path*")!)
    const csp = h.get("content-security-policy-report-only")
    expect(csp).toBeDefined()
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'self'")
    // Jamás la versión enforce mientras convivan scripts inline de Next/Turbopack.
    expect(h.has("content-security-policy")).toBe(false)
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
