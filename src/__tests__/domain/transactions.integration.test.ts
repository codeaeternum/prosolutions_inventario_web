import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { sell, returnSaleItems, voidSale } from "@/lib/domain/sales"
import { createReservations, changeReservation, expireReservations } from "@/lib/domain/reservations"
import { changeCash } from "@/lib/domain/cash"
import { changeCredit } from "@/lib/domain/credit"
import { createRepair, updateRepair } from "@/lib/domain/workshop"
import { moveInventory } from "@/lib/domain/inventory"

const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const prefix = `test-${randomUUID()}`
let admin: string, customer: string, category: string, register: string, branchA: string, branchB: string, biz: string
const key = () => `${prefix}:${randomUUID()}`

/** Producto con existencias en una sucursal; el total cacheado siempre iguala la suma de sucursales. */
async function product(stock = 5, price = 100, branchId = branchA) {
  const row = await db.product.create({ data: { businessId: biz, name: `${prefix}-product`, categoryId: category, stock: 0, retailPrice: price, wholesalePrice: price, images: [] } })
  if (stock > 0) await db.branchStock.create({ data: { businessId: biz, productId: row.id, branchId, quantity: stock } })
  return db.product.update({ where: { id: row.id }, data: { stock } })
}
const stockAt = async (productId: string, branchId = branchA) =>
  (await db.branchStock.findUnique({ where: { productId_branchId: { productId, branchId } } }))?.quantity ?? 0

