import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

// low-stock cuelga de la cadena next-auth/notificaciones: la alerta post-commit
// es ajena al contrato probado aquí, se sustituye por un no-op.
vi.mock("@/lib/low-stock", () => ({
  collectLowStockIds: (items: { productId?: string | null }[]) => items.map(i => i.productId).filter(Boolean),
  syncLowStockAlerts: vi.fn(async () => {}),
}))

import { sell, voidSale } from "@/lib/domain/sales"
import { parkDocument, checkoutDocument } from "@/lib/domain/documents"
import { encargoHeldCents } from "@/lib/domain/encargos"

/**
 * Integridad de dinero encargo ↔ venta POS. El dominio corre de verdad sobre
 * un tx falso (db.$transaction entrega el mock; los asserts miran los writes).
 *
 * Cubre tres fugas:
 *  1. encargoId ligado a un apartado/cotización dejaba el anticipo huérfano
 *     (el documento nunca consume el encargo y su depósito se reaplicaba).
 *  2. priceQuoted se cobraba como PRECIO UNITARIO cuando es el TOTAL del
 *     encargo: quantity 3 × $3,000 cotizado facturaba $9,000.
 *  3. Anular la venta que entregó el encargo lo dejaba DELIVERED terminal con
 *     el anticipo contando como retenido para siempre.
 */

const BIZ = "biz-encargo-integrity"
const BRANCH = { id: "b1", name: "Matriz", isActive: true, businessId: BIZ }
const PRODUCT = { id: "prod-1", businessId: BIZ, name: "Pantalla A32", isActive: true, stock: 10, retailPrice: 1200, wholesalePrice: 1000 }
let seq = 0
const key = () => `encargo-integrity-${++seq}`

const users: Record<string, Record<string, unknown>> = {
  "admin-1": { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "emp-1": { id: "emp-1", name: "Empleado", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, homeBranchId: "b1" },
  "cust-1": { id: "cust-1", name: "Cliente", role: "CUSTOMER", status: "APPROVED", businessId: BIZ, customerType: "NORMAL" },
}

const encargoFixture = (over: Record<string, unknown> = {}) => ({
  id: "enc-1",
  businessId: BIZ,
  branchId: "b1",
  branch: BRANCH,
  status: "READY",
  description: "Pantalla A32",
  quantity: 1,
  deposit: 300,
  priceQuoted: 1000,
  productId: "prod-1",
  product: { id: "prod-1", name: "Pantalla A32" },
  customerId: "cust-1",
  customer: { id: "cust-1", name: "Cliente", phone: null },
  createdById: "emp-1",
  createdBy: { id: "emp-1", name: "Empleado" },
  resolvedBy: null,
  marketplaceRequestId: null,
  ...over,
})

/** ADVANCE ledger retenido que devuelve encargoHeldCents vía payment.findMany. */
const advanceRows = (amount: number, method = "CASH") => (args?: { where?: { purpose?: string } }) =>
  Promise.resolve(args?.where?.purpose === "ADVANCE" ? [{ method, amount, status: "CONFIRMED" }] : [])

// any deliberado: los fixtures de venta/encargo son filas parciales del mock.
type Fixture = { encargo?: Record<string, any> | null; sale?: Record<string, any> | null }

/** Réplica del tx que usan operation() + sell/parkDocument/checkoutDocument/voidSale. */
function fakeDb(fix: Fixture = {}) {
  const created = { payments: [] as Record<string, unknown>[], cash: [] as Record<string, unknown>[], inventory: [] as Record<string, unknown>[], saleItems: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[] }
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null),
      findFirst: vi.fn(async () => null),
    },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
    branch: { findFirst: vi.fn(async () => BRANCH) },
    product: {
      findFirst: vi.fn(async () => PRODUCT),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => PRODUCT),
      findUniqueOrThrow: vi.fn(async () => ({ ...PRODUCT, stock: 9 })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    branchStock: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    sale: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "sale-1", ...data })),
      findUnique: vi.fn(async () => fix.sale ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    saleItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `si-${created.saleItems.length + 1}`, ...data }; created.saleItems.push(row); return row }),
      findMany: vi.fn(async () => fix.sale?.items ?? []),
      findUniqueOrThrow: vi.fn(async () => fix.sale?.items?.[0] ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    inventoryMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `mv-${created.inventory.length}`, ...data, product: { id: PRODUCT.id, name: PRODUCT.name } }; created.inventory.push(row); return row }),
    },
    encargo: {
      findFirst: vi.fn(async () => fix.encargo ?? null),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    payment: {
      findMany: vi.fn(async (): Promise<any[]> => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `pay-${created.payments.length + 1}`, ...data }; created.payments.push(row); return row }),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      aggregate: vi.fn(async ({ where }: { where: { amount?: { gt?: number } } }) => ({ _sum: { amount: where.amount?.gt != null ? 10000 : null } })),
    },
    cashRegister: {
      findMany: vi.fn(async () => [{ id: "reg-1", initialAmount: 0 }]),
      findUniqueOrThrow: vi.fn(async () => ({ id: "reg-1", initialAmount: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    cashMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `cm-${created.cash.length}`, ...data }; created.cash.push(row); return row }),
      findMany: vi.fn(async () => [{ type: "IN", amount: 10000 }]),
    },
    creditMovement: { create: vi.fn(async () => ({})) },
    auditEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.audits.push(data); return { id: "ae-1" } }) },
  }
  const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx, created }
}

