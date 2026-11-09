import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { convenioReport, convenioTotals, isConvenioChargeable, settleConvenio, settleConvenioBatch } from "@/lib/domain/convenio"
import { updateRepair } from "@/lib/domain/workshop"

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

  it("lo saldado usa el monto congelado: editar el precio después no reescribe el histórico", () => {
    const totals = convenioTotals([
      // Se liquidó a 7000 y luego el precio convenio subió a 12000:
      // lo saldado sigue siendo 7000 (snapshot), no lo que diga el precio hoy.
      row({ partnerPriceCents: 12000, convenioSettledAt: new Date(), convenioSettledAmountCents: 7000 }),
    ])
    expect(totals.settledCents).toBe(7000)
  })

  it("una saldada sin snapshot (legacy) cae al precio convenio actual", () => {
    const totals = convenioTotals([
      row({ partnerPriceCents: 9000, convenioSettledAt: new Date(), convenioSettledAmountCents: null }),
    ])
    expect(totals.settledCents).toBe(9000)
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
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairOrder: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  repairEvent: { create: vi.fn() },
  repairPart: { findMany: vi.fn(), updateMany: vi.fn() },
  payment: { findMany: vi.fn() },
  // openRegister: findMany para el conteo por sucursal y updateMany para el
  // lock de fila — el ingreso ya no cae en "cualquier caja del negocio".
  cashRegister: { findMany: vi.fn(), updateMany: vi.fn() },
  cashMovement: { create: vi.fn() },
  branch: { findFirst: vi.fn() },
  systemSettings: { findMany: vi.fn(), findUnique: vi.fn() },
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const convenioOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: BIZ, number: 7, convenioSettledAt: null, convenioSettledAmountCents: null,
  partnerPriceCents: null,
  delegatedOrderId: "m1", originBusinessId: null, delegatedFromOrderId: null, originBusinessName: null,
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
  // La espejo del lado "pagar": el precio convenio se lee de ella por id.
  tx.repairOrder.findUnique.mockResolvedValue({ partnerPriceCents: 35000 })
  tx.repairOrder.findMany.mockResolvedValue([])
  tx.repairOrder.update.mockResolvedValue({})
  tx.repairOrder.updateMany.mockResolvedValue({ count: 1 })
  tx.repairOrder.findUniqueOrThrow.mockResolvedValue({})
  tx.repairEvent.create.mockResolvedValue({})
  tx.repairPart.findMany.mockResolvedValue([])
  tx.repairPart.updateMany.mockResolvedValue({ count: 0 })
  tx.payment.findMany.mockResolvedValue([])
  // Sin caja abierta por defecto: los tests de recordCashIn la habilitan.
  tx.cashRegister.findMany.mockResolvedValue([])
  tx.cashRegister.updateMany.mockResolvedValue({ count: 1 })
  // resolveBranch devuelve la sucursal pedida por id (o la default "b1").
  tx.branch.findFirst.mockImplementation(({ where }: { where: { id?: string } }) =>
    Promise.resolve({ id: where?.id ?? "b1", name: "Sucursal", isActive: true, businessId: BIZ }))
  tx.cashMovement.create.mockResolvedValue({})
  tx.systemSettings.findMany.mockResolvedValue([])
  tx.systemSettings.findUnique.mockResolvedValue(null)
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

  it("al saldar congela el monto: lado pagar toma el precio de la espejo", async () => {
    tx.repairOrder.findUnique.mockResolvedValue({ partnerPriceCents: 35000 })
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.convenioSettledAmountCents).toBe(35000)
    // La espejo se lee solo por id (cross-tenant acotado, como convenioReport).
    expect(tx.repairOrder.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "m1" },
    }))
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ convenioSettledAmountCents: 35000 }),
    }))
    const event = tx.repairEvent.create.mock.calls[0][0] as { data: { detail: string } }
    expect(event.data.detail).toContain("350.00 MXN")
  })

  it("el lado reparador (espejo) registra el pago del captador", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessId: "biz-cap" }))
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.side).toBe("cobrar")
    const event = tx.repairEvent.create.mock.calls[0][0] as { data: { detail: string } }
    expect(event.data.detail).toContain("pago del negocio captador")
  })

  it("el lado cobrar también aplica a la captada de mostrador (solo originBusinessName)", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessName: "Telcel Centro", partnerPriceCents: 25000 }))
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.side).toBe("cobrar")
    // El snapshot congela el partnerPriceCents propio: no hay espejo que leer.
    expect(result.convenioSettledAmountCents).toBe(25000)
    expect(tx.repairOrder.findUnique).not.toHaveBeenCalled()
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ convenioSettledAmountCents: 25000 }),
    }))
  })

  it("recordCashIn registra UN CashMovement IN en la caja abierta del negocio", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessName: "Telcel Centro", partnerPriceCents: 25000 }))
    tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-1" }])
    await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true, recordCashIn: true })
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: BIZ, registerId: "reg-1", type: "IN", amount: 250,
        referenceType: "CONVENIO",
        description: "Convenio Telcel Centro · OT-000007",
      }),
    }))
  })

  it("recordCashIn asienta el IN en la caja de LA SUCURSAL de la orden, con lock", async () => {
    // La orden vive en b-order: el ingreso busca caja ahí, no en cualquier
    // caja abierta del negocio. Además openRegister bloquea la fila.
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessName: "Telcel Centro", partnerPriceCents: 25000, currentBranchId: "b-order" }))
    tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-order" }])
    await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true, recordCashIn: true })
    expect(tx.cashRegister.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "OPEN", branchId: "b-order", businessId: BIZ }),
    }))
    expect(tx.cashRegister.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "reg-order", status: "OPEN" }),
    }))
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ registerId: "reg-order" }),
    }))
  })

  it("recordCashIn sin caja abierta falla ANTES de tocar la orden", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessName: "Telcel Centro", partnerPriceCents: 25000 }))
    await expect(settleConvenio(db, admin.id, BIZ, { ...payload, settled: true, recordCashIn: true }))
      .rejects.toMatchObject({ status: 409, code: "REGISTER_REQUIRED" })
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
    expect(tx.repairEvent.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("el lado cobrar congela su propio partnerPriceCents sin leer espejos", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ delegatedOrderId: null, originBusinessId: "biz-cap", partnerPriceCents: 42000 }))
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.convenioSettledAmountCents).toBe(42000)
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ convenioSettledAmountCents: 42000 }),
    }))
    // El precio es el propio: no hay lectura cross-tenant.
    expect(tx.repairOrder.findUnique).not.toHaveBeenCalled()
  })

  it("saldar una cuenta sin precio convenio congela null", async () => {
    tx.repairOrder.findUnique.mockResolvedValue({ partnerPriceCents: null })
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: true })
    expect(result.convenioSettledAmountCents).toBeNull()
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ convenioSettledAmountCents: null }),
    }))
  })

  it("reabrir pone convenioSettledAt y el monto congelado en null", async () => {
    tx.repairOrder.findFirst.mockResolvedValue(convenioOrder({ convenioSettledAt: new Date(), convenioSettledAmountCents: 35000 }))
    const result = await settleConvenio(db, admin.id, BIZ, { ...payload, settled: false })
    expect(result.convenioSettledAt).toBeNull()
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ convenioSettledAt: null, convenioSettledAmountCents: null }),
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
    // Aliado con tenant ligado (intake /api/workshop/partner): no es mostrador.
    originBusinessId: "biz-cap", delegatedFromOrderId: null,
    originBusiness: { name: "Captador SA" },
  }

  function fakeDb(opts: { outgoing?: unknown[]; incoming?: unknown[]; mirrors?: unknown[]; events?: unknown[] }) {
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
      repairEvent: {
        // Fiel al filtro del dominio: type exacto y el OR de "mis órdenes con
        // businessId" / "espejos solo por id" (cross-tenant acotado).
        findMany: vi.fn(({ where }: { where: { type: string; OR: { businessId?: string; orderId: { in: string[] } }[] } }) =>
          Promise.resolve(
            (opts.events ?? [])
              .filter((e): e is { orderId: string; type: string; createdAt: Date; businessId?: string } =>
                typeof e === "object" && e !== null)
              .filter(e =>
                e.type === where.type &&
                where.OR.some(branch =>
                  branch.orderId.in.includes(e.orderId) &&
                  (branch.businessId === undefined || e.businessId === branch.businessId))),
          )),
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

  it("el reporte lleva el monto congelado y los totales saldados lo usan", async () => {
    const db = fakeDb({
      outgoing: [{ ...outgoingRow, convenioSettledAt: new Date(), convenioSettledAmountCents: 30000 }],
      incoming: [{ ...incomingRow, convenioSettledAt: new Date(), convenioSettledAmountCents: 42000, partnerPriceCents: 60000 }],
      mirrors: [{ id: "m1", number: 12, businessId: "biz-rep", status: "DELIVERED", partnerPriceCents: 50000 }],
    })
    const report = await convenioReport(db, BIZ)
    // Aunque el precio convenio cambió después de liquidar (50000/60000
    // hoy), lo saldado se queda en lo que se congeló al pagar.
    expect(report.porPagar.rows[0].convenioSettledAmountCents).toBe(30000)
    expect(report.porPagar.totals.settledCents).toBe(30000)
    expect(report.porCobrar.rows[0].convenioSettledAmountCents).toBe(42000)
    expect(report.porCobrar.totals.settledCents).toBe(42000)
  })

  it("porCobrar incluye la captada de mostrador (solo originBusinessName) marcada walkIn", async () => {
    const db = fakeDb({
      incoming: [
        // Aliado sin cuenta: originBusinessName en texto, sin ligadura
        // (originBusinessId ni espejo) — el WHERE del dominio la recoge por
        // el tercer OR y el reporte la distingue con walkIn.
        { id: "w1", number: 21, status: "READY", createdAt: new Date("2026-01-05"),
          convenioSettledAt: null, partnerPriceCents: 18000,
          originContact: "Mostrador", originBusinessName: "Telcel Centro",
          originBusinessId: null, delegatedFromOrderId: null, originBusiness: null },
        incomingRow,
      ],
    })
    const report = await convenioReport(db, BIZ)
    const walkIn = report.porCobrar.rows.find(r => r.orderId === "w1")!
    expect(walkIn).toMatchObject({ captorName: "Telcel Centro", walkIn: true, partnerPriceCents: 18000 })
    // La del aliado ligado (originBusinessId) no es mostrador.
    expect(report.porCobrar.rows.find(r => r.orderId === "m9")!.walkIn).toBe(false)
    expect(report.porCobrar.totals.pendingCents).toBe(18000 + 42000)
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

  // ── Aging: días desde que la orden llegó a estado exigible ──────────────

  const DAYS = 24 * 60 * 60 * 1000
  const daysAgo = (n: number) => new Date(Date.now() - n * DAYS - 1000)

  it("calcula daysPending con el último STATUS (espejo en porPagar, propia en porCobrar)", async () => {
    const mirrorDeliveredAt = daysAgo(12)
    const db = fakeDb({
      outgoing: [outgoingRow],
      incoming: [incomingRow],
      mirrors: [{ id: "m1", number: 12, businessId: "biz-rep", status: "DELIVERED", partnerPriceCents: 35000 }],
      events: [
        // La espejo pasó READY→DELIVERED: pesa el STATUS más reciente.
        { orderId: "m1", businessId: "biz-rep", type: "STATUS", createdAt: daysAgo(40) },
        { orderId: "m1", businessId: "biz-rep", type: "STATUS", createdAt: mirrorDeliveredAt },
        // Mi orden entrante lleva 3 días en READY; eventos que no son STATUS
        // (notas, abonos) no mueven la fecha de exigibilidad.
        { orderId: "m9", businessId: BIZ, type: "STATUS", createdAt: daysAgo(3) },
        { orderId: "m9", businessId: BIZ, type: "NOTE", createdAt: daysAgo(1) },
      ],
    })
    const report = await convenioReport(db, BIZ)
    expect(report.porPagar.rows[0].daysPending).toBe(12)
    expect(report.porPagar.rows[0].chargeableAt).toEqual(mirrorDeliveredAt)
    expect(report.porCobrar.rows[0].daysPending).toBe(3)
  })

  it("ordena por mayor antigüedad y manda saldadas/en proceso al fondo, sin aging", async () => {
    const db = fakeDb({
      incoming: [
        { ...incomingRow, id: "a", number: 1, convenioSettledAt: new Date() },               // saldada
        { ...incomingRow, id: "b", number: 2, status: "IN_REPAIR", partnerPriceCents: 5000 }, // en proceso
        { ...incomingRow, id: "c", number: 3 },                                             // pendiente 2d
        { ...incomingRow, id: "d", number: 4 },                                             // pendiente 30d
      ],
      events: [
        // Aunque la saldada tenga STATUS viejísimo, no se consulta ni envejece.
        { orderId: "a", businessId: BIZ, type: "STATUS", createdAt: daysAgo(90) },
        { orderId: "c", businessId: BIZ, type: "STATUS", createdAt: daysAgo(2) },
        { orderId: "d", businessId: BIZ, type: "STATUS", createdAt: daysAgo(30) },
      ],
    })
    const report = await convenioReport(db, BIZ)
    expect(report.porCobrar.rows.map(r => r.orderId)).toEqual(["d", "c", "a", "b"])
    expect(report.porCobrar.rows[0].daysPending).toBe(30)
    const settled = report.porCobrar.rows.find(r => r.orderId === "a")!
    expect(settled.daysPending).toBeNull()
    expect(settled.chargeableAt).toBeNull()
    expect(report.porCobrar.rows.find(r => r.orderId === "b")!.daysPending).toBeNull()
    // La saldada ni siquiera entra en la query de eventos.
    const eventCall = (db.repairEvent.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      where: { OR: { businessId?: string; orderId: { in: string[] } }[] }
    }
    const ownIds = eventCall.where.OR.find(b => b.businessId === BIZ)!.orderId.in
    expect(ownIds).toEqual(expect.arrayContaining(["c", "d"]))
    expect(ownIds).not.toContain("a")
    expect(ownIds).not.toContain("b")
  })

  it("exigible sin eventos STATUS queda sin antigüedad (histórica sin bitácora)", async () => {
    const db = fakeDb({ incoming: [incomingRow], events: [] })
    const report = await convenioReport(db, BIZ)
    expect(report.porCobrar.rows[0].chargeable).toBe(true)
    expect(report.porCobrar.rows[0].daysPending).toBeNull()
    expect(report.porCobrar.rows[0].chargeableAt).toBeNull()
  })
})

// ── settleConvenioBatch: liquidación en lote del mismo lado ─────────────────
// repairOrder.findMany discrimina por `where`: con businessId son las órdenes
// propias del lote; solo por id son las espejos del lado pagar (cross-tenant
// acotado — mismo patrón que convenioReport).
const batchOrders = (rows: unknown[], mirrors: unknown[] = []) =>
  tx.repairOrder.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(where.businessId ? rows : mirrors))

describe("settleConvenioBatch", () => {
  const batchPayload = (over: Record<string, unknown> = {}) => ({
    orderIds: ["o1", "o2"], settled: true, idempotencyKey: "convenio-batch-1", ...over,
  })
  const cobrar = (id: string, over: Record<string, unknown> = {}) =>
    convenioOrder({ id, delegatedOrderId: null, originBusinessName: "Telcel Centro", ...over })

  it("salda N órdenes del mismo lado con su snapshot y suma el total", async () => {
    batchOrders([
      cobrar("o1", { number: 21, partnerPriceCents: 20000 }),
      cobrar("o2", { number: 22, partnerPriceCents: 30000 }),
    ])
    const result = await settleConvenioBatch(db, admin.id, BIZ, batchPayload())
    expect(result.side).toBe("cobrar")
    expect(result.settled).toEqual([
      { orderId: "o1", amountCents: 20000 },
      { orderId: "o2", amountCents: 30000 },
    ])
    expect(result.skipped).toEqual([])
    expect(result.totalCents).toBe(50000)
    // Un update y UN solo RepairEvent por cada orden marcada.
    expect(tx.repairOrder.update).toHaveBeenCalledTimes(2)
    expect(tx.repairOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "o2" },
      data: expect.objectContaining({ convenioSettledAt: expect.any(Date), convenioSettledAmountCents: 30000 }),
    }))
    expect(tx.repairEvent.create).toHaveBeenCalledTimes(2)
  })

  it("del lado pagar toma el snapshot de la espejo por id", async () => {
    batchOrders(
      [convenioOrder({ id: "o1" })],           // delegatedOrderId "m1" → pagar
      [{ id: "m1", partnerPriceCents: 35000 }],
    )
    const result = await settleConvenioBatch(db, admin.id, BIZ, batchPayload({ orderIds: ["o1"] }))
    expect(result.side).toBe("pagar")
    expect(result.settled).toEqual([{ orderId: "o1", amountCents: 35000 }])
    expect(result.totalCents).toBe(35000)
    // La espejo se leyó solo por id (sin businessId: cross-tenant acotado).
    const mirrorCall = tx.repairOrder.findMany.mock.calls
      .map(call => call[0] as { where: Record<string, unknown> })
      .find(args => !args.where.businessId)
    expect(mirrorCall?.where).toEqual({ id: { in: ["m1"] } })
  })

  it("salta idempotentemente las que ya están en el estado pedido", async () => {
    batchOrders([
      cobrar("o1", { partnerPriceCents: 20000 }),
      cobrar("o2", { convenioSettledAt: new Date(), convenioSettledAmountCents: 15000 }),
    ])
    const result = await settleConvenioBatch(db, admin.id, BIZ, batchPayload())
    expect(result.skipped).toEqual(["o2"])
    expect(result.settled).toEqual([{ orderId: "o1", amountCents: 20000 }])
    expect(result.totalCents).toBe(20000)
    expect(tx.repairOrder.update).toHaveBeenCalledTimes(1)
    expect(tx.repairEvent.create).toHaveBeenCalledTimes(1)
  })

  it("rechaza un lote que mezcla lado cobrar y lado pagar", async () => {
    batchOrders([
      cobrar("o1"),
      convenioOrder({ id: "o2" }), // delegatedOrderId → pagar
    ])
    await expect(settleConvenioBatch(db, admin.id, BIZ, batchPayload()))
      .rejects.toMatchObject({ status: 409 })
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
    expect(tx.repairEvent.create).not.toHaveBeenCalled()
  })

  it("rechaza una orden que no pertenece a ningún convenio", async () => {
    batchOrders([
      cobrar("o1"),
      convenioOrder({ id: "o2", delegatedOrderId: null }), // sin origen: no es cuenta B2B
    ])
    await expect(settleConvenioBatch(db, admin.id, BIZ, batchPayload()))
      .rejects.toMatchObject({ status: 409 })
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
  })

  it("si falta alguna orden (ajena o inexistente) responde 404 sin tocar nada", async () => {
    batchOrders([]) // las dos pedidas son de otro tenant / no existen
    await expect(settleConvenioBatch(db, admin.id, BIZ, batchPayload()))
      .rejects.toMatchObject({ status: 404 })
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
    expect(tx.repairEvent.create).not.toHaveBeenCalled()
  })

  it("recordCashIn crea UN CashMovement IN por el total con los folios en la descripción", async () => {
    batchOrders([
      cobrar("o1", { number: 21, partnerPriceCents: 20000 }),
      cobrar("o2", { number: 22, partnerPriceCents: 30000 }),
    ])
    tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-1" }])
    const result = await settleConvenioBatch(db, admin.id, BIZ, batchPayload({ recordCashIn: true }))
    expect(result.totalCents).toBe(50000)
    expect(tx.cashMovement.create).toHaveBeenCalledTimes(1)
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: BIZ, registerId: "reg-1", type: "IN", amount: 500,
        referenceType: "CONVENIO",
        description: "Convenio Telcel Centro · OT-000021, OT-000022",
      }),
    }))
  })

  it("el lote asienta el IN en la caja de la sucursal base de quien liquida", async () => {
    // Un lote puede mezclar órdenes de varias sucursales: el ingreso cae en
    // la caja de la homeBranchId del admin que cobra (o la branchId enviada).
    batchOrders([
      cobrar("o1", { number: 21, partnerPriceCents: 20000, currentBranchId: "b-a" }),
      cobrar("o2", { number: 22, partnerPriceCents: 30000, currentBranchId: "b-b" }),
    ])
    tx.user.findUnique.mockResolvedValue({ ...admin, homeBranchId: "b-home" })
    tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-home" }])
    await settleConvenioBatch(db, admin.id, BIZ, batchPayload({ recordCashIn: true }))
    expect(tx.cashRegister.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "OPEN", branchId: "b-home", businessId: BIZ }),
    }))
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ registerId: "reg-home" }),
    }))
  })

  it("recordCashIn sin caja abierta falla antes de marcar ninguna orden", async () => {
    batchOrders([
      cobrar("o1", { partnerPriceCents: 20000 }),
      cobrar("o2", { partnerPriceCents: 30000 }),
    ])
    await expect(settleConvenioBatch(db, admin.id, BIZ, batchPayload({ recordCashIn: true })))
      .rejects.toMatchObject({ status: 409, code: "REGISTER_REQUIRED" })
    expect(tx.repairOrder.update).not.toHaveBeenCalled()
    expect(tx.repairEvent.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })
})