describe.skipIf(!enabled)("PostgreSQL serializable business operations", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    customer = (await db.user.create({ data: { businessId: biz, name: prefix, role: "CUSTOMER", status: "APPROVED", creditLimit: 10000 } })).id
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
    // La base de fixture persiste entre corridas y otros archivos de prueba:
    // "branch-principal" queda ligado al primer negocio que lo creó, así que
    // cada corrida usa sus propias sucursales y resolveBranch cae al fallback.
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    branchB = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-B` } })).id
    // Fixture database may retain open registers from a previous interrupted test run.
    await db.cashRegister.updateMany({ where: { status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } })
    register = (await changeCash(db, admin, biz, { action: "OPEN", amount: 0, branchId: branchA, idempotencyKey: key() })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("only one of three simultaneous reservations gets the last unit", async () => {
    const p = await product(1)
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => createReservations(db, customer, biz, { productId: p.id, quantity: 1, idempotencyKey: key() })))
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
    expect(await stockAt(p.id)).toBe(0)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0)
    expect(await db.reservation.count({ where: { productId: p.id } })).toBe(1)
    expect((await db.reservation.findFirstOrThrow({ where: { productId: p.id } })).branchId).toBe(branchA)
  })
  it("rolls back all cart lines when one is out of stock", async () => {
    const p = await product(2), empty = await product(0)
    await expect(sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }, { productId: empty.id, quantity: 1 }], paymentMethod: "EFECTIVO", branchId: branchA, idempotencyKey: key() })).rejects.toThrow()
    expect(await stockAt(p.id)).toBe(2)
    expect(await db.sale.count({ where: { sellerId: admin } })).toBe(0)
    expect(await db.inventoryMovement.count({ where: { productId: p.id } })).toBe(0)
  })
  it("a sale is a numbered document and simultaneous retry commits it once", async () => {
    const p = await product(3)
    const input = { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "EFECTIVO", branchId: branchA, idempotencyKey: key() }
    const [first, second] = await Promise.all([sell(db, admin, biz, input), sell(db, admin, biz, input)])
    expect(first.operationId).toBe(second.operationId)
    expect(first.sale.id).toBe(second.sale.id)
    expect(first.sale.number).toBeGreaterThan(0)
    expect(first.sale.branchId).toBe(branchA)
    expect(first.payments).toHaveLength(1)
    expect(await stockAt(p.id)).toBe(2)
    expect(await db.cashMovement.count({ where: { referenceId: first.sale.id } })).toBe(1)
    await expect(sell(db, admin, biz, { ...input, paymentMethod: "TARJETA" })).rejects.toMatchObject({ status: 409 })
  })
  it("card sales never enter the physical cash drawer", async () => {
    const p = await product()
    const result = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "TARJETA", branchId: branchA, idempotencyKey: key() })
    expect(await db.cashMovement.count({ where: { referenceId: result.sale.id } })).toBe(0)
  })
  it("stock is isolated per branch: branch B cannot sell branch A's units", async () => {
    const p = await product(2)
    await expect(sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "EFECTIVO", branchId: branchB, idempotencyKey: key() })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" })
    expect(await stockAt(p.id)).toBe(2)
    expect(await stockAt(p.id, branchB)).toBe(0)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2)
  })
  it("each branch has its own register: B opens while principal is open", async () => {
    const other = await changeCash(db, admin, biz, { action: "OPEN", amount: 100, branchId: branchB, idempotencyKey: key() })
    expect((await db.cashRegister.findUniqueOrThrow({ where: { id: other.id } })).branchId).toBe(branchB)
    await expect(changeCash(db, admin, biz, { action: "OPEN", amount: 0, branchId: branchB, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    await changeCash(db, admin, biz, { action: "CLOSE", registerId: other.id, amount: 100, branchId: branchB, idempotencyKey: key() })
  })
  it("transfers move stock between branches atomically and audit both ends", async () => {
    const p = await product(4)
    await moveInventory(db, admin, biz, { idempotencyKey: key(), branchId: branchA, items: [{ productId: p.id, type: "TRANSFER", quantity: 3, reason: "Fixture", toBranchId: branchB }] })
    expect(await stockAt(p.id)).toBe(1)
    expect(await stockAt(p.id, branchB)).toBe(3)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4)
    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { productId: p.id, type: "TRANSFER" } })
    expect(movement.toBranchId).toBe(branchB)
    await expect(moveInventory(db, admin, biz, { idempotencyKey: key(), items: [{ productId: p.id, type: "TRANSFER", quantity: 9, reason: "Fixture", branchId: branchA, toBranchId: branchB }] })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" })
  })
  it("a split cash+credit sale charges debt only for the credit part", async () => {
    const p = await product(2, 200)
    const before = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    const result = await sell(db, admin, biz, {
      items: [{ productId: p.id, quantity: 2 }], branchId: branchA, customerId: customer,
      payments: [{ method: "EFECTIVO", amount: 150 }, { method: "CREDITO", amount: 250 }], idempotencyKey: key(),
    })
    expect(result.sale.total).toBe(400)
    expect(result.payments).toHaveLength(2)
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(before + 250)
    expect(await db.cashMovement.count({ where: { referenceId: result.sale.id, type: "IN" } })).toBe(1)
  })
  it("sale returns restore branch stock, cap at sold units and refund once", async () => {
    const p = await product(3)
    const sale = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 2 }], paymentMethod: "EFECTIVO", branchId: branchA, idempotencyKey: key() })
    const line = { saleItemId: sale.items[0].id, quantity: 2 }
    const input = { saleId: sale.sale.id, items: [line], refundMethod: "EFECTIVO", reason: "Fixture return", idempotencyKey: key() }
    const returned = await returnSaleItems(db, admin, biz, input)
    await returnSaleItems(db, admin, biz, input)
    await expect(returnSaleItems(db, admin, biz, { saleId: sale.sale.id, items: [{ ...line, quantity: 1 }], refundMethod: "EFECTIVO", reason: "Extra", idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await stockAt(p.id)).toBe(3)
    expect(returned.refund.method).toBe("CASH")
    expect(await db.cashMovement.count({ where: { referenceId: sale.sale.id, type: "OUT" } })).toBe(1)
    expect((await db.saleItem.findUniqueOrThrow({ where: { id: sale.items[0].id } })).returnedQuantity).toBe(2)
  })
  it("voiding a sale keeps the document, restocks the branch and voids payments", async () => {
    const p = await product(2)
    const sale = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 2 }], paymentMethod: "EFECTIVO", branchId: branchA, idempotencyKey: key() })
    const input = { saleId: sale.sale.id, reason: "Venta capturada por error", idempotencyKey: key() }
    await voidSale(db, admin, biz, input)
    await expect(voidSale(db, admin, biz, { ...input, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.sale.id } })).status).toBe("VOIDED")
    expect(await stockAt(p.id)).toBe(2)
    expect(await db.payment.count({ where: { saleId: sale.sale.id, status: "VOIDED" } })).toBe(1)
    expect(await db.cashMovement.count({ where: { referenceId: sale.sale.id, type: "OUT" } })).toBe(1)
  })
  it("owner cancellation reverses debt and stock once, never creates cash", async () => {
    const p = await product(3)
    const initial = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    const result = await createReservations(db, customer, biz, { productId: p.id, quantity: 1, paymentMethod: "CREDIT", idempotencyKey: key() })
    const id = result.reservations[0].id
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(initial + 100)
    const results = await Promise.all([changeReservation(db, customer, biz, id, { action: "cancel" }), changeReservation(db, customer, biz, id, { action: "cancel" })])
    expect(results.filter(r => r.changed)).toHaveLength(1)
    expect(await stockAt(p.id)).toBe(3)
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(initial)
    expect(await db.cashMovement.count({ where: { referenceId: id } })).toBe(0)
    await expect(changeReservation(db, admin, biz, id, { action: "deliver", finalPaymentMethod: "EFECTIVO" })).rejects.toMatchObject({ status: 409 })
  })
  it("expiry releases new reservations through the same audited path", async () => {
    const p = await product(2)
    const result = await createReservations(db, customer, biz, { productId: p.id, idempotencyKey: key() })
    await db.reservation.update({ where: { id: result.reservations[0].id }, data: { expiresAt: new Date(0) } })
    await expireReservations(db)
    expect(await stockAt(p.id)).toBe(2)
    expect((await db.reservation.findUniqueOrThrow({ where: { id: result.reservations[0].id } })).status).toBe("EXPIRED")
  })
  it("inventory batch rolls back rather than losing failed rows", async () => {
    const p = await product(2)
    await expect(moveInventory(db, admin, biz, { idempotencyKey: key(), branchId: branchA, items: [{ productId: p.id, type: "IN", quantity: 1, reason: "fixture" }, { productId: p.id, type: "OUT", quantity: 10, reason: "fixture" }] })).rejects.toThrow()
    expect(await stockAt(p.id)).toBe(2)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2)
  })
  it("rejects overpayment and excessive fractional precision without changing balances", async () => {
    await changeCredit(db, admin, biz, "DEBT", { userId: customer, amount: 50, idempotencyKey: key() })
    const balance = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    await expect(changeCredit(db, admin, biz, "PAYMENT", { userId: customer, amount: balance + 1, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    await expect(changeCredit(db, admin, biz, "DEBT", { userId: customer, amount: 1.001, idempotencyKey: key() })).rejects.toThrow()
    const input = { userId: customer, amount: 25, idempotencyKey: key() }
    const paid = await changeCredit(db, admin, biz, "PAYMENT", input)
    await changeCredit(db, admin, biz, "PAYMENT", input)
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(balance - 25)
    expect(await db.cashMovement.count({ where: { referenceId: paid.movementId } })).toBe(1)
  })
  it("denies a revoked actor even when replaying a committed operation", async () => {
    const p = await product()
    const input = { productId: p.id, idempotencyKey: key() }
    await createReservations(db, customer, biz, input)
    await db.user.update({ where: { id: customer }, data: { status: "REJECTED" } })
    await expect(createReservations(db, customer, biz, input)).rejects.toMatchObject({ status: 403 })
    await db.user.update({ where: { id: customer }, data: { status: "APPROVED" } })
  })
  it("close targets a specific register and cash writes cannot survive its closure", async () => {
    await expect(changeCash(db, admin, biz, { action: "CLOSE", registerId: "wrong", amount: 0, branchId: branchA, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    await changeCash(db, admin, biz, { action: "CLOSE", registerId: register, amount: 0, branchId: branchA, idempotencyKey: key() })
    const p = await product(1)
    await expect(sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "EFECTIVO", branchId: branchA, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await stockAt(p.id)).toBe(1)
  })
  it("workshop preserves intake, tracks location and rejects stale edits", async () => {
    const input = { idempotencyKey: key(), customerName: "Cliente ficticio", customerPhone: "0000000000", equipmentType: "Consola", reportedIssue: "No enciende", intakeBranchId: branchA }
    const { order } = await createRepair(db, admin, biz, input)
    expect((await createRepair(db, admin, biz, input)).order.id).toBe(order.id)
    await expect(createRepair(db, customer, biz, { ...input, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 })
    const moved = await updateRepair(db, admin, biz, order.id, { idempotencyKey: key(), expectedVersion: 1, action: "TRANSFER", branchId: branchB, detail: "Recepción por técnico de prueba" })
    expect(moved.order.currentBranchId).toBe(branchB)
    expect(moved.order.intakeBranchId).toBe(branchA)
    await expect(updateRepair(db, admin, biz, order.id, { idempotencyKey: key(), expectedVersion: 1, action: "NOTE", detail: "Texto obsoleto" })).rejects.toMatchObject({ status: 409 })
    expect(await db.repairEvent.count({ where: { orderId: order.id } })).toBe(2)
  })
  it("workshop requires diagnosis, approval and quality review before delivery", async () => {
    const { order } = await createRepair(db, admin, biz, { idempotencyKey: key(), customerName: "Cliente ficticio", customerPhone: "0000000001", equipmentType: "Audio", reportedIssue: "Sin sonido", intakeBranchId: branchA })
    let version = order.version
    const update = async (payload: Record<string, unknown>) => {
      const result = await updateRepair(db, admin, biz, order.id, { idempotencyKey: key(), expectedVersion: version, detail: "Prueba documentada", ...payload })
      version = result.order.version
      return result.order
    }
    await expect(update({ action: "STATUS", status: "DELIVERED" })).rejects.toMatchObject({ status: 409 })
    await update({ action: "STATUS", status: "DIAGNOSIS" })
    await update({ action: "QUOTE", quoteCents: 45000 })
    await expect(update({ action: "STATUS", status: "IN_REPAIR" })).rejects.toMatchObject({ status: 409 })
    expect((await update({ action: "APPROVE", detail: "Cliente de prueba autoriza en persona" })).approvedQuoteCents).toBe(45000)
    await update({ action: "STATUS", status: "QUALITY_CHECK" })
    expect((await update({ action: "STATUS", status: "READY", detail: "Salida de audio y carga verificadas" })).qualityCheck).toContain("verificadas")
    expect((await update({ action: "STATUS", status: "DELIVERED", detail: "Recibe cliente ficticio" })).deliveredTo).toBe("Recibe cliente ficticio")
    await expect(update({ action: "NOTE", detail: "Reescribir historial" })).rejects.toMatchObject({ status: 409 })
    expect(await db.cashMovement.count({ where: { referenceId: order.id } })).toBe(0)
  })
  it("workshop money cycle: anticipo, abono y liquidación al entregar", async () => {
    // La caja del suite ya se cerró en la prueba anterior; abrimos una nueva.
    register = (await changeCash(db, admin, biz, { action: "OPEN", amount: 0, branchId: branchA, idempotencyKey: key() })).id
    const { order } = await createRepair(db, admin, biz, {
      idempotencyKey: key(), customerName: "Cliente ficticio", customerPhone: "0000000002",
      equipmentType: "Celular", reportedIssue: "Pantalla rota", intakeBranchId: branchA,
      advance: { amountCents: 10000, method: "CASH" },
    })
    expect(await db.payment.count({ where: { repairOrderId: order.id, purpose: "ADVANCE" } })).toBe(1)
    expect(await db.cashMovement.count({ where: { referenceType: "REPAIR_PAYMENT" } })).toBeGreaterThanOrEqual(1)

    let version = order.version
    const update = async (payload: Record<string, unknown>) => {
      const result = await updateRepair(db, admin, biz, order.id, { idempotencyKey: key(), expectedVersion: version, detail: "Prueba documentada", ...payload })
      version = result.order.version
      return result.order
    }
    await update({ action: "STATUS", status: "DIAGNOSIS" })
    await update({ action: "QUOTE", quoteCents: 50000 })
    await update({ action: "APPROVE" })
    // Abono parcial — queda saldo de 30000
    await update({ action: "PAYMENT", paymentCents: 10000, paymentMethod: "CARD" })
    // Entrega temprana se rechaza (aún no está READY)
    await expect(update({ action: "SETTLE_DELIVER", paymentMethod: "CASH" })).rejects.toMatchObject({ status: 409 })
    await update({ action: "STATUS", status: "QUALITY_CHECK" })
    await update({ action: "STATUS", status: "READY", detail: "Todo verificado" })
    // Liquidar y entregar cobra el saldo restante de una vez
    const delivered = await update({ action: "SETTLE_DELIVER", paymentMethod: "CASH", detail: "Recibe el titular" })
    expect(delivered.status).toBe("DELIVERED")
    const paid = await db.payment.aggregate({ _sum: { amount: true }, where: { repairOrderId: order.id, status: "CONFIRMED" } })
    expect(paid._sum.amount).toBe(500)
    // Orden cerrada: solo garantía puede reabrirla
    await expect(updateRepair(db, admin, biz, order.id, { idempotencyKey: key(), expectedVersion: version, action: "NOTE", detail: "x" })).rejects.toMatchObject({ status: 409 })
    const reopened = await updateRepair(db, admin, biz, order.id, { idempotencyKey: key(), expectedVersion: version, action: "STATUS", status: "WARRANTY", detail: "Reingreso por garantía" })
    expect(reopened.order.status).toBe("WARRANTY")
  })

  it("sale movements carry the payment method so they classify as sales, not shrinkage", async () => {
    const p = await product(2)
    const sale = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "TARJETA", branchId: branchA, idempotencyKey: key() })
    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { saleId: sale.sale.id, type: "OUT" } })
    expect(movement.paymentMethod).toBe("TARJETA")
  })

  it("requires a reference on transfer sales", async () => {
    const p = await product(2)
    await expect(sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "TRANSFERENCIA", branchId: branchA, idempotencyKey: key() })).rejects.toThrow("referencia")
    expect(await stockAt(p.id)).toBe(2)
    const ok = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], payments: [{ method: "TRANSFERENCIA", reference: "SPEI-123" }], branchId: branchA, idempotencyKey: key() })
    expect(ok.payments[0].reference).toBe("SPEI-123")
  })

  it("voiding after a partial return refunds only the remaining net per method", async () => {
    const p = await product(3)
    const sale = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 2 }], paymentMethod: "EFECTIVO", branchId: branchA, idempotencyKey: key() })
    await returnSaleItems(db, admin, biz, { saleId: sale.sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }], refundMethod: "EFECTIVO", reason: "Devolución parcial", idempotencyKey: key() })
    await voidSale(db, admin, biz, { saleId: sale.sale.id, reason: "Venta capturada por error", idempotencyKey: key() })
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.sale.id } })).status).toBe("VOIDED")
    expect(await stockAt(p.id)).toBe(3)
    // Un OUT por la devolución parcial y otro por el neto que quedaba al anular.
    expect(await db.cashMovement.count({ where: { referenceId: sale.sale.id, type: "OUT" } })).toBe(2)
    expect(await db.payment.count({ where: { saleId: sale.sale.id, status: "VOIDED" } })).toBe(1)
  })

  it("voiding a split sale refunds each method's remaining net only", async () => {
    const p = await product(2)
    const before = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    const sale = await sell(db, admin, biz, {
      items: [{ productId: p.id, quantity: 2 }], customerId: customer, branchId: branchA,
      payments: [{ method: "EFECTIVO", amount: 100 }, { method: "CREDITO", amount: 100 }], idempotencyKey: key(),
    })
    await returnSaleItems(db, admin, biz, { saleId: sale.sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }], refundMethod: "EFECTIVO", reason: "Devolución parcial", idempotencyKey: key() })
    await voidSale(db, admin, biz, { saleId: sale.sale.id, reason: "Venta capturada por error", idempotencyKey: key() })
    // Efectivo: cobró 100 y ya devolvió 100 → neto 0, sin segundo OUT.
    expect(await db.cashMovement.count({ where: { referenceId: sale.sale.id, type: "OUT" } })).toBe(1)
    // Crédito: neto 100 → reversa completa de esa deuda.
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(before)
    expect(await db.payment.count({ where: { saleId: sale.sale.id, status: "VOIDED" } })).toBe(2)
    expect(await stockAt(p.id)).toBe(2)
  })

  it("voiding a credit sale the customer already paid down returns the collected cash", async () => {
    const p = await product(1)
    const sale = await sell(db, admin, biz, { items: [{ productId: p.id, quantity: 1 }], customerId: customer, paymentMethod: "CREDITO", branchId: branchA, idempotencyKey: key() })
    // El cliente abona casi todo en efectivo: queda debiendo 60 de los 100 de ESTA venta.
    const owed = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    await changeCredit(db, admin, biz, "PAYMENT", { userId: customer, amount: owed - 60, branchId: branchA, idempotencyKey: key() })
    await voidSale(db, admin, biz, { saleId: sale.sale.id, reason: "Crédito capturado por error", idempotencyKey: key() })
    const entries = await db.creditMovement.findMany({ where: { referenceId: sale.sale.id }, orderBy: { createdAt: "asc" } })
    expect(entries.map(e => ({ type: e.type, amount: e.amount }))).toEqual([{ type: "DEBT", amount: 100 }, { type: "REVERSAL", amount: 60 }])
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(0)
    // Los 40 ya cobrados salen de la caja como devolución.
    expect(await db.cashMovement.count({ where: { referenceId: sale.sale.id, type: "OUT", amount: 40 } })).toBe(1)
    expect((await db.sale.findUniqueOrThrow({ where: { id: sale.sale.id } })).status).toBe("VOIDED")
  })

  it("a cash credit payment posts to the register of the branch where it was collected", async () => {
    const registerB = await changeCash(db, admin, biz, { action: "OPEN", amount: 50, branchId: branchB, idempotencyKey: key() })
    await changeCredit(db, admin, biz, "DEBT", { userId: customer, amount: 30, idempotencyKey: key() })
    const paid = await changeCredit(db, admin, biz, "PAYMENT", { userId: customer, amount: 10, branchId: branchB, idempotencyKey: key() })
    expect((await db.cashMovement.findFirstOrThrow({ where: { referenceId: paid.movementId } })).registerId).toBe(registerB.id)
    await changeCash(db, admin, biz, { action: "CLOSE", registerId: registerB.id, amount: 60, branchId: branchB, idempotencyKey: key() })
  })

  it("an employee can collect credit payments but cannot charge debt", async () => {
    const employee = (await db.user.create({ data: { businessId: biz, name: `${prefix}-emp`, role: "EMPLOYEE", status: "APPROVED", homeBranchId: branchA } })).id
    await changeCredit(db, admin, biz, "DEBT", { userId: customer, amount: 30, idempotencyKey: key() })
    const paid = await changeCredit(db, employee, biz, "PAYMENT", { userId: customer, amount: 10, idempotencyKey: key() })
    // El abono en efectivo cayó a la caja de SU sucursal base.
    expect((await db.cashMovement.findFirstOrThrow({ where: { referenceId: paid.movementId } })).registerId).toBe(register)
    await expect(changeCredit(db, employee, biz, "DEBT", { userId: customer, amount: 10, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 })
  })

  it("cash withdrawal by employee, overdrawn withdrawal, and closing someone else's till are rejected", async () => {
    const employee = (await db.user.create({ data: { businessId: biz, name: `${prefix}-emp2`, role: "EMPLOYEE", status: "APPROVED", homeBranchId: branchA } })).id
    await expect(changeCash(db, employee, biz, { action: "MOVEMENT", type: "OUT", amount: 1, registerId: register, branchId: branchA, description: "Retiro sin autorización", idempotencyKey: key() })).rejects.toMatchObject({ status: 403 })
    await expect(changeCash(db, employee, biz, { action: "CLOSE", registerId: register, amount: 0, branchId: branchA, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 })
    await expect(changeCash(db, admin, biz, { action: "MOVEMENT", type: "OUT", amount: 999999, registerId: register, branchId: branchA, description: "Sobregiro fixture", idempotencyKey: key() })).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_CASH" })
    // El empleado SÍ puede abrir su propio turno y cerrarlo él mismo.
    const own = await changeCash(db, employee, biz, { action: "OPEN", amount: 10, branchId: branchB, idempotencyKey: key() })
    await changeCash(db, employee, biz, { action: "CLOSE", registerId: own.id, amount: 10, branchId: branchB, idempotencyKey: key() })
  })

})
