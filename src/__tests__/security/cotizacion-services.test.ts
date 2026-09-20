import { beforeEach, describe, expect, it, vi } from "vitest"

// GET /api/cotizacion/[token]: el desglose por servicio del documento público
// resuelve el precio efectivo del equipo (modelo exacto > tipo > base) sin
// snapshot por servicio — prisma stub por modelo, mismo patrón que
// workshop-service-prices.test.ts. La ruta es pública (el token es el
// secreto): los servicios solo exponen nombre + priceCents.
const mocks = vi.hoisted(() => ({
  roFindUnique: vi.fn(),
  wsFindMany: vi.fn(),
  dmFindMany: vi.fn(),
  getBusinessSetting: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.roFindUnique },
    workshopService: { findMany: mocks.wsFindMany },
    deviceModel: { findMany: mocks.dmFindMany },
  },
}))
vi.mock("@/lib/settings", () => ({ getBusinessSetting: mocks.getBusinessSetting }))

import { GET } from "@/app/api/cotizacion/[token]/route"

const modelRow = (deviceModelId: string, priceCents: number) => ({ deviceModelId, equipmentType: null, priceCents })
const typeRow = (equipmentType: string, priceCents: number) => ({ deviceModelId: null, equipmentType, priceCents })

const order = {
  number: 42,
  businessId: "biz-1",
  business: { isActive: true },
  status: "WAITING_APPROVAL",
  customerName: "Cliente Demo",
  equipmentType: "Celular",
  brand: "Apple",
  model: "iPhone 12",
  equipmentColor: null,
  reportedIssue: "Cambio de pantalla · no enciende",
  serviceName: "Cambio de pantalla",
  diagnosis: null,
  quoteCents: 80000,
  approvedQuoteCents: null,
  quoteApprovedAt: null,
  quoteExpiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  parts: [],
  events: [{ createdAt: new Date() }],
}

const get = (token: string) => [
  new Request(`https://app.invalid/api/cotizacion/${token}`),
  { params: Promise.resolve({ token }) },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.roFindUnique.mockResolvedValue(order)
  mocks.getBusinessSetting.mockResolvedValue(null)
  mocks.dmFindMany.mockResolvedValue([{ id: "m-iphone12", businessId: null }])
  mocks.wsFindMany.mockResolvedValue([
    { name: "Cambio de pantalla", isActive: true, priceCents: 50000, prices: [modelRow("m-iphone12", 80000), typeRow("Celular", 65000)] },
  ])
})

describe("GET /api/cotizacion/[token] — desglose por servicio", () => {
  it("expone el precio del modelo exacto y no el base del servicio", async () => {
    const response = await GET(...get("tok-1"))
    expect(response.status).toBe(200)
    const { quote } = await response.json()
    expect(quote.services).toEqual([{ name: "Cambio de pantalla", priceCents: 80000 }])
    // La suma de líneas explica la mano de obra cotizada.
    expect(quote.laborMatchesServices).toBe(true)
    expect(quote.laborCents).toBe(80000)
    expect(quote.totalCents).toBe(80000)
  })

  it("sin fila del modelo cae al precio del tipo de equipo", async () => {
    mocks.dmFindMany.mockResolvedValue([]) // brand+model no está en el catálogo
    mocks.roFindUnique.mockResolvedValue({ ...order, quoteCents: 65000 })
    const { quote } = await (await GET(...get("tok-1"))).json()
    expect(quote.services[0].priceCents).toBe(65000)
    expect(quote.laborMatchesServices).toBe(true)
  })

  it("sin precio aplicable la línea viaja null (se cotiza al recibir)", async () => {
    mocks.wsFindMany.mockResolvedValue([
      { name: "Batería", isActive: true, priceCents: null, prices: [modelRow("m-otro", 40000)] },
    ])
    mocks.roFindUnique.mockResolvedValue({ ...order, serviceName: "Batería", quoteCents: 30000 })
    const { quote } = await (await GET(...get("tok-1"))).json()
    expect(quote.services).toEqual([{ name: "Batería", priceCents: null }])
    // La línea no explica la cifra capturada: el importe autorizable sigue siendo laborCents.
    expect(quote.laborMatchesServices).toBe(false)
  })

  it("importe del staff distinto del catálogo → líneas informativas, no explican la mano de obra", async () => {
    mocks.roFindUnique.mockResolvedValue({ ...order, quoteCents: 75000 })
    const { quote } = await (await GET(...get("tok-1"))).json()
    expect(quote.services[0].priceCents).toBe(80000)
    expect(quote.laborMatchesServices).toBe(false)
    expect(quote.laborCents).toBe(75000)
  })

  it("sin serviceName el desglose es lista vacía", async () => {
    mocks.roFindUnique.mockResolvedValue({ ...order, serviceName: null })
    const { quote } = await (await GET(...get("tok-1"))).json()
    expect(quote.services).toEqual([])
    expect(quote.laborMatchesServices).toBe(false)
    expect(mocks.wsFindMany).not.toHaveBeenCalled()
  })

  it("un fallo del lookup de catálogo no tumba la consulta pública", async () => {
    mocks.wsFindMany.mockRejectedValue(new Error("sin conexión"))
    const response = await GET(...get("tok-1"))
    expect(response.status).toBe(200)
    const { quote } = await response.json()
    expect(quote.services).toEqual([])
    expect(quote.laborCents).toBe(80000)
  })
})
