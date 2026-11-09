import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

// low-stock cuelga de la cadena next-auth/notificaciones: la alerta post-commit
// es ajena al contrato probado aquí, se sustituye por un no-op.
vi.mock("@/lib/low-stock", () => ({
  collectLowStockIds: (items: { productId?: string | null }[]) => items.map(i => i.productId).filter(Boolean),
  syncLowStockAlerts: vi.fn(async () => {}),
}))

import { sell, returnSaleItems, voidSale } from "@/lib/domain/sales"
import { moveInventory } from "@/lib/domain/inventory"
import { changeCredit } from "@/lib/domain/credit"

/**
 * Guardarraíles de dinero — devoluciones, lista de taller y abonos a crédito.
 *
 * El dominio corre de verdad sobre un tx falso (db.$transaction entrega el
 * mock; los asserts miran los writes que recibe). Cubre los cuatro bugs de
 * dinero: dos ledgers de devolución paralelos, reembolso a precio de catálogo
 * en ventas con descuento, precio de taller sin restricción para staff y
 * abonos no-efectivo sin referencia.
 */

const BIZ = "biz-money-test"
const BRANCH = { id: "branch-1", name: "Sucursal 1", isActive: true, businessId: BIZ }
const PRODUCT = { id: "prod-1", businessId: BIZ, name: "Pantalla A32", isActive: true, stock: 10, retailPrice: 100, wholesalePrice: 70 }
let seq = 0
const key = () => `money-test-key-${++seq}`

const users: Record<string, Record<string, unknown>> = {
  "admin-1": { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "emp-1": { id: "emp-1", name: "Empleado", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "cust-1": { id: "cust-1", name: "Cliente", role: "CUSTOMER", status: "APPROVED", businessId: BIZ, customerType: "NORMAL", creditBalance: 500 },
  "cust-tech": { id: "cust-tech", name: "Técnico", role: "CUSTOMER", status: "APPROVED", businessId: BIZ, customerType: "TECHNICIAN", creditBalance: 0 },
  "cust-normal": { id: "cust-normal", name: "Particular", role: "CUSTOMER", status: "APPROVED", businessId: BIZ, customerType: "NORMAL", creditBalance: 0 },
  // Suspendido = sin APPROVED (el enum solo tiene PENDING/APPROVED/REJECTED):
  // no puede operar, pero sí debe poder PAGAR su deuda en mostrador.
  "cust-susp": { id: "cust-susp", name: "Suspendido", role: "CUSTOMER", status: "REJECTED", businessId: BIZ, customerType: "NORMAL", creditBalance: 500 },
  "cust-ajeno": { id: "cust-ajeno", name: "Cliente de otro negocio", role: "CUSTOMER", status: "APPROVED", businessId: "biz-otro", creditBalance: 500 },
}
const userById = (id: string) => users[id] ?? null

interface SaleFixture {
  status: string
  total?: number
  discountCents?: number
  returnedQuantity?: number
  sellerId?: string
  payments?: Record<string, unknown>[]
}
const saleFixture = (over: SaleFixture) => ({
  id: "sale-1",
  businessId: BIZ,
  number: 7,
  kind: "RETAIL",
  branchId: "branch-1",
  customerId: null,
  sellerId: over.sellerId ?? "admin-1",
  status: over.status,
  total: over.total ?? 200,
  discountCents: over.discountCents ?? 0,
  discountReason: over.discountCents ? "Cliente frecuente" : null,
  payments: over.payments ?? [],
  items: [{
    id: "si-1", businessId: BIZ, saleId: "sale-1", productId: "prod-1",
    quantity: 2, returnedQuantity: over.returnedQuantity ?? 0,
    unitPrice: 100, totalPrice: 200,
  }],
})

/** Réplica mínima del tx que usan sell/moveInventory/returnSaleItems/changeCredit. */
function fakeDb(opts: { sale?: ReturnType<typeof saleFixture> | null; sourceMovement?: Record<string, unknown> | null; reservation?: Record<string, unknown> | null; creditBalance?: number } = {}) {
  const created = { inventory: [] as Record<string, unknown>[], payments: [] as Record<string, unknown>[], cash: [] as Record<string, unknown>[], credit: [] as Record<string, unknown>[] }
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const user = userById(where.id)
        return user && opts.creditBalance !== undefined && user.role === "CUSTOMER" ? { ...user, creditBalance: opts.creditBalance } : user
      }),
      // El findFirst de changeCredit PAYMENT: mismo tenant + rol de cliente —
      // a propósito NO filtra por status (un suspendido sí puede pagar).
      findFirst: vi.fn(async ({ where }: { where: { id: string; businessId?: string; role?: { in: string[] } } }) => {
        const user = userById(where.id)
        return user && user.businessId === where.businessId && (where.role?.in ?? []).includes(user.role as string) ? user : null
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    reservation: { findUnique: vi.fn(async () => opts.reservation ?? null) },
    branch: { findFirst: vi.fn(async () => BRANCH) },
    product: {
      findFirst: vi.fn(async () => PRODUCT),
      findUniqueOrThrow: vi.fn(async () => ({ ...PRODUCT, stock: 9 })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    branchStock: { upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    sale: {
      findUnique: vi.fn(async () => opts.sale ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "sale-1", number: 7, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    saleItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "si-1", ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => opts.sale?.items ?? []),
    },
    inventoryMovement: {
      findUnique: vi.fn(async () => opts.sourceMovement ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `mv-${created.inventory.length}`, ...data }; created.inventory.push(data); return row }),
      aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })),
    },
    payment: {
      // paid sum para refund(): $100 cobrados en el medio consultado.
      aggregate: vi.fn(async ({ where }: { where: { amount?: { gt?: number } } }) => ({ _sum: { amount: where.amount?.gt != null ? 100 : null } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.payments.push(data); return { id: "pay-1", ...data } }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    creditMovement: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.credit.push(data); return { id: "cm-1", ...data } }) },
    cashRegister: {
      findMany: vi.fn(async () => [{ id: "reg-1" }]),
      findUniqueOrThrow: vi.fn(async () => ({ id: "reg-1", initialAmount: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    cashMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.cash.push(data); return { id: "cash-1", ...data } }),
      groupBy: vi.fn(async () => [{ type: "IN", _sum: { amount: 500 } }]),
    },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
  }
  const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx, created }
}

