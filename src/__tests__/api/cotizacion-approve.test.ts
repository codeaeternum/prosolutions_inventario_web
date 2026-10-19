import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/cotizacion/[token]/approve — decisión pública de la cotización.
 *
 * Cuando la orden es ESPEJO de una delegación (delegatedFromOrderId), la
 * decisión del cliente mueve su etapa (WAITING_APPROVAL → IN_REPAIR /
 * NOT_AUTHORIZED) sin pasar por updateRepair: la sincronización espejo →
 * origen se dispara aquí con el mismo hook post-commit
 * (notifyOriginOfMirrorUpdate, mockeado para espiar la invocación).
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdateMany: vi.fn(),
  eventFindFirst: vi.fn(),
  eventCreate: vi.fn(),
  notifyOrigin: vi.fn(),
  notifyStaff: vi.fn(),
  businessSetting: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: vi.fn(() => true),
  getClientIp: vi.fn(() => "1.2.3.4"),
}))
vi.mock("@/lib/settings", () => ({
  getBusinessSetting: mocks.businessSetting,
}))
vi.mock("@/app/api/notifications/stream/route", () => ({
  sendNotificationToStaff: mocks.notifyStaff,
  sendNotificationToAdmins: vi.fn(async () => {}),
}))
vi.mock("@/lib/domain/delegation", () => ({
  notifyOriginOfMirrorUpdate: mocks.notifyOrigin,
}))

import { POST } from "@/app/api/cotizacion/[token]/approve/route"

const tx = {
  repairOrder: {
    findUnique: mocks.orderFindUnique,
    updateMany: mocks.orderUpdateMany,
  },
  repairEvent: {
    findFirst: mocks.eventFindFirst,
    create: mocks.eventCreate,
  },
}

const REPAIRER = "biz-rep"

// Orden ESPEJO en el tenant reparador: cotización formal presentada, en
// espera de la decisión del cliente.
const mirrorOrder = (over: Record<string, unknown> = {}) => ({
  id: "m1", number: 12, version: 1, status: "WAITING_APPROVAL", businessId: REPAIRER,
  quoteCents: 150000, approvedQuoteCents: null, quoteApprovedAt: null,
  quoteExpiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  events: [{ createdAt: new Date() }],
  createdById: "u-rep", equipmentType: "Celular", brand: "Apple", model: "iPhone 13",
  business: { isActive: true },
  parts: [],
  delegatedFromOrderId: "o1",
  ...over,
})

const post = (body: unknown, token = "tok-1") =>
  POST(
    new Request(`https://app.invalid/api/cotizacion/${token}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.mockImplementation((work: (t: unknown) => unknown) => work(tx))
  mocks.orderFindUnique.mockResolvedValue(mirrorOrder())
  mocks.orderUpdateMany.mockResolvedValue({ count: 1 })
  mocks.eventFindFirst.mockResolvedValue(null)
  mocks.eventCreate.mockResolvedValue({})
  mocks.notifyOrigin.mockResolvedValue(undefined)
  mocks.notifyStaff.mockResolvedValue(undefined)
  mocks.businessSetting.mockResolvedValue(null)
})

describe("decisión sobre orden espejo (delegatedFromOrderId)", () => {
  it("aprobar sincroniza al captador con el hook de espejo→origen", async () => {
    const res = await post({ action: "APPROVE", expectedLaborCents: 150000, expectedPartsCents: 0 })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe("IN_REPAIR")
    expect(mocks.notifyOrigin).toHaveBeenCalledTimes(1)
    expect(mocks.notifyOrigin).toHaveBeenCalledWith(expect.anything(), {
      mirrorBusinessId: REPAIRER,
      mirrorNumber: 12,
      originOrderId: "o1",
      fromStatus: "WAITING_APPROVAL",
      toStatus: "IN_REPAIR",
    })
  })

  it("rechazar también sincroniza (WAITING_APPROVAL → NOT_AUTHORIZED)", async () => {
    const res = await post({ action: "REJECT", expectedLaborCents: 150000 })
    expect(res.status).toBe(200)
    expect(mocks.notifyOrigin).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      originOrderId: "o1",
      fromStatus: "WAITING_APPROVAL",
      toStatus: "NOT_AUTHORIZED",
    }))
  })

  it("una orden normal (sin origen de delegación) NO dispara el hook", async () => {
    mocks.orderFindUnique.mockResolvedValue(mirrorOrder({ delegatedFromOrderId: null }))
    const res = await post({ action: "APPROVE", expectedLaborCents: 150000 })
    expect(res.status).toBe(200)
    expect(mocks.notifyOrigin).not.toHaveBeenCalled()
  })

  it("el SSE al staff de la espejo sigue saliendo con el folio del tenant reparador", async () => {
    const res = await post({ action: "APPROVE", expectedLaborCents: 150000 })
    expect(res.status).toBe(200)
    // El aviso propio de la espejo (staff del taller) no lo sustituye la
    // sincronización al captador: ambos canales corren post-commit.
    expect(mocks.notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({ type: "repair_ready", data: expect.objectContaining({ orderId: "m1", folio: "OT-000012" }) }),
      REPAIRER,
    )
  })
})
