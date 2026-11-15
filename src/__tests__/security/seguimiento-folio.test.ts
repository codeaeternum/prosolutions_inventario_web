import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/seguimiento — bucket por folio en el path legacy (folio + 4 dígitos
 * del teléfono).
 *
 * El espacio phone4 es ~10⁴ por folio: el bucket por IP (10/min legacy) no
 * bastaba contra fuerza bruta con IPs rotando, así que cada folio agota su
 * propio presupuesto (20 fallos/hora). Reglas congeladas aquí:
 *   - el cargo al bucket del folio SOLO ocurre cuando el folio existe y el
 *     phone4 no coincide (un folio inexistente ni siquiera revela el bucket);
 *   - un acierto (phone4 correcto) no consume presupuesto;
 *   - un folio agotado responde 429 sin dejar de responder el resto de folios.
 *
 * El limiter es el REAL en memoria: las requests van con IP rotativa
 * (TRUST_PROXY_HEADERS + x-real-ip distinto) para aislar el bucket del folio
 * del bucket de IP.
 */

const mocks = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  orderFindMany: vi.fn(),
  getBusinessSetting: vi.fn(async () => null),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique, findMany: mocks.orderFindMany },
  },
}))
vi.mock("@/lib/settings", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getBusinessSetting: mocks.getBusinessSetting,
}))

import { GET as seguimientoGET } from "@/app/api/seguimiento/route"

vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const nextIp = () => `172.20.${(++ipCounter) % 250}.${(ipCounter * 13) % 250 + 1}`

const legacyReq = (folio: number, phone: string) =>
  new Request(`https://app.invalid/api/seguimiento?folio=${folio}&phone=${phone}`, {
    headers: { "x-real-ip": nextIp() },
  })

const order = (number: number, phone: string) => ({
  number,
  businessId: "biz-1",
  status: "IN_REPAIR",
  customerPhone: phone,
  equipmentType: "Celular",
  brand: "Apple",
  model: "iPhone 13",
  reportedIssue: "No enciende",
  serviceName: "Diagnóstico",
  promisedAt: null,
  createdAt: new Date(),
  approvedQuoteCents: null,
  warrantyUntil: null,
  currentBranch: { name: "Centro" },
  events: [],
  photos: [],
  payments: [],
  parts: [],
  business: { name: "Taller Uno", phone: "8122334455", isActive: true },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.orderFindUnique.mockResolvedValue(null)
  mocks.orderFindMany.mockResolvedValue([])
})

describe("bucket por folio (seguimiento-legacy-folio, 20 fallos/hora)", () => {
  it("folio inexistente SOLO gasta el bucket de IP: 25 fallos con IPs rotativas nunca dan 429", async () => {
    mocks.orderFindMany.mockResolvedValue([])
    // 25 > 20: si el bucket del folio se cobrara aunque el folio no exista,
    // las últimas consultas ya estarían bloqueadas — y de paso quedaría un
    // oráculo de existencia por status.
    for (let i = 0; i < 25; i++) {
      const res = await seguimientoGET(legacyReq(90001, "0000"))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: "No encontramos una orden con esos datos." })
    }
  })

  it("folio existente + phone4 equivocado agota el bucket del folio tras 20 fallos", async () => {
    mocks.orderFindMany.mockResolvedValue([order(42, "5512345678")])
    for (let i = 0; i < 20; i++) {
      const res = await seguimientoGET(legacyReq(42, "0000"))
      expect(res.status).toBe(404) // fallo genérico, no 429
    }
    const blocked = await seguimientoGET(legacyReq(42, "9999"))
    expect(blocked.status).toBe(429)
    // El bloqueo es por folio: otro folio (inexistente) sigue respondiendo.
    const other = await seguimientoGET(legacyReq(43, "0000"))
    expect(other.status).toBe(404)
  })

  it("un acierto (phone4 correcto) no consume presupuesto del bucket", async () => {
    mocks.orderFindMany.mockResolvedValue([order(77, "5512345678")])
    // 19 fallos; si el acierto de en medio también cobrara, el fallo #20
    // ya estaría bloqueado (20 >= 20) en vez del #21.
    for (let i = 0; i < 19; i++) {
      expect((await seguimientoGET(legacyReq(77, "0000"))).status).toBe(404)
    }
    const hit = await seguimientoGET(legacyReq(77, "5678"))
    expect(hit.status).toBe(200)
    // Fallos 20 y 21: el 20 aún pasa (bucket llega a 20), el 21 ya es 429.
    expect((await seguimientoGET(legacyReq(77, "0000"))).status).toBe(404)
    expect((await seguimientoGET(legacyReq(77, "0000"))).status).toBe(429)
  })

  it("el path por trackingToken UUID no pasa por el bucket del folio", async () => {
    // Agota el folio 42 y verifica que ?t= sigue sin verse afectado — y que
    // el 404 del token sigue siendo genérico.
    mocks.orderFindMany.mockResolvedValue([order(42, "5512345678")])
    for (let i = 0; i < 21; i++) {
      await seguimientoGET(legacyReq(42, "0000"))
    }
    mocks.orderFindUnique.mockResolvedValue(null)
    const res = await seguimientoGET(
      new Request("https://app.invalid/api/seguimiento?t=token-inexistente", {
        headers: { "x-real-ip": nextIp() },
      }),
    )
    expect(res.status).toBe(404)
  })
})