describe("Fix 1 — encargoId solo en documentos de venta, nunca apartado ni cotización", () => {
  const docInput = (over: Record<string, unknown> = {}) => ({
    items: [{ productId: "prod-1", quantity: 1 }],
    customerId: "cust-1",
    branchId: "b1",
    encargoId: "enc-1",
    idempotencyKey: key(),
    ...over,
  })

  it("parkDocument LAYAWAY + encargoId se rechaza: el depósito del encargo no coexiste con un anticipo propio", async () => {
    const { db, tx, created } = fakeDb({ encargo: encargoFixture() })
    await expect(parkDocument(db, "admin-1", BIZ, docInput({
      kind: "LAYAWAY", payments: [{ method: "EFECTIVO", amount: 10 }],
    }))).rejects.toMatchObject({ status: 400, message: "Un encargo con anticipo no puede ligarse a un apartado; véndelo directo." })
    // Nada de stock, ventas ni renglones quedó comprometido.
    expect(tx.sale.create).not.toHaveBeenCalled()
    expect(created.saleItems).toHaveLength(0)
    expect(tx.branchStock.updateMany).not.toHaveBeenCalled()
  })

  it("parkDocument QUOTE + encargoId también se rechaza", async () => {
    const { db, tx } = fakeDb({ encargo: encargoFixture() })
    await expect(parkDocument(db, "admin-1", BIZ, docInput({
      kind: "QUOTE", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }))).rejects.toMatchObject({ status: 400, message: "Un encargo con anticipo no puede ligarse a una cotización; véndelo directo." })
    expect(tx.sale.create).not.toHaveBeenCalled()
  })

  it("parkDocument RETAIL valida el encargo: no-READY, inexistente y de otra sucursal se rechazan", async () => {
    // Encargo todavía pedido (ORDERED): no es liquidable en el checkout.
    const ordered = fakeDb({ encargo: encargoFixture({ status: "ORDERED" }) })
    await expect(parkDocument(ordered.db, "admin-1", BIZ, docInput({ kind: "RETAIL" })))
      .rejects.toMatchObject({ status: 409, code: "ENCARGO_NOT_READY" })
    expect(ordered.tx.sale.create).not.toHaveBeenCalled()

    // Encargo de otro negocio / inexistente.
    const missing = fakeDb({ encargo: null })
    await expect(parkDocument(missing.db, "admin-1", BIZ, docInput({ kind: "RETAIL" })))
      .rejects.toMatchObject({ status: 404 })
    expect(missing.tx.sale.create).not.toHaveBeenCalled()

    // Encargo radicado en otra sucursal.
    const otherBranch = fakeDb({ encargo: encargoFixture({ branchId: "b-otra" }) })
    await expect(parkDocument(otherBranch.db, "admin-1", BIZ, docInput({ kind: "RETAIL" })))
      .rejects.toMatchObject({ status: 409, message: "El encargo pertenece a otra sucursal." })
    expect(otherBranch.tx.sale.create).not.toHaveBeenCalled()
  })

  it("parkDocument RETAIL con encargo READY crea el DRAFT ligado a precio prometido", async () => {
    const { db, tx, created } = fakeDb({ encargo: encargoFixture() })
    tx.payment.findMany.mockImplementation(advanceRows(300))
    const result = await parkDocument(db, "emp-1", BIZ, docInput({ kind: "RETAIL" }))
    expect(result.sale.status).toBe("DRAFT")
    expect(result.total).toBe(1000)
    expect(result).toMatchObject({ encargoId: "enc-1" })
    expect(created.saleItems[0]).toMatchObject({ unitPrice: 1000, totalPrice: 1000 })
    // DRAFT puro: ni stock ni dinero se movieron.
    expect(created.payments).toHaveLength(0)
    expect(tx.branchStock.updateMany).not.toHaveBeenCalled()
  })

  it("el doble consumo del encargo se rechaza en sell y en checkoutDocument", async () => {
    // Una vez DELIVERED, el encargo no vuelve a aplicarse: sell lo rechaza.
    const delivered = fakeDb({ encargo: encargoFixture({ status: "DELIVERED" }) })
    await expect(sell(delivered.db, "emp-1", BIZ, {
      idempotencyKey: key(), encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }], paymentMethod: "EFECTIVO",
    })).rejects.toMatchObject({ status: 409, code: "ENCARGO_NOT_READY" })
    expect(delivered.tx.sale.create).not.toHaveBeenCalled()

    // …y el checkout de un documento también (misma validación compartida).
    const deliveredCheckout = fakeDb({
      encargo: encargoFixture({ status: "DELIVERED" }),
      sale: { id: "doc-1", businessId: BIZ, number: 5, status: "DRAFT", kind: "RETAIL", total: 1000, branchId: "b1", sellerId: "emp-1", customerId: "cust-1", expiresAt: null },
    })
    await expect(checkoutDocument(deliveredCheckout.db, "emp-1", BIZ, {
      idempotencyKey: key(), saleId: "doc-1", encargoId: "enc-1", paymentMethod: "EFECTIVO",
    })).rejects.toMatchObject({ status: 409, code: "ENCARGO_NOT_READY" })
    expect(deliveredCheckout.tx.sale.updateMany).not.toHaveBeenCalled()
  })
})

