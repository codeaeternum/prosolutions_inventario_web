import { beforeEach, describe, expect, it, vi } from "vitest"

// Desglose por servicio de la cotización: la orden guarda serviceName como
// "A + B" y UN solo importe de mano de obra (quoteCents) — sin snapshot por
// servicio. Las líneas se re-resuelven contra el catálogo con el equipo de
// la orden: modelo exacto > tipo de equipo > priceCents base; null = "se
// cotiza al recibir". Los helpers puros se prueban directo; el loader con
// prisma stub por modelo, mismo patrón que workshop-service-prices.test.ts.
const mocks = vi.hoisted(() => ({
  roFindUnique: vi.fn(),
  wsFindMany: vi.fn(),
  dmFindMany: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.roFindUnique },
    workshopService: { findMany: mocks.wsFindMany },
    deviceModel: { findMany: mocks.dmFindMany },
  },
}))

import {
  orderServiceNames,
  resolveQuoteServiceLines,
  serviceLinesMatchLabor,
  serviceLinesTotal,
  suggestedServiceLinesTotal,
} from "@/lib/quote-services"
import { loadQuoteByToken, loadQuoteServiceLines } from "@/lib/public-quote"

const modelRow = (deviceModelId: string, priceCents: number) => ({ deviceModelId, equipmentType: null, priceCents })
const typeRow = (equipmentType: string, priceCents: number) => ({ deviceModelId: null, equipmentType, priceCents })

// Catálogo de ejemplo: pantalla con precio por modelo iPhone 12 y por tipo
// Celular sobre un base más barato; batería solo con precio por modelo.
const catalog = [
  { name: "Cambio de pantalla", isActive: true, priceCents: 50000, prices: [modelRow("m-iphone12", 80000), typeRow("Celular", 65000)] },
  { name: "Batería", isActive: true, priceCents: null, prices: [modelRow("m-iphone12", 40000)] },
]

describe("orderServiceNames", () => {
  it("trocea el serviceName de recepción y recorta espacios", () => {
    expect(orderServiceNames("Cambio de pantalla + Batería")).toEqual(["Cambio de pantalla", "Batería"])
    expect(orderServiceNames("Cambio de pantalla")).toEqual(["Cambio de pantalla"])
  })

  it("sin servicio devuelve lista vacía", () => {
    expect(orderServiceNames(null)).toEqual([])
    expect(orderServiceNames(undefined)).toEqual([])
    expect(orderServiceNames("  ")).toEqual([])
  })
})

describe("resolveQuoteServiceLines — precio efectivo por equipo", () => {
  it("el precio del modelo exacto gana sobre el base del servicio", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla", catalog, { deviceModelId: "m-iphone12", equipmentType: "Celular" })
    expect(lines).toEqual([{ name: "Cambio de pantalla", priceCents: 80000 }])
  })

  it("sin fila del modelo cae al precio del tipo de equipo", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla", catalog, { deviceModelId: "m-otro", equipmentType: "Celular" })
    expect(lines[0].priceCents).toBe(65000)
  })

  it("sin fila aplicable cae al priceCents base", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla", catalog, { deviceModelId: null, equipmentType: "Consola" })
    expect(lines[0].priceCents).toBe(50000)
  })

  it("sin precio aplicable → null (se cotiza al recibir)", () => {
    // Batería solo tiene precio para m-iphone12 y no tiene base.
    expect(resolveQuoteServiceLines("Batería", catalog, { deviceModelId: "m-otro", equipmentType: "Celular" })[0].priceCents).toBeNull()
    // Servicio que ya no existe en el catálogo también queda sin precio.
    expect(resolveQuoteServiceLines("Servicio borrado", catalog, { deviceModelId: "m-iphone12" })[0].priceCents).toBeNull()
  })

  it("un ctx sin deviceModelId ignora las filas de modelo", () => {
    const lines = resolveQuoteServiceLines("Batería", catalog, { equipmentType: "Celular" })
    expect(lines[0].priceCents).toBeNull()
  })

  it("conserva el orden de captura y resuelve cada línea con el mismo equipo", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla + Batería", catalog, { deviceModelId: "m-iphone12", equipmentType: "Celular" })
    expect(lines).toEqual([
      { name: "Cambio de pantalla", priceCents: 80000 },
      { name: "Batería", priceCents: 40000 },
    ])
  })

  it("con nombres duplicados en el catálogo gana el servicio activo", () => {
    const dup = [
      { name: "Cambio de pantalla", isActive: false, priceCents: 10000, prices: [] },
      { name: "Cambio de pantalla", isActive: true, priceCents: 50000, prices: [] },
    ]
    expect(resolveQuoteServiceLines("Cambio de pantalla", dup, {})[0].priceCents).toBe(50000)
  })
})

describe("serviceLinesMatchLabor — las líneas solo sustituyen la fila agregada si la explican", () => {
  it("suma exacta y todas resueltas → true", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla + Batería", catalog, { deviceModelId: "m-iphone12" })
    expect(serviceLinesTotal(lines)).toBe(120000)
    expect(serviceLinesMatchLabor(lines, 120000)).toBe(true)
  })

  it("importe capturado distinto del catálogo → false (gana lo cotizado)", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla", catalog, { deviceModelId: "m-iphone12" })
    expect(serviceLinesMatchLabor(lines, 70000)).toBe(false)
  })

  it("una línea sin precio no explica la mano de obra", () => {
    const lines = resolveQuoteServiceLines("Batería", catalog, { equipmentType: "Consola" })
    expect(serviceLinesMatchLabor(lines, 0)).toBe(false)
    expect(serviceLinesMatchLabor(lines, null)).toBe(false)
    expect(serviceLinesMatchLabor([], 50000)).toBe(false)
  })
})