const saleInput = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: "prod-1", quantity: 1 }],
  paymentMethod: "TARJETA",
  branchId: "branch-1",
  idempotencyKey: key(),
  ...over,
})

const returnInput = (over: Record<string, unknown> = {}) => ({
  saleId: "sale-1",
  items: [{ saleItemId: "si-1", quantity: 1 }],
  refundMethod: "TARJETA",
  reason: "Devolución de prueba",
  idempotencyKey: key(),
  ...over,
})

describe("lista de taller restringida para staff (sell)", () => {
  it("EMPLOYEE no cobra precio de taller a un walk-in por priceTier", async () => {
    const { db, tx } = fakeDb()
    await expect(sell(db, "emp-1", BIZ, saleInput({ priceTier: "wholesale" }))).rejects.toMatchObject({
      status: 403, message: "El precio de taller requiere un cliente tipo taller/negocio; pide autorización al administrador.",
    })
    expect(tx.sale.create).not.toHaveBeenCalled()
  })

  it("EMPLOYEE no cobra precio de taller a un walk-in por workshopSale", async () => {
    const { db, tx } = fakeDb()
    await expect(sell(db, "emp-1", BIZ, saleInput({ workshopSale: true }))).rejects.toMatchObject({ status: 403 })
    expect(tx.sale.create).not.toHaveBeenCalled()
  })

  it("EMPLOYEE no cobra precio de taller a un cliente NORMAL", async () => {
    const { db } = fakeDb()
    await expect(sell(db, "emp-1", BIZ, saleInput({ customerId: "cust-normal", priceTier: "wholesale" }))).rejects.toMatchObject({ status: 403 })
  })

  it("EMPLOYEE sí vende a precio de taller a un cliente TECHNICIAN", async () => {
    const { db } = fakeDb()
    const result = await sell(db, "emp-1", BIZ, saleInput({ customerId: "cust-tech" }))
    expect(result.kind).toBe("WORKSHOP")
    expect(result.total).toBe(70)
    expect(result.priceTier).toBe("wholesale")
  })

  it("ADMIN sí cobra precio de taller a un walk-in (nota a taller)", async () => {
    const { db } = fakeDb()
    const result = await sell(db, "admin-1", BIZ, saleInput({ workshopSale: true }))
    expect(result.sale.total).toBe(70)
    expect(result.priceTier).toBe("wholesale")
  })

  it("venta de mostrador normal queda retail sin alerta de lista", async () => {
    const { db } = fakeDb()
    const result = await sell(db, "emp-1", BIZ, saleInput())
    expect(result.total).toBe(100)
    expect(result.priceTier).toBe("retail")
  })
})

