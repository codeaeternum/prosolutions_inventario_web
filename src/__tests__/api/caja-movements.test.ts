import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/caja/movements — vista unificada "movimientos de dinero" para
 * auditoría: CashMovement + Payment + CreditMovement + SupplierPayment en
 * una sola lista normalizada con monto en centavos y signo.
 *
 * Se ejercita el handler real con Request/Response verificando el gate del
 * módulo caja, el aislamiento por tenant, el filtro/ámbito de sucursal, la
 * normalización de las cuatro fuentes y el tope `take` del merge.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cashMovementFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
  creditMovementFindMany: vi.fn(),
  supplierPaymentFindMany: vi.fn(),
  folioDigits: vi.fn(),
  businessSetting: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    cashMovement: { findMany: mocks.cashMovementFindMany },
    payment: { findMany: mocks.paymentFindMany },
    creditMovement: { findMany: mocks.creditMovementFindMany },
    supplierPayment: { findMany: mocks.supplierPaymentFindMany },
  },
}))
vi.mock("@/lib/settings", () => ({ getOrderFolioDigits: mocks.folioDigits, getBusinessSetting: mocks.businessSetting }))

import { GET } from "@/app/api/caja/movements/route"

const session = (id: string, role = "ADMIN", extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})
const get = (query = "") => GET(new Request(`https://app.invalid/api/caja/movements${query}`))

const cash = (over: Record<string, unknown> = {}) => ({
  id: "cm-1",
  type: "IN",
  amount: 250,
  description: "Venta V-7",
  referenceType: "SALE",
  referenceId: "sale-7",
  userId: "emp-1",
  createdAt: new Date("2025-06-10T18:00:00Z"),
  register: { branchId: "b-1", branch: { name: "Centro" } },
  user: { name: "María Mostrador" },
  payment: { method: "CASH", reference: null, saleId: "sale-7", repairOrderId: null, encargoId: null },
  ...over,
})
const payment = (over: Record<string, unknown> = {}) => ({
  id: "pay-1",
  method: "CARD",
  amount: 1200,
  status: "CONFIRMED",
  purpose: null,
  reference: "AUTH-123",
  notes: null,
  saleId: "sale-8",
  repairOrderId: null,
  encargoId: null,
  createdById: "emp-1",
  createdAt: new Date("2025-06-10T19:00:00Z"),
  sale: { id: "sale-8", number: 8, branchId: "b-1", branch: { name: "Centro" } },
  repairOrder: null,
  encargo: null,
  createdBy: { name: "María Mostrador" },
  ...over,
})
const credit = (over: Record<string, unknown> = {}) => ({
  id: "cred-1",
  type: "PAYMENT",
  amount: 400,
  referenceType: "MANUAL",
  referenceId: null,
  notes: "Abono mostrador",
  userId: "cust-1",
  createdAt: new Date("2025-06-10T20:00:00Z"),
  user: { id: "cust-1", name: "Taller Ruiz" },
  ...over,
})
const supplierPay = (over: Record<string, unknown> = {}) => ({
  id: "sp-1",
  amountCents: 80000,
  method: "TRANSFER",
  notes: null,
  createdById: "admin-1",
  createdAt: new Date("2025-06-10T21:00:00Z"),
  supplier: { name: "Celuparts" },
  purchase: { number: 42, branchId: "b-1", branch: { name: "Centro" } },
  createdBy: { name: "Dueña" },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session("u-admin"))
  // 1ª llamada: filas de caja; 2ª: asientos ligados a crédito/proveedor (dedup).
  mocks.cashMovementFindMany.mockResolvedValue([])
  mocks.paymentFindMany.mockResolvedValue([])
  mocks.creditMovementFindMany.mockResolvedValue([])
  mocks.supplierPaymentFindMany.mockResolvedValue([])
  mocks.folioDigits.mockResolvedValue(6)
  mocks.businessSetting.mockResolvedValue(null)
})

describe("acceso", () => {
  it("sin sesión responde 401 y no consulta nada", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(401)
    expect(mocks.cashMovementFindMany).not.toHaveBeenCalled()
    expect(mocks.paymentFindMany).not.toHaveBeenCalled()
  })

  it("cliente responde 403", async () => {
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    const res = await get()
    expect(res.status).toBe(403)
  })

  it("empleado con branchId ajeno a sus sucursales responde 403", async () => {
    mocks.auth.mockResolvedValue(session("e-1", "EMPLOYEE", { allowedBranchIds: ["b-1"] }))
    const res = await get("?branchId=b-2")
    expect(res.status).toBe(403)
  })
})