describe("suggestedServiceLinesTotal — sugerencia de catálogo para la ficha admin", () => {
  it("suma cuando TODOS los servicios resuelven para el equipo", () => {
    const lines = resolveQuoteServiceLines("Cambio de pantalla + Batería", catalog, { deviceModelId: "m-iphone12" })
    expect(suggestedServiceLinesTotal(lines)).toBe(120000)
  })

  it("null si algún servicio no tiene precio o no hay servicios", () => {
    expect(suggestedServiceLinesTotal(resolveQuoteServiceLines("Batería", catalog, { equipmentType: "Consola" }))).toBeNull()
    expect(suggestedServiceLinesTotal([])).toBeNull()
  })
})

describe("loadQuoteServiceLines — loader con prisma stub", () => {
  const order = {
    businessId: "biz-1",
    serviceName: "Cambio de pantalla",
    equipmentType: "Celular",
    brand: "Apple",
    model: "iPhone 12",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.wsFindMany.mockResolvedValue(catalog)
    mocks.dmFindMany.mockResolvedValue([{ id: "m-iphone12", businessId: null }])
  })

  it("recupera el deviceModelId por brand+model y aplica el precio del modelo", async () => {
    const lines = await loadQuoteServiceLines(order)
    expect(mocks.dmFindMany).toHaveBeenCalledWith({
      where: { brand: "Apple", model: "iPhone 12", OR: [{ businessId: null }, { businessId: "biz-1" }] },
      select: { id: true, businessId: true },
      take: 4,
    })
    expect(mocks.wsFindMany).toHaveBeenCalledWith({
      where: { businessId: "biz-1", name: { in: ["Cambio de pantalla"] } },
      select: expect.objectContaining({ name: true, priceCents: true }),
    })
    expect(lines).toEqual([{ name: "Cambio de pantalla", priceCents: 80000 }])
  })

  it("el modelo privado del tenant gana sobre el global con mismo brand+model", async () => {
    mocks.dmFindMany.mockResolvedValue([
      { id: "m-iphone12", businessId: null },
      { id: "m-tenant", businessId: "biz-1" },
    ])
    mocks.wsFindMany.mockResolvedValue([
      { name: "Cambio de pantalla", isActive: true, priceCents: 50000, prices: [modelRow("m-tenant", 78000), modelRow("m-iphone12", 80000)] },
    ])
    const lines = await loadQuoteServiceLines(order)
    expect(lines[0].priceCents).toBe(78000)
  })

  it("sin brand/model no consulta el catálogo de modelos y cae al tipo de equipo", async () => {
    const lines = await loadQuoteServiceLines({ ...order, brand: null, model: null })
    expect(mocks.dmFindMany).not.toHaveBeenCalled()
    expect(lines[0].priceCents).toBe(65000)
  })

  it("sin serviceName no consulta nada y devuelve []", async () => {
    expect(await loadQuoteServiceLines({ ...order, serviceName: null })).toEqual([])
    expect(mocks.wsFindMany).not.toHaveBeenCalled()
    expect(mocks.dmFindMany).not.toHaveBeenCalled()
  })
})

describe("loadQuoteByToken — la orden pública trae serviceLines", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.wsFindMany.mockResolvedValue(catalog)
    mocks.dmFindMany.mockResolvedValue([{ id: "m-iphone12", businessId: null }])
  })

  it("adjunta las líneas resueltas y el serviceName seleccionado", async () => {
    mocks.roFindUnique.mockResolvedValue({
      businessId: "biz-1",
      number: 7,
      status: "WAITING_APPROVAL",
      customerName: "Cliente",
      equipmentType: "Celular",
      brand: "Apple",
      model: "iPhone 12",
      equipmentColor: null,
      reportedIssue: "no enciende",
      serviceName: "Cambio de pantalla + Batería",
      diagnosis: null,
      quoteCents: 120000,
      approvedQuoteCents: null,
      quoteApprovedAt: null,
      quoteExpiresAt: null,
      createdAt: new Date(),
      createdBy: { name: "Staff" },
      parts: [],
      events: [],
    })
    const result = await loadQuoteByToken("tok-1")
    expect(mocks.roFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { quoteToken: "tok-1" } }))
    expect(result?.serviceLines).toEqual([
      { name: "Cambio de pantalla", priceCents: 80000 },
      { name: "Batería", priceCents: 40000 },
    ])
    // La suma explica la mano de obra: el documento imprime las dos líneas.
    expect(serviceLinesMatchLabor(result!.serviceLines, result!.quoteCents)).toBe(true)
  })

  it("un fallo del lookup de catálogo deja serviceLines vacío sin tumbar el documento", async () => {
    mocks.roFindUnique.mockResolvedValue({ businessId: "biz-1", serviceName: "Cambio de pantalla", equipmentType: "Celular", brand: null, model: null })
    mocks.wsFindMany.mockRejectedValue(new Error("sin conexión"))
    const result = await loadQuoteByToken("tok-1")
    expect(result?.serviceLines).toEqual([])
  })

  it("token sin orden → null", async () => {
    mocks.roFindUnique.mockResolvedValue(null)
    expect(await loadQuoteByToken("tok-x")).toBeNull()
    expect(mocks.wsFindMany).not.toHaveBeenCalled()
  })
})