// ── updateRepair: entrega al aliado y precio convenio editable ───────────────
// Mismo tx falso: el dominio corre de verdad — para SETTLE_DELIVER se pueblan
// las lecturas de refacciones/pagos/ajustes que la acción consulta.

const workshopOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: BIZ, number: 7, version: 3, status: "READY",
  customerId: "cust-1", customerPhone: "8112345678", customerPhoneAlt: null,
  quoteCents: null, approvedQuoteCents: null, quoteApprovedAt: null, diagnosticFeeCents: null,
  closedWithoutRepair: false, currentBranchId: "b1",
  warrantyUntil: null, warrantyCount: 0, warrantyEligibleUntil: null,
  delegatedOrderId: null, delegatedFromOrderId: null,
  originBusinessId: null, originBusinessName: null, partnerPriceCents: null,
  ...over,
})
let deliverOp = 0
const deliverPayload = (over: Record<string, unknown>) => ({ idempotencyKey: `deliver-op-${++deliverOp}`, expectedVersion: 3, ...over })

describe("deliveredToParty en SETTLE_DELIVER", () => {
  it("PARTNER en una orden de convenio asienta 'Entregado al aliado {nombre}' sin mover dinero ni receptor", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(workshopOrder({ originBusinessName: "Telcel Centro" }))
    await updateRepair(db, admin.id, BIZ, "o1", deliverPayload({ action: "SETTLE_DELIVER", deliveredTo: "Encargado Telcel", deliveredToParty: "PARTNER" }))
    const paymentEvent = tx.repairEvent.create.mock.calls
      .map(call => (call[0] as { data: { type: string; detail: string } }).data)
      .find(event => event.type === "PAYMENT")
    expect(paymentEvent?.detail).toContain("Entregado al aliado Telcel Centro")
    expect(paymentEvent?.detail).not.toContain("Entrega a:")
    // Estado y constancia intactos: sigue siendo entrega con receptor propio.
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", deliveredTo: "Encargado Telcel" }),
    }))
  })

  it("CUSTOMER (o sin el flag) conserva el texto habitual 'Entrega a:'", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(workshopOrder({ originBusinessName: "Telcel Centro" }))
    await updateRepair(db, admin.id, BIZ, "o1", deliverPayload({ action: "SETTLE_DELIVER", deliveredTo: "La clienta", deliveredToParty: "CUSTOMER" }))
    const paymentEvent = tx.repairEvent.create.mock.calls
      .map(call => (call[0] as { data: { type: string; detail: string } }).data)
      .find(event => event.type === "PAYMENT")
    expect(paymentEvent?.detail).toContain("Entrega a: La clienta")
  })
})