describe("devolución por venta — un solo ledger", () => {
  it("returnSaleItems rechaza una venta anulada", async () => {
    const { db } = fakeDb({ sale: saleFixture({ status: "VOIDED" }) })
    await expect(returnSaleItems(db, "admin-1", BIZ, returnInput())).rejects.toMatchObject({ status: 409 })
  })

  it("el RETURN del historial rechaza la salida de una venta anulada", async () => {
    const { db } = fakeDb({
      sale: saleFixture({ status: "VOIDED" }),
      sourceMovement: { id: "mv-out", businessId: BIZ, type: "OUT", paymentMethod: "EFECTIVO", saleId: "sale-1", productId: "prod-1", quantity: 2, businessVersion: 1, branchId: "branch-1" },
    })
    await expect(moveInventory(db, "admin-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "RETURN", quantity: 1, reason: "Reintento", relatedId: "mv-out" }],
    })).rejects.toMatchObject({ status: 409, message: "La venta no existe o ya fue anulada." })
  })

  it("el RETURN del historial no vuelve a devolver piezas ya repuestas por el POS", async () => {
    // Las 2 unidades de la venta ya se devolvieron por /api/sales/return
    // (returnedQuantity = 2) sin crear RETURN con relatedId: el ledger viejo
    // diría que quedan 2 por devolver — el ledger compartido dice 0.
    const { db } = fakeDb({
      sale: saleFixture({ status: "COMPLETED", returnedQuantity: 2 }),
      sourceMovement: { id: "mv-out", businessId: BIZ, type: "OUT", paymentMethod: "EFECTIVO", saleId: "sale-1", productId: "prod-1", quantity: 2, businessVersion: 1, branchId: "branch-1" },
    })
    await expect(moveInventory(db, "admin-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "RETURN", quantity: 1, reason: "Segunda devolución", relatedId: "mv-out" }],
    })).rejects.toMatchObject({ status: 409, message: "La cantidad supera las unidades pendientes de devolución." })
  })

  it("el RETURN del historial delega en la venta: marca returnedQuantity y reembolsa una vez", async () => {
    const { db, tx, created } = fakeDb({
      sale: saleFixture({ status: "COMPLETED" }),
      sourceMovement: { id: "mv-out", businessId: BIZ, type: "OUT", paymentMethod: "EFECTIVO", saleId: "sale-1", productId: "prod-1", quantity: 2, businessVersion: 1, branchId: "branch-1" },
    })
    const result = await moveInventory(db, "admin-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "RETURN", quantity: 1, reason: "Pieza equivocada", relatedId: "mv-out" }],
    })
    // La devolución pasó por el ledger de la venta, no por relatedId.
    expect(tx.saleItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "si-1", quantity: { gte: 1 } },
      data: { returnedQuantity: { increment: 1 } },
    }))
    const movement = created.inventory[0]
    expect(movement).toMatchObject({ type: "RETURN", quantity: 1, saleId: "sale-1" })
    expect(movement).not.toHaveProperty("relatedId")
    // Reembolso en efectivo: sale de la caja abierta con su Payment negativo.
    expect(created.payments[0]).toMatchObject({ method: "CASH", amount: -100, status: "REFUNDED" })
    expect(created.cash[0]).toMatchObject({ type: "OUT", amount: 100 })
    expect(result.movements).toHaveLength(1)
  })

  it("returnSaleItems rechaza devolver de más (guardia de updateMany)", async () => {
    const { db, tx } = fakeDb({ sale: saleFixture({ status: "COMPLETED" }) })
    tx.saleItem.updateMany.mockResolvedValue({ count: 0 })
    await expect(returnSaleItems(db, "admin-1", BIZ, returnInput({ items: [{ saleItemId: "si-1", quantity: 3 }] }))).rejects.toMatchObject({ status: 409 })
  })
})

