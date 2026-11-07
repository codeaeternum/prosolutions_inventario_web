import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { payDocument, cancelDocument, listDocuments, expireQuoteDocuments } from "@/lib/domain/documents"

/**
 * Vigencia del apartado (LAYAWAY.expiresAt): antes no se leía en ningún lado
 * y los apartados retenían stock para siempre. Ahora un apartado vencido
 * congela los abonos del mostrador para el EMPLOYEE — seguir cobrando exige
 * un ADMIN. Nada se cancela ni se libera automáticamente.
 *
 * El dominio corre de verdad sobre un tx falso (db.$transaction entrega el
 * mock; los asserts miran los writes que recibe).
 */

const BIZ = "biz-layaway-expiry"
const users: Record<string, Record<string, unknown>> = {
  "admin-1": { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "emp-1": { id: "emp-1", name: "Empleado", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "cust-1": { id: "cust-1", name: "Cliente", role: "CUSTOMER", status: "APPROVED", businessId: BIZ, customerType: "NORMAL" },
}

let seq = 0
const key = () => `layaway-expiry-${++seq}`

const layaway = (over: Record<string, unknown> = {}) => ({
  id: "doc-1", businessId: BIZ, number: 9, kind: "LAYAWAY", status: "OPEN",
  total: 300, branchId: "branch-1", customerId: "cust-1", sellerId: "emp-1",
  expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), discountCents: 0,
  createdAt: new Date(), ...over,
})

/** Réplica del tx que usan operation() + payDocument + settlePayments. */
function fakeDb(sale: Record<string, unknown> | null, confirmedPayments: Record<string, unknown>[] = []) {
  const created = { payments: [] as Record<string, unknown>[], cash: [] as Record<string, unknown>[] }
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null),
    },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
    sale: {
      findUnique: vi.fn(async () => sale),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    payment: {
      findMany: vi.fn(async () => confirmedPayments),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.payments.push(data); return { id: "pay-1", ...data } }),
      updateMany: vi.fn(async () => ({ count: 1 })),
      aggregate: vi.fn(async () => ({ _sum: { amount: null } })),
    },
    // resolveBranch del openRegister: eco del branchId pedido (caja del cobrador).
    branch: {
      findFirst: vi.fn(async ({ where }: { where?: { id?: string } }) =>
        where?.id ? { id: where.id, name: where.id, isActive: true, businessId: BIZ } : { id: "branch-1", name: "S1", isActive: true, businessId: BIZ }),
    },
    cashRegister: {
      findMany: vi.fn(async () => [{ id: "reg-1" }]),
      findUniqueOrThrow: vi.fn(async () => ({ id: "reg-1", initialAmount: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    cashMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.cash.push(data); return { id: "cash-1", ...data } }),
      groupBy: vi.fn(async () => []),
    },
  }
  const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx, created }
}

const abono = { payments: [{ method: "TARJETA", amount: 50, reference: "POS-1234" }] }

describe("apartado vencido — abonos congelados para staff", () => {
  it("EMPLOYEE no puede abonar a un apartado vencido (409 con el motivo)", async () => {
    const { db, tx, created } = fakeDb(layaway(), [{ method: "CASH", amount: 100, status: "CONFIRMED" }])
    await expect(payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...abono }))
      .rejects.toMatchObject({ status: 409 })
    await expect(payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...abono }))
      .rejects.toThrow(/El apartado venció el .*; pide autorización al administrador para seguir cobrando\./)
    // Nada de dinero ni de pagos quedó registrado.
    expect(created.payments).toHaveLength(0)
    expect(created.cash).toHaveLength(0)
    expect(tx.payment.findMany).not.toHaveBeenCalled()
  })

  it("ADMIN sí puede seguir cobrando un apartado vencido", async () => {
    const { db, created } = fakeDb(layaway(), [{ method: "CASH", amount: 100, status: "CONFIRMED" }])
    const result = await payDocument(db, "admin-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...abono })
    expect(result.completed).toBe(false)
    expect(result.paid).toBe(150)
    expect(result.balance).toBe(150)
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: 50, status: "CONFIRMED" })
  })

  it("apartado vigente: el EMPLOYEE abona normal (regresión)", async () => {
    const { db, created } = fakeDb(layaway({ expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }), [])
    const result = await payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...abono })
    expect(result.paid).toBe(50)
    expect(created.payments).toHaveLength(1)
  })

  it("apartado sin vigencia (expiresAt nulo) no se congela", async () => {
    const { db, created } = fakeDb(layaway({ expiresAt: null }), [])
    const result = await payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...abono })
    expect(result.paid).toBe(50)
    expect(created.payments).toHaveLength(1)
  })
})