describe("Fix 2 — priceQuoted es el TOTAL del encargo, no el precio unitario", () => {
  it("sell cobra el total cotizado aunque el encargo tenga varias piezas", async () => {
    // Encargo ×3 cotizado en $3,000 total (no $3,000 por pieza), anticipo $1,000.
    const { db, tx, created } = fakeDb({ encargo: encargoFixture({ quantity: 3, priceQuoted: 3000, deposit: 1000 }) })
    tx.payment.findMany.mockImplementation(advanceRows(1000))
    const result = await sell(db, "emp-1", BIZ, {
      idempotencyKey: key(), encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 3 }], paymentMethod: "TARJETA",
    })
    // Total $3,000 (prometido), no $9,000 (unitario × qty) ni $3,600 (catálogo).
    expect(result.total).toBe(3000)
    expect(result.depositCents).toBe(100000)
    expect(result.payableCents).toBe(200000)
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: 2000, status: "CONFIRMED" })
    // El renglón conserva el total exacto; el unitario es solo desglose.
    expect(created.saleItems[0]).toMatchObject({ quantity: 3, unitPrice: 1000, totalPrice: 3000 })
    // El encargo se entregó en la misma venta.
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED" }),
    }))
  })

  it("un renglón que no cubre todas las piezas del encargo se rechaza", async () => {
    const { db, tx } = fakeDb({ encargo: encargoFixture({ quantity: 3, priceQuoted: 3000, deposit: 1000 }) })
    tx.payment.findMany.mockImplementation(advanceRows(1000))
    // El encargo es por 3 piezas y la venta solo lleva 1: entregar una fracción
    // con el anticipo completo dejaría piezas sin cobrar.
    await expect(sell(db, "emp-1", BIZ, {
      idempotencyKey: key(), encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }], paymentMethod: "TARJETA",
    })).rejects.toMatchObject({ status: 409, message: "El encargo es por 3 pieza(s); su renglón en la venta debe llevar exactamente esa cantidad." })
    expect(tx.sale.create).not.toHaveBeenCalled()
  })

  it("el anticipo retenido nunca supera el total real cobrado", async () => {
    // El encargo cotizó otra pieza (prod-x no está en la venta): el precio
    // prometido no aplica y el anticipo retenido ($3,000) excede la venta.
    const { db, tx } = fakeDb({ encargo: encargoFixture({ productId: "prod-x", priceQuoted: 3000, deposit: 3000 }) })
    tx.payment.findMany.mockImplementation(advanceRows(3000))
    await expect(sell(db, "emp-1", BIZ, {
      idempotencyKey: key(), encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }], paymentMethod: "EFECTIVO",
    })).rejects.toMatchObject({ status: 409, message: "El anticipo del encargo supera el total de la venta." })
    expect(tx.sale.create).not.toHaveBeenCalled()
  })

  it("parkDocument también fotografía el TOTAL cotizado y valida el anticipo", async () => {
    const { db, tx, created } = fakeDb({ encargo: encargoFixture({ quantity: 2, priceQuoted: 3000, deposit: 1000 }) })
    tx.payment.findMany.mockImplementation(advanceRows(1000))
    const result = await parkDocument(db, "emp-1", BIZ, {
      kind: "RETAIL", branchId: "b1", customerId: "cust-1", encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 2 }], idempotencyKey: key(),
    })
    expect(result.total).toBe(3000)
    expect(created.saleItems[0]).toMatchObject({ quantity: 2, totalPrice: 3000 })

    // Anticipo retenido mayor que el total del documento → nace muerto, se rechaza.
    const overDeposit = fakeDb({ encargo: encargoFixture({ productId: "prod-x", priceQuoted: 3000, deposit: 3000 }) })
    overDeposit.tx.payment.findMany.mockImplementation(advanceRows(3000))
    await expect(parkDocument(overDeposit.db, "emp-1", BIZ, {
      kind: "RETAIL", branchId: "b1", customerId: "cust-1", encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }], idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 409, message: "El anticipo del encargo supera el total del documento." })
    expect(overDeposit.tx.sale.create).not.toHaveBeenCalled()
  })

  it("checkoutDocument exige el renglón completo aunque el DRAFT no ligara encargo", async () => {
    const { db, tx } = fakeDb({
      encargo: encargoFixture({ quantity: 2, priceQuoted: 3000, deposit: 1000 }),
      sale: {
        id: "doc-1", businessId: BIZ, number: 5, status: "DRAFT", kind: "RETAIL", total: 1200,
        branchId: "b1", sellerId: "emp-1", customerId: "cust-1", expiresAt: null,
        items: [{ id: "si-1", saleId: "doc-1", productId: "prod-1", quantity: 1, unitPrice: 1200, totalPrice: 1200 }],
      },
    })
    tx.payment.findMany.mockImplementation(advanceRows(1000))
    await expect(checkoutDocument(db, "emp-1", BIZ, {
      idempotencyKey: key(), saleId: "doc-1", encargoId: "enc-1", paymentMethod: "EFECTIVO",
    })).rejects.toMatchObject({ status: 409 })
    expect(tx.sale.updateMany).not.toHaveBeenCalled()
  })
})