describe("reembolso con descuento — precio efectivamente cobrado", () => {
  it("venta al 50%: devolver 1 de 2 piezas reembolsa la mitad de lo pagado", async () => {
    // Catálogo $200 (2 × $100) con discountCents 10000 → se cobró $100.
    const { db, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED", total: 200, discountCents: 10000 }) })
    const result = await returnSaleItems(db, "admin-1", BIZ, returnInput())
    // Reembolsa $50 (precio efectivo), no $100 (catálogo).
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: -50, status: "REFUNDED" })
    expect(result.refunded).toBe(50)
    // El movimiento RETURN registra lo que realmente salió de dinero.
    expect(created.inventory[0]).toMatchObject({ type: "RETURN", totalPrice: 50 })
  })

  it("al agotar el renglón la devolución salda el residuo de la prorrata", async () => {
    const { db, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED", total: 200, discountCents: 10000, returnedQuantity: 1 }) })
    const result = await returnSaleItems(db, "admin-1", BIZ, returnInput())
    // Segunda unidad: línea efectiva $100 − $50 ya devueltos = $50.
    expect(created.payments[0]).toMatchObject({ amount: -50 })
    expect(result.refunded).toBe(50)
  })
})

describe("ventas ajenas — anular/devolver exige admin (vector de robo)", () => {
  const voidInput = (over: Record<string, unknown> = {}) => ({
    saleId: "sale-1", reason: "Venta capturada por error", idempotencyKey: key(), ...over,
  })

  it("EMPLOYEE no puede devolver la venta de un compañero", async () => {
    const { db, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED" }) })
    await expect(returnSaleItems(db, "emp-1", BIZ, returnInput())).rejects.toMatchObject({ status: 403 })
    expect(created.payments).toHaveLength(0)
  })

  it("el RETURN del historial tampoco devuelve la venta de un compañero (ledger compartido)", async () => {
    const { db } = fakeDb({
      sale: saleFixture({ status: "COMPLETED" }),
      sourceMovement: { id: "mv-out", businessId: BIZ, type: "OUT", paymentMethod: "EFECTIVO", saleId: "sale-1", productId: "prod-1", quantity: 2, businessVersion: 1, branchId: "branch-1" },
    })
    await expect(moveInventory(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "RETURN", quantity: 1, reason: "Devolución ajena", relatedId: "mv-out" }],
    })).rejects.toMatchObject({ status: 403 })
  })

  it("EMPLOYEE sí devuelve de su propia venta", async () => {
    const { db, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED", sellerId: "emp-1" }) })
    const result = await returnSaleItems(db, "emp-1", BIZ, returnInput())
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: -100, status: "REFUNDED" })
    expect(result.refunded).toBe(100)
  })

  it("EMPLOYEE no puede anular la venta de un compañero", async () => {
    const { db, tx, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED" }) })
    await expect(voidSale(db, "emp-1", BIZ, voidInput())).rejects.toMatchObject({ status: 403 })
    expect(tx.sale.updateMany).not.toHaveBeenCalled()
    expect(created.cash).toHaveLength(0)
  })

  it("EMPLOYEE sí anula su propia venta y reembolsa el neto cobrado", async () => {
    const { db, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED", sellerId: "emp-1", payments: [{ method: "CASH", amount: 100, status: "CONFIRMED" }] }) })
    const result = await voidSale(db, "emp-1", BIZ, voidInput())
    expect(result.saleId).toBe("sale-1")
    expect(created.cash[0]).toMatchObject({ type: "OUT", amount: 100 })
    expect(created.payments[0]).toMatchObject({ method: "CASH", amount: -100, status: "REFUNDED" })
  })

  it("ADMIN sí anula la venta de un empleado", async () => {
    const { db, created } = fakeDb({ sale: saleFixture({ status: "COMPLETED", sellerId: "emp-1", payments: [{ method: "CARD", amount: 100, status: "CONFIRMED" }] }) })
    const result = await voidSale(db, "admin-1", BIZ, voidInput())
    expect(result.saleId).toBe("sale-1")
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: -100, status: "REFUNDED" })
  })
})

