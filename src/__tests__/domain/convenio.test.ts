import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { convenioReport, convenioTotals, isConvenioChargeable, settleConvenio } from "@/lib/domain/convenio"

/**
 * Convenio B2B entre talleres: agregado de saldos (puro) y el toggle de
 * cuenta saldada sobre mocks de tx (mismo patrón que delegation.test.ts:
 * db.$transaction entrega el mock y operation() corre dentro).
 */

const BIZ = "biz-1"
const admin = { id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ }

const row = (over: Partial<Parameters<typeof convenioTotals>[0][number]> = {}) => ({
  chargeable: true, partnerPriceCents: 10000, convenioSettledAt: null, ...over,
})

describe("convenioTotals", () => {
  it("suma solo las cuentas exigibles y no saldadas", () => {
    const totals = convenioTotals([
      row({ partnerPriceCents: 10000 }),
      row({ partnerPriceCents: 5000 }),
      row({ partnerPriceCents: 7000, convenioSettledAt: new Date() }), // saldada → settledCents
      row({ partnerPriceCents: 9000, chargeable: false }),            // en proceso → fuera
    ])
    expect(totals).toEqual({ pendingCents: 15000, settledCents: 7000, unpricedPending: 0 })
  })

  it("las canceladas/cerradas sin exigibilidad no suman pendiente", () => {
    const totals = convenioTotals([
      row({ chargeable: false, partnerPriceCents: 3000 }),
      row({ chargeable: false, partnerPriceCents: 2000 }),
    ])
    expect(totals.pendingCents).toBe(0)
  })

  it("cuenta las exigibles sin precio convenio aparte (no suman centavos)", () => {
    const totals = convenioTotals([
      row({ partnerPriceCents: null }),
      row({ partnerPriceCents: null, convenioSettledAt: new Date() }), // saldada sin precio: ni pendiente ni unpriced
      row({ partnerPriceCents: 4000 }),
    ])
    expect(totals).toEqual({ pendingCents: 4000, settledCents: 0, unpricedPending: 1 })
  })
})

describe("isConvenioChargeable", () => {
  it.each(["READY", "DELIVERED", "NOT_REPAIRED", "NOT_AUTHORIZED", "WARRANTY"] as const)(
    "exigible en %s", status => expect(isConvenioChargeable(status)).toBe(true))
  it.each(["RECEIVED", "DIAGNOSIS", "IN_REPAIR", "EXTERNAL_LAB", "CANCELLED"] as const)(
    "no exigible en %s", status => expect(isConvenioChargeable(status)).toBe(false))
  it("espejo perdida (null) no es exigible", () => expect(isConvenioChargeable(null)).toBe(false))
})

// ── settleConvenio sobre tx falso ────────────────────────────────────────────

const tx = {
  user: { findUnique: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairOrder: { findFirst: vi.fn(), update: vi.fn() },
  repairEvent: { create: vi.fn() },
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const convenioOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: BIZ, convenioSettledAt: null,
  delegatedOrderId: "m1", originBusinessId: null, delegatedFromOrderId: null,
  ...over,
})
const payload = { orderId: "o1", idempotencyKey: "convenio-test-1" }

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(admin)
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.repairOrder.findFirst.mockResolvedValue(convenioOrder())
  tx.repairOrder.update.mockResolvedValue({})
  tx.repairEvent.create.mockResolvedValue({})
})

describe("settleConvenio", () => {
  it("marca la orden delegada como pagada y deja evento privado", async () => {
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.side).toBe("pagar")
    // operation() serializa el recibo a JSON: la fecha regresa como ISO.
    expect(typeof result.convenioSettledAt).toBe("string")
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "o1" },
      data: expect.objectContaining({ convenioSettledAt: expect.any(Date) }),
    }))
    const event = tx.repairEvent.create.mock.calls[0][0] as { data: { detail: string; isPublic: boolean } }
    expect(event.data.isPublic).toBe(false)
    expect(event.data.detail).toContain("pago al taller asociado")
  })

  it("el lado reparador (espejo) registra el pago del captador", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessId: "biz-cap" }))
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.side).toBe("cobrar")
    const event = tx.repairEvent.create.mock.calls[0][0] as { data: { detail: string } }
    expect(event.data.detail).toContain("pago del negocio captador")
  })

  it("reabrir pone convenioSettledAt en null", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ convenioSettledAt: new Date() }))
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: false })
    expect(result.convenioSettledAt).toBeNull()
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ convenioSettledAt: null }),
    }))
  })

  it("pedir el estado que ya tiene es un no-op idempotente", async () => {
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: false })
    expect(result.convenioSettledAt).toBeNull()
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
    expect(tx.repairEvent.create).not.toHaveBeenCalled()
  })

  it("una orden sin convenio se rechaza (409)", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null }))
    await expect(settleConvenio(db, admin.id, BIZ, { ...payload, settled: true }))
      .rejects.toMatchObject({ status: 409 })
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
  })

  it("una orden de otro tenant (o inexistente) responde 404", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(null)
    await expect(settleConvenio(db, admin.id, BIZ, { ...payload, settled: true }))
      .rejects.toMatchObject({ status: 404 })
  })
})