describe("aislamiento y filtros", () => {
  it("las cuatro fuentes filtran por el businessId de la sesión y la ventana de días", async () => {
    await get("?days=30")
    const spies = [mocks.cashMovementFindMany, mocks.paymentFindMany, mocks.creditMovementFindMany, mocks.supplierPaymentFindMany]
    for (const spy of spies) {
      const where = spy.mock.calls[0][0].where
      expect(where.businessId).toBe("biz-1")
      expect(where.createdAt.gte.getTime()).toBeLessThanOrEqual(Date.now() - 29 * 24 * 60 * 60 * 1000)
      expect(where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 31 * 24 * 60 * 60 * 1000)
    }
  })

  it("days por defecto es 7 y se acota a 90", async () => {
    await get()
    const def = mocks.cashMovementFindMany.mock.calls[0][0].where.createdAt.gte.getTime()
    expect(def).toBeGreaterThan(Date.now() - 8 * 24 * 60 * 60 * 1000)
    expect(def).toBeLessThanOrEqual(Date.now() - 6 * 24 * 60 * 60 * 1000)

    await get("?days=999")
    const capped = mocks.cashMovementFindMany.mock.calls[1][0].where.createdAt.gte.getTime()
    expect(capped).toBeGreaterThan(Date.now() - 91 * 24 * 60 * 60 * 1000)
    expect(capped).toBeLessThanOrEqual(Date.now() - 89 * 24 * 60 * 60 * 1000)
  })

  it("branchId llega a caja (register), cobros (venta/orden/encargo) y proveedores (OC o cuenta general)", async () => {
    await get("?branchId=b-9")
    expect(mocks.cashMovementFindMany.mock.calls[0][0].where.register).toEqual({ branchId: "b-9" })
    const payWhere = mocks.paymentFindMany.mock.calls[0][0].where
    expect(payWhere.OR).toEqual([
      { sale: { branchId: "b-9" } },
      { repairOrder: { currentBranchId: "b-9" } },
      { encargo: { branchId: "b-9" } },
    ])
    const supWhere = mocks.supplierPaymentFindMany.mock.calls[0][0].where
    expect(supWhere.OR).toEqual([{ purchaseId: null }, { purchase: { branchId: "b-9" } }])
    // Crédito no tiene sucursal atribuible: queda a nivel negocio.
    expect(mocks.creditMovementFindMany.mock.calls[0][0].where.branchId).toBeUndefined()
  })

  it("empleado con sucursales asignadas queda acotado aunque no pida branchId", async () => {
    mocks.auth.mockResolvedValue(session("e-1", "EMPLOYEE", { allowedBranchIds: ["b-1", "b-3"] }))
    await get()
    expect(mocks.cashMovementFindMany.mock.calls[0][0].where.register).toEqual({ branchId: { in: ["b-1", "b-3"] } })
    expect(mocks.paymentFindMany.mock.calls[0][0].where.OR).toBeDefined()
    expect(mocks.supplierPaymentFindMany.mock.calls[0][0].where.OR).toBeDefined()
  })

  it("el query de cobros excluye los que ya tienen asiento de caja (sin duplicar)", async () => {
    await get()
    const where = mocks.paymentFindMany.mock.calls[0][0].where
    expect(where.cashMovementId).toBeNull()
    expect(where.status).toEqual({ in: ["CONFIRMED", "REFUNDED", "VOIDED"] })
  })
})