describe("abono a crédito — referencia obligatoria en no-efectivo", () => {
  it("abono por TARJETA sin referencia se rechaza", async () => {
    const { db, tx } = fakeDb()
    await expect(changeCredit(db, "emp-1", BIZ, "PAYMENT", {
      userId: "cust-1", amount: 50, paymentMethod: "TARJETA", idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 400, message: "Captura la referencia del abono (mínimo 4 caracteres)." })
    // Ni la operación ni el saldo se tocaron.
    expect(tx.creditMovement.create).not.toHaveBeenCalled()
  })

  it("referencia corta también se rechaza", async () => {
    const { db } = fakeDb()
    await expect(changeCredit(db, "emp-1", BIZ, "PAYMENT", {
      userId: "cust-1", amount: 50, paymentMethod: "TRANSFERENCIA", reference: "abc", idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 400 })
  })

  it("abono por TRANSFERENCIA con referencia queda registrado con su folio", async () => {
    const { db, created } = fakeDb()
    const result = await changeCredit(db, "emp-1", BIZ, "PAYMENT", {
      userId: "cust-1", amount: 50, paymentMethod: "TRANSFERENCIA", reference: "SPEI-9988", idempotencyKey: key(),
    })
    expect(result.creditBalance).toBe(450)
    expect(created.credit[0].notes).toContain("Ref: SPEI-9988")
    expect(created.credit[0].notes).toContain("Medio: TRANSFERENCIA")
    // Sin entrada de caja: el dinero no es efectivo.
    expect(created.cash).toHaveLength(0)
  })

  it("abono en EFECTIVO sigue sin pedir referencia y entra a caja", async () => {
    const { db, created } = fakeDb()
    const result = await changeCredit(db, "emp-1", BIZ, "PAYMENT", {
      userId: "cust-1", amount: 50, paymentMethod: "EFECTIVO", idempotencyKey: key(),
    })
    expect(result.creditBalance).toBe(450)
    expect(created.cash[0]).toMatchObject({ type: "IN", amount: 50, referenceType: "CREDIT_PAYMENT" })
  })
})

describe("cliente suspendido — puede pagar su deuda, no endeudarse", () => {
  it("PAYMENT a un cliente suspendido (sin APPROVED) sí se cobra en mostrador", async () => {
    const { db, created } = fakeDb()
    const result = await changeCredit(db, "emp-1", BIZ, "PAYMENT", {
      userId: "cust-susp", amount: 50, paymentMethod: "EFECTIVO", idempotencyKey: key(),
    })
    expect(result.creditBalance).toBe(450)
    expect(created.cash[0]).toMatchObject({ type: "IN", amount: 50, referenceType: "CREDIT_PAYMENT" })
  })

  it("DEBT a un cliente suspendido sigue respondiendo 403", async () => {
    const { db, tx } = fakeDb()
    await expect(changeCredit(db, "admin-1", BIZ, "DEBT", {
      userId: "cust-susp", amount: 50, idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 403 })
    expect(tx.creditMovement.create).not.toHaveBeenCalled()
  })

  it("PAYMENT a una cuenta de otro tenant sigue respondiendo 403", async () => {
    const { db, created } = fakeDb()
    await expect(changeCredit(db, "emp-1", BIZ, "PAYMENT", {
      userId: "cust-ajeno", amount: 50, paymentMethod: "EFECTIVO", idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 403 })
    expect(created.cash).toHaveLength(0)
  })
})

describe("devolución legada sin venta — dueño o administrador", () => {
  // Salida histórica sin saleId (movimiento viejo): su userId es quien la
  // registró. Sin saleId el RETURN no delega en returnSaleItemsTx.
  const legacyOut = (userId: string | null) => ({
    id: "mv-out", businessId: BIZ, type: "OUT", paymentMethod: "EFECTIVO",
    saleId: null, productId: "prod-1", quantity: 2, businessVersion: 1,
    branchId: "branch-1", userId, unitPrice: 50, totalPrice: 100,
  })
  const legacyReturn = (relatedId: string) => ({
    idempotencyKey: key(),
    items: [{ productId: "prod-1", type: "RETURN", quantity: 1, reason: "Devolución", relatedId }],
  })

  it("EMPLOYEE devuelve un movimiento registrado por él mismo", async () => {
    const { db, created } = fakeDb({ sourceMovement: legacyOut("emp-1") })
    await moveInventory(db, "emp-1", BIZ, legacyReturn("mv-out"))
    expect(created.inventory[0]).toMatchObject({ type: "RETURN", quantity: 1 })
    // Reembolso en efectivo: sale de la caja como OUT.
    expect(created.cash[0]).toMatchObject({ type: "OUT", amount: 50 })
  })

  it("EMPLOYEE no devuelve el movimiento de otra persona (403)", async () => {
    const { db, created } = fakeDb({ sourceMovement: legacyOut("admin-1") })
    await expect(moveInventory(db, "emp-1", BIZ, legacyReturn("mv-out"))).rejects.toMatchObject({ status: 403 })
    expect(created.inventory).toHaveLength(0)
    expect(created.cash).toHaveLength(0)
  })

  it("un movimiento sin creador atribuible también exige ADMIN", async () => {
    const { db } = fakeDb({ sourceMovement: legacyOut(null) })
    await expect(moveInventory(db, "emp-1", BIZ, legacyReturn("mv-out"))).rejects.toMatchObject({ status: 403 })
  })

  it("ADMIN sí devuelve el movimiento de un empleado", async () => {
    const { db, created } = fakeDb({ sourceMovement: legacyOut("emp-1") })
    await moveInventory(db, "admin-1", BIZ, legacyReturn("mv-out"))
    expect(created.cash[0]).toMatchObject({ type: "OUT", amount: 50 })
  })

  it("devolver una reserva a nombre de un cliente exige ADMIN", async () => {
    const { db } = fakeDb({
      reservation: {
        id: "r1", businessId: BIZ, status: "COMPLETED", type: "TEMPORARY",
        userId: "cust-1", productId: "prod-1", quantity: 2, businessVersion: 1,
        branchId: "branch-1", totalPrice: 100, paymentMethod: "EFECTIVO",
        depositPaid: false, depositAmount: null,
      },
    })
    await expect(moveInventory(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "RETURN", quantity: 1, reason: "Devolución", reservationId: "r1" }],
    })).rejects.toMatchObject({ status: 403 })
  })
})

describe("mermas y salidas de inventario — solo admin", () => {
  it.each(["DAMAGED", "LOST", "OUT", "ADJUSTMENT_OUT"] as const)("EMPLOYEE no registra %s sin aprobación", async type => {
    const { db, created } = fakeDb()
    await expect(moveInventory(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type, quantity: 1, reason: "Merma de prueba" }],
    })).rejects.toMatchObject({ status: 403 })
    expect(created.inventory).toHaveLength(0)
  })

  it("ADMIN sí registra una merma DAMAGED", async () => {
    const { db, created } = fakeDb()
    await moveInventory(db, "admin-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "DAMAGED", quantity: 1, reason: "Pantalla rota" }],
    })
    // El enum de BD no tiene DAMAGED: se persiste como OUT con su razón.
    expect(created.inventory[0]).toMatchObject({ type: "OUT", reason: "Pantalla rota" })
  })

  it("EMPLOYEE sigue registrando entradas IN como siempre", async () => {
    const { db, created } = fakeDb()
    await moveInventory(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      items: [{ productId: "prod-1", type: "IN", quantity: 2, reason: "Recepción de mercancía" }],
    })
    expect(created.inventory[0]).toMatchObject({ type: "IN", quantity: 2 })
  })
})