describe("Fix 3 — voidSale revierte el encargo a READY con su anticipo retenido", () => {
  const encargoSale = (over: Record<string, unknown> = {}) => ({
    id: "sale-enc",
    businessId: BIZ,
    number: 9,
    kind: "RETAIL",
    status: "COMPLETED",
    total: 1000,
    discountCents: 0,
    branchId: "b1",
    customerId: "cust-1",
    sellerId: "admin-1",
    items: [{ id: "si-1", saleId: "sale-enc", productId: "prod-1", quantity: 1, returnedQuantity: 0, unitPrice: 1000, totalPrice: 1000 }],
    // El anticipo quedó ligado a la venta por settleEncargoInSaleTx; el cobro
    // del día fue solo el resto por TARJETA.
    payments: [
      { id: "p-adv", saleId: "sale-enc", encargoId: "enc-1", purpose: "ADVANCE", method: "CASH", amount: 300, status: "CONFIRMED" },
      { id: "p-day", saleId: "sale-enc", encargoId: null, purpose: null, method: "CARD", amount: 700, status: "CONFIRMED" },
    ],
    ...over,
  })

  it("anular la venta desliga el ADVANCE, revierte el encargo y NO devuelve el anticipo en caja", async () => {
    const { db, tx, created } = fakeDb({ sale: encargoSale(), encargo: encargoFixture({ status: "DELIVERED" }) })
    const result = await voidSale(db, "admin-1", BIZ, { saleId: "sale-enc", reason: "Cobro capturado por error", idempotencyKey: key() })
    expect(result.saleId).toBe("sale-enc")

    // El anticipo vuelve al encargo (saleId → null): sigue siendo dinero
    // retenido del cliente, no un cobro del día que se reembolsa.
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { saleId: "sale-enc", encargoId: "enc-1", purpose: "ADVANCE", status: "CONFIRMED" },
      data: { saleId: null },
    })
    // El encargo regresa a READY — DELIVERED solo era consumable por esta venta.
    expect(tx.encargo.updateMany).toHaveBeenCalledWith({
      where: { id: "enc-1", businessId: BIZ, status: "DELIVERED" },
      data: { status: "READY", resolvedById: null },
    })
    // Se reembolsa solo el cobro del día ($700 tarjeta), nunca el anticipo.
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: -700, status: "REFUNDED" })
    // El VOIDED del resto de pagos no toca los del encargo (encargoId: null).
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { saleId: "sale-enc", method: "CARD", status: "CONFIRMED", encargoId: null },
      data: { status: "VOIDED" },
    })
    // Sin salida de efectivo: el anticipo CASH quedó retenido en el encargo.
    expect(created.cash.filter(c => c.type === "OUT")).toHaveLength(0)
    // La reversa queda en la bitácora.
    expect(created.audits.some(a => a.action === "ENCARGO_STATUS" && a.entityId === "enc-1")).toBe(true)
  })

  it("venta cubierta al 100% por el anticipo: anula sin reembolso y revierte el encargo", async () => {
    const { db, tx, created } = fakeDb({
      sale: encargoSale({ payments: [{ id: "p-adv", saleId: "sale-enc", encargoId: "enc-1", purpose: "ADVANCE", method: "CASH", amount: 1000, status: "CONFIRMED" }] }),
      encargo: encargoFixture({ status: "DELIVERED" }),
    })
    await voidSale(db, "admin-1", BIZ, { saleId: "sale-enc", reason: "Error", idempotencyKey: key() })
    expect(created.payments).toHaveLength(0)
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "READY" }),
    }))
    expect(tx.sale.updateMany).toHaveBeenCalledWith({ where: { id: "sale-enc", status: "COMPLETED" }, data: { status: "VOIDED" } })
  })

  it("encargoHeldCents solo cuenta anticipos CONFIRMED (un ADVANCE anulado no retiene)", async () => {
    const tx = {
      payment: {
        findMany: vi.fn(async ({ where }: { where: { purpose?: string } }) =>
          where.purpose === "ADVANCE"
            ? [{ method: "CASH", amount: 500, status: "VOIDED" }, { method: "CASH", amount: 300, status: "CONFIRMED" }]
            : []),
      },
    }
    const { heldCents, depositMethod } = await encargoHeldCents(tx as never, { id: "enc-1", deposit: 800 })
    expect(heldCents).toBe(30000)
    expect(depositMethod).toBe("CASH")
  })
})
