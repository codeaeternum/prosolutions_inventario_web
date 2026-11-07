import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * loadQuoteByToken: la página pública /cotizacion/[token] (y /<slug>/…)
 * consulta por el quoteToken. Un negocio suspendido (business.isActive =
 * false) se sirve igual que un token inválido — null → "no encontrada",
 * igual que la API pública que ya responde 404.
 */
const mocks = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  serviceFindMany: vi.fn(),
  modelFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique },
    workshopService: { findMany: mocks.serviceFindMany },
    deviceModel: { findMany: mocks.modelFindMany },
  },
}))

import { loadQuoteByToken } from "@/lib/public-quote"

const quoteOrder = {
  businessId: "biz-1",
  business: { isActive: true },
  number: 9, status: "WAITING_APPROVAL", customerName: "Ana",
  equipmentType: "Celular", brand: "Moto", model: "G", equipmentColor: null,
  reportedIssue: "No enciende", serviceName: null, diagnosis: null,
  quoteCents: 150000, approvedQuoteCents: null, quoteApprovedAt: null,
  quoteExpiresAt: null, createdAt: new Date(), createdBy: { name: "Staff" },
  parts: [], events: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.orderFindUnique.mockResolvedValue(quoteOrder)
  mocks.serviceFindMany.mockResolvedValue([])
  mocks.modelFindMany.mockResolvedValue([])
})

describe("loadQuoteByToken", () => {
  it("devuelve la orden de un negocio activo", async () => {
    const order = await loadQuoteByToken("tok-1")
    expect(order?.number).toBe(9)
    expect(order?.serviceLines).toEqual([])
    // El select pide isActive del negocio — sin él el tenant suspendido
    // se serviría con datos completos en la página pública.
    const args = mocks.orderFindUnique.mock.calls[0][0] as { select?: { business?: unknown } }
    expect(args.select?.business).toEqual({ select: { isActive: true } })
  })

  it("negocio suspendido → null (misma salida que token inválido)", async () => {
    mocks.orderFindUnique.mockResolvedValue({ ...quoteOrder, business: { isActive: false } })
    expect(await loadQuoteByToken("tok-1")).toBeNull()
  })

  it("token desconocido → null", async () => {
    mocks.orderFindUnique.mockResolvedValue(null)
    expect(await loadQuoteByToken("tok-x")).toBeNull()
  })
})