describe("partnerPriceCents editable por updateRepair", () => {
  it("persiste el cambio y deja NOTE privado 'Precio convenio: $X → $Y'", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(workshopOrder({ partnerPriceCents: 20000 }))
    await updateRepair(db, admin.id, BIZ, "o1", deliverPayload({ action: "NOTE", detail: "Ajuste de convenio", partnerPriceCents: 25000 }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ partnerPriceCents: 25000 }),
    }))
    const priceNote = tx.repairEvent.create.mock.calls
      .map(call => (call[0] as { data: { type: string; detail: string; isPublic: boolean } }).data)
      .find(event => event.detail.startsWith("Precio convenio"))
    expect(priceNote?.detail).toBe("Precio convenio: $200.00 → $250.00 MXN")
    expect(priceNote?.isPublic).toBe(false)
  })

  it("se puede limpiar con null y no deja nota cuando el valor no cambia", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(workshopOrder({ partnerPriceCents: 20000 }))
    await updateRepair(db, admin.id, BIZ, "o1", deliverPayload({ action: "NOTE", detail: "Sin convenio", partnerPriceCents: null }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ partnerPriceCents: null }),
    }))
    // Segundo update con el MISMO valor: no se reescribe ni se anota.
    tx.repairOrder.findUnique.mockResolvedValue(workshopOrder({ partnerPriceCents: 20000 }))
    await updateRepair(db, admin.id, BIZ, "o1", deliverPayload({ action: "NOTE", detail: "Sin cambio", partnerPriceCents: 20000 }))
    const lastData = (tx.repairOrder.updateMany.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data
    expect("partnerPriceCents" in lastData).toBe(false)
    // En ambas llamadas solo hubo UN "Precio convenio" (el primer cambio).
    const priceNotes = tx.repairEvent.create.mock.calls
      .map(call => (call[0] as { data: { detail: string } }).data)
      .filter(event => event.detail.startsWith("Precio convenio"))
    expect(priceNotes).toHaveLength(1)
  })
})