describe("abono de apartado — caja del cobrador (cross-branch)", () => {
  const efectivo = { payments: [{ method: "EFECTIVO", amount: 50 }] }

  it("el efectivo entra a la caja de cashierBranchId, no a la del documento", async () => {
    const { db, tx, created } = fakeDb(layaway({ expiresAt: null }), [])
    await payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), cashierBranchId: "branch-2", ...efectivo })
    expect(tx.cashRegister.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: "branch-2" }),
    }))
    expect(created.cash[0]).toMatchObject({ type: "IN", amount: 50 })
    // El pago queda ligado al documento en su sucursal original.
    expect(created.payments[0]).toMatchObject({ saleId: "doc-1", method: "CASH", amount: 50 })
  })

  it("sin cashierBranchId el efectivo cae a la sucursal del documento (regresión)", async () => {
    const { db, tx } = fakeDb(layaway({ expiresAt: null }), [])
    // emp-1 no tiene homeBranchId → último respaldo: la sucursal del apartado.
    await payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...efectivo })
    expect(tx.cashRegister.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: "branch-1" }),
    }))
  })

  it("la sucursal base del cobrador tiene prioridad sobre la del documento", async () => {
    const { db, tx } = fakeDb(layaway({ expiresAt: null }), [])
    tx.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "emp-1" ? { ...users["emp-1"], homeBranchId: "branch-3" } : users[where.id] ?? null)
    await payDocument(db, "emp-1", BIZ, { saleId: "doc-1", idempotencyKey: key(), ...efectivo })
    expect(tx.cashRegister.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ branchId: "branch-3" }),
    }))
  })
})

describe("cancelar apartado — ajenos exigen admin (vector de robo)", () => {
  const sinDinero = () => layaway({ expiresAt: null, items: [], payments: [] })

  it("EMPLOYEE no cancela el apartado de un compañero", async () => {
    const { db, tx } = fakeDb(layaway({ expiresAt: null, sellerId: "admin-1", items: [], payments: [] }))
    await expect(cancelDocument(db, "emp-1", BIZ, { saleId: "doc-1", reason: "Cliente no volvió", idempotencyKey: key() }))
      .rejects.toMatchObject({ status: 403 })
    expect(tx.sale.updateMany).not.toHaveBeenCalled()
  })

  it("EMPLOYEE sí cancela su propio apartado", async () => {
    const { db, tx } = fakeDb(sinDinero())
    const result = await cancelDocument(db, "emp-1", BIZ, { saleId: "doc-1", reason: "Cliente no volvió", idempotencyKey: key() })
    expect(result.saleId).toBe("doc-1")
    expect(tx.sale.updateMany).toHaveBeenCalledWith({ where: { id: "doc-1", status: "OPEN" }, data: { status: "VOIDED" } })
  })

  it("ADMIN sí cancela el apartado de un empleado", async () => {
    const { db } = fakeDb(sinDinero())
    const result = await cancelDocument(db, "admin-1", BIZ, { saleId: "doc-1", reason: "Cliente no volvió", idempotencyKey: key() })
    expect(result.saleId).toBe("doc-1")
  })
})

describe("listDocuments expone expiresAt y el badge `expired`", () => {
  it("devuelve expiresAt crudo y expired=true cuando ya venció", async () => {
    const past = new Date(Date.now() - 60_000)
    const row = { id: "doc-1", expiresAt: past, payments: [{ amount: 100 }], items: [{ id: "i1", quantity: 1 }], total: 300 }
    const db = { sale: { findMany: vi.fn(async () => [row]) } } as unknown as PrismaClient
    const [doc] = await listDocuments(db, BIZ, { kind: "LAYAWAY", status: "OPEN" })
    expect(doc.expiresAt).toEqual(past)
    expect(doc.expired).toBe(true)
    expect(doc.balance).toBe(200)
  })

  it("expired=false cuando la vigencia sigue corriendo o no existe", async () => {
    const rows = [
      { id: "doc-1", expiresAt: new Date(Date.now() + 60_000), payments: [], items: [], total: 100 },
      { id: "doc-2", expiresAt: null, payments: [], items: [], total: 50 },
    ]
    const db = { sale: { findMany: vi.fn(async () => rows) } } as unknown as PrismaClient
    const docs = await listDocuments(db, BIZ, {})
    expect(docs.map(d => d.expired)).toEqual([false, false])
  })
})

describe("expireQuoteDocuments — limpieza automática de cotizaciones POS vencidas", () => {
  it("marca como VOIDED únicamente las cotizaciones DRAFT con expiresAt <= now", async () => {
    const now = new Date("2026-11-04T12:00:00.000Z")
    const updateMany = vi.fn(async () => ({ count: 3 }))
    const db = { sale: { updateMany } } as unknown as PrismaClient
    const result = await expireQuoteDocuments(db, now)
    expect(result).toEqual({ expiredQuotesCount: 3 })
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        kind: "QUOTE",
        status: "DRAFT",
        expiresAt: { not: null, lte: now },
      },
      data: { status: "VOIDED" },
    })
  })
})