describe("normalización de las cuatro fuentes", () => {
  it("devuelve filas unificadas con signo, orden desc y campos del contrato", async () => {
    mocks.cashMovementFindMany
      .mockResolvedValueOnce([cash(), cash({ id: "cm-2", type: "OUT", amount: 80, referenceType: "MANUAL", referenceId: null, payment: null, description: "Gasto luz", createdAt: new Date("2025-06-10T17:30:00Z") })])
      .mockResolvedValueOnce([])
    mocks.paymentFindMany.mockResolvedValue([payment()])
    mocks.creditMovementFindMany.mockResolvedValue([credit()])
    mocks.supplierPaymentFindMany.mockResolvedValue([supplierPay()])

    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.movements).toHaveLength(5)
    // Orden desc por fecha: supplier 21h → credit 20h → payment 19h → cash 18h (los dos cm empatan, id desc).
    expect(body.movements.map((m: { kind: string }) => m.kind)).toEqual([
      "SUPPLIER_PAYMENT", "CREDIT_PAYMENT", "PAYMENT", "CASH_IN", "CASH_OUT",
    ])

    const [sup, cred, pay, inRow, outRow] = body.movements
    expect(sup.amountCents).toBe(-80000)
    expect(sup.method).toBe("TRANSFER")
    expect(sup.reference).toBe("OC-000042")
    expect(sup.branchName).toBe("Centro")
    expect(sup.actorName).toBe("Dueña")

    expect(cred.amountCents).toBe(40000)
    expect(cred.userId).toBe("cust-1")
    expect(cred.actorName).toBe("Taller Ruiz")

    expect(pay.amountCents).toBe(120000)
    expect(pay.method).toBe("CARD")
    expect(pay.reference).toBe("AUTH-123")
    expect(pay.href).toBe("/admin/tickets/venta/sale-8")
    expect(pay.branchId).toBe("b-1")

    expect(inRow.amountCents).toBe(25000)
    expect(inRow.method).toBe("CASH")
    expect(inRow.href).toBe("/admin/tickets/venta/sale-7")
    expect(outRow.amountCents).toBe(-8000)
    expect(outRow.method).toBeNull()
  })

  it("REFUNDED conserva su signo negativo, VOIDED se marca aparte y la deuda sale negativa", async () => {
    mocks.paymentFindMany.mockResolvedValue([
      payment({ id: "pay-neg", status: "REFUNDED", amount: -300 }),
      payment({ id: "pay-void", status: "VOIDED", amount: 300 }),
    ])
    mocks.creditMovementFindMany.mockResolvedValue([
      credit({ id: "cred-debt", type: "DEBT", amount: 500, referenceType: "SALE", referenceId: "sale-9" }),
      credit({ id: "cred-rev", type: "REVERSAL", amount: 200 }),
    ])
    const body = await (await get()).json()
    const byKind = Object.fromEntries(body.movements.map((m: { id: string; kind: string }) => [m.id, m]))
    expect(byKind["pay-neg"].kind).toBe("PAYMENT_REFUND")
    expect(byKind["pay-neg"].amountCents).toBe(-30000)
    expect(byKind["pay-void"].kind).toBe("PAYMENT_VOID")
    expect(byKind["pay-void"].amountCents).toBe(30000)
    expect(byKind["cred-debt"].kind).toBe("CREDIT_DEBT")
    expect(byKind["cred-debt"].amountCents).toBe(-50000)
    expect(byKind["cred-debt"].href).toBe("/admin/tickets/venta/sale-9")
    expect(byKind["cred-rev"].kind).toBe("CREDIT_REVERSAL")
    expect(byKind["cred-rev"].amountCents).toBe(20000)
  })

  it("marca duplicatesCash en abonos de crédito y pagos a proveedor ya asentados en caja", async () => {
    mocks.creditMovementFindMany.mockResolvedValue([credit()])
    mocks.supplierPaymentFindMany.mockResolvedValue([supplierPay()])
    // Segunda llamada de cashMovement.findMany: la consulta de dedup.
    mocks.cashMovementFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ referenceId: "cred-1" }, { referenceId: "sp-1" }])
    const body = await (await get()).json()
    const byKind = Object.fromEntries(body.movements.map((m: { id: string; kind: string }) => [m.id, m]))
    expect(byKind["cred-1"].duplicatesCash).toBe(true)
    expect(byKind["sp-1"].duplicatesCash).toBe(true)

    // La consulta de dedup filtra por los ids devueltos y los dos tipos de referencia.
    const dedupWhere = mocks.cashMovementFindMany.mock.calls[1][0].where
    expect(dedupWhere.referenceType).toEqual({ in: ["CREDIT_PAYMENT", "SUPPLIER_PAYMENT"] })
    expect(dedupWhere.referenceId.in).toEqual(expect.arrayContaining(["cred-1", "sp-1"]))
  })
})

describe("tope de filas", () => {
  it("respeta take tras el merge (default 200, máx 500)", async () => {
    mocks.cashMovementFindMany.mockResolvedValueOnce(
      Array.from({ length: 300 }, (_, i) =>
        cash({ id: `cm-${String(i).padStart(4, "0")}`, createdAt: new Date(Date.UTC(2025, 5, 10, 18) - i * 1000) }))
    )
    const def = await (await get()).json()
    expect(def.movements).toHaveLength(200)
    expect(def.take).toBe(200)
    // Más reciente primero tras el merge + sort.
    expect(def.movements[0].id).toBe("cm-0000")

    const capped = await (await get("?take=999")).json()
    expect(capped.take).toBe(500)
  })
})