// ── convenioReport sobre db falso ────────────────────────────────────────────

describe("convenioReport", () => {
  const outgoingRow = {
    id: "o1", number: 7, delegatedOrderId: "m1", delegatedAt: new Date("2026-01-10"),
    convenioSettledAt: null, delegatedToBusiness: { name: "Reparador SA" },
  }
  const incomingRow = {
    id: "m9", number: 3, status: "READY", createdAt: new Date("2026-01-05"),
    convenioSettledAt: null, partnerPriceCents: 42000,
    originContact: "OT-000007", originBusinessName: "Captador SA",
    originBusiness: { name: "Captador SA" },
  }

  function fakeDb(opts: { outgoing?: unknown[]; incoming?: unknown[]; mirrors?: unknown[] }) {
    return {
      repairOrder: {
        // La primera llamada filtra delegatedOrderId (salientes), la segunda
        // usa OR de origen (entrantes) y la tercera lee espejos por id.
        findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
          if (where.delegatedOrderId) return Promise.resolve(opts.outgoing ?? [])
          if (where.OR) return Promise.resolve(opts.incoming ?? [])
          return Promise.resolve(opts.mirrors ?? [])
        }),
      },
      systemSettings: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient
  }

  it("arma ambos lados: folio local, folio espejo, status y totales", async () => {
    const db = fakeDb({
      outgoing: [outgoingRow],
      incoming: [incomingRow],
      mirrors: [{ id: "m1", number: 12, businessId: "biz-rep", status: "DELIVERED", partnerPriceCents: 35000 }],
    })
    const report = await convenioReport(db, BIZ)
    expect(report.porPagar.rows[0]).toMatchObject({
      orderId: "o1", folio: "OT-000007", mirrorFolio: "OT-000012",
      partnerName: "Reparador SA", mirrorStatus: "DELIVERED",
      partnerPriceCents: 35000, chargeable: true, convenioSettledAt: null,
    })
    expect(report.porPagar.totals).toEqual({ pendingCents: 35000, settledCents: 0, unpricedPending: 0 })
    expect(report.porCobrar.rows[0]).toMatchObject({
      orderId: "m9", folio: "OT-000003", captorName: "Captador SA",
      originFolio: "OT-000007", status: "READY", partnerPriceCents: 42000, chargeable: true,
    })
    expect(report.porCobrar.totals.pendingCents).toBe(42000)
  })

  it("la espejo cancelada y la saldada no suman al pendiente por pagar", async () => {
    const db = fakeDb({
      outgoing: [
        outgoingRow,
        { ...outgoingRow, id: "o2", number: 8, delegatedOrderId: "m2" },
        { ...outgoingRow, id: "o3", number: 9, delegatedOrderId: "m3", convenioSettledAt: new Date() },
      ],
      mirrors: [
        { id: "m1", number: 12, businessId: "biz-rep", status: "DELIVERED", partnerPriceCents: 35000 },
        { id: "m2", number: 13, businessId: "biz-rep", status: "CANCELLED", partnerPriceCents: 10000 },
        { id: "m3", number: 14, businessId: "biz-rep", status: "DELIVERED", partnerPriceCents: 20000 },
      ],
    })
    const report = await convenioReport(db, BIZ)
    expect(report.porPagar.totals).toEqual({ pendingCents: 35000, settledCents: 20000, unpricedPending: 0 })
  })

  it("espejo sin precio convenio marca unpricedPending y fila sin monto", async () => {
    const db = fakeDb({
      outgoing: [outgoingRow],
      mirrors: [{ id: "m1", number: 12, businessId: "biz-rep", status: "READY", partnerPriceCents: null }],
    })
    const report = await convenioReport(db, BIZ)
    expect(report.porPagar.rows[0].partnerPriceCents).toBeNull()
    expect(report.porPagar.totals).toEqual({ pendingCents: 0, settledCents: 0, unpricedPending: 1 })
  })

  it("solo lee las espejos vinculadas a mis órdenes (cross-tenant acotado)", async () => {
    const db = fakeDb({ outgoing: [outgoingRow], mirrors: [] })
    await convenioReport(db, BIZ)
    const calls = (db.repairOrder.findMany as ReturnType<typeof vi.fn>).mock.calls
    const mirrorCall = calls.find(([args]) => (args as { where: { id?: { in?: string[] } } }).where.id)
    expect(mirrorCall).toBeDefined()
    expect((mirrorCall![0] as { where: { id: { in: string[] } } }).where.id.in).toEqual(["m1"])
  })
})
