import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { sell } from "@/lib/domain/sales"
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
let admin: string, customer: string, category: string, register: string
const key = () => `${prefix}:${randomUUID()}`
async function product(stock = 5, price = 100) {
  return db.product.create({ data: { name: `${prefix}-product`, categoryId: category, stock, retailPrice: price, wholesalePrice: price, images: [] } })
}
describe.skipIf(!enabled)("PostgreSQL serializable business operations", () => {
  beforeAll(async () => {
    admin = (await db.user.create({ data: { name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    customer = (await db.user.create({ data: { name: prefix, role: "CUSTOMER", status: "APPROVED", creditLimit: 10000 } })).id
    category = (await db.category.create({ data: { name: prefix, slug: prefix } })).id
    // Fixture database may retain an open register from a previous interrupted test run.
    await db.cashRegister.updateMany({ where: { status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } })
    register = (await changeCash(db, admin, { action: "OPEN", amount: 0, idempotencyKey: key() })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("only one of three simultaneous reservations gets the last unit", async () => {
    const p = await product(1)
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => createReservations(db, customer, { productId: p.id, quantity: 1, idempotencyKey: key() })))
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0)
    expect(await db.reservation.count({ where: { productId: p.id } })).toBe(1)
  })
  it("rolls back all cart lines when one is out of stock", async () => {
    const p = await product(2), empty = await product(0)
    await expect(sell(db, admin, { items: [{ productId: p.id, quantity: 1 }, { productId: empty.id, quantity: 1 }], paymentMethod: "EFECTIVO", idempotencyKey: key() })).rejects.toThrow()
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2)
    expect(await db.inventoryMovement.count({ where: { productId: p.id } })).toBe(0)
  })
  it("simultaneous retry commits one sale and one cash entry", async () => {
    const p = await product(3)
    const input = { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "EFECTIVO", idempotencyKey: key() }
    const [first, second] = await Promise.all([sell(db, admin, input), sell(db, admin, input)])
    expect(first.operationId).toBe(second.operationId)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2)
    expect(await db.cashMovement.count({ where: { referenceId: first.movements[0].id } })).toBe(1)
    await expect(sell(db, admin, { ...input, paymentMethod: "TARJETA" })).rejects.toMatchObject({ status: 409 })
  })
  it("card sales never enter the physical cash drawer", async () => {
    const p = await product()
    const result = await sell(db, admin, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "TARJETA", idempotencyKey: key() })
    expect(await db.cashMovement.count({ where: { referenceId: result.movements[0].id } })).toBe(0)
  })
  it("owner cancellation reverses debt and stock once, never creates cash", async () => {
    const p = await product(3)
    const initial = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    const result = await createReservations(db, customer, { productId: p.id, quantity: 1, paymentMethod: "CREDIT", idempotencyKey: key() })
    const id = result.reservations[0].id
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(initial + 100)
    const results = await Promise.all([changeReservation(db, customer, id, { action: "cancel" }), changeReservation(db, customer, id, { action: "cancel" })])
    expect(results.filter(r => r.changed)).toHaveLength(1)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3)
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(initial)
    expect(await db.cashMovement.count({ where: { referenceId: id } })).toBe(0)
    await expect(changeReservation(db, admin, id, { action: "deliver", finalPaymentMethod: "EFECTIVO" })).rejects.toMatchObject({ status: 409 })
  })
  it("expiry releases new reservations through the same audited path", async () => {
    const p = await product(2)
    const result = await createReservations(db, customer, { productId: p.id, idempotencyKey: key() })
    await db.reservation.update({ where: { id: result.reservations[0].id }, data: { expiresAt: new Date(0) } })
    await expireReservations(db)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2)
    expect((await db.reservation.findUniqueOrThrow({ where: { id: result.reservations[0].id } })).status).toBe("EXPIRED")
  })
  it("returns link the original sale and cannot exceed sold units", async () => {
    const p = await product(3)
    const sale = await sell(db, admin, { items: [{ productId: p.id, quantity: 2 }], paymentMethod: "EFECTIVO", idempotencyKey: key() })
    const row = { productId: p.id, type: "RETURN", quantity: 2, reason: "Fixture return", relatedId: sale.movements[0].id }
    const input = { items: [row], idempotencyKey: key() }
    const returned = await moveInventory(db, admin, input)
    await moveInventory(db, admin, input)
    await expect(moveInventory(db, admin, { items: [{ ...row, quantity: 1 }], idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3)
    expect(await db.cashMovement.count({ where: { referenceId: returned.movements[0].id, type: "OUT" } })).toBe(1)
  })
  it("inventory batch rolls back rather than losing failed rows", async () => {
    const p = await product(2)
    await expect(moveInventory(db, admin, { idempotencyKey: key(), items: [{ productId: p.id, type: "IN", quantity: 1, reason: "fixture" }, { productId: p.id, type: "OUT", quantity: 10, reason: "fixture" }] })).rejects.toThrow()
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2)
  })
  it("rejects overpayment and excessive fractional precision without changing balances", async () => {
    await changeCredit(db, admin, "DEBT", { userId: customer, amount: 50, idempotencyKey: key() })
    const balance = (await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance
    await expect(changeCredit(db, admin, "PAYMENT", { userId: customer, amount: balance + 1, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    await expect(changeCredit(db, admin, "DEBT", { userId: customer, amount: 1.001, idempotencyKey: key() })).rejects.toThrow()
    const input = { userId: customer, amount: 25, idempotencyKey: key() }
    const paid = await changeCredit(db, admin, "PAYMENT", input)
    await changeCredit(db, admin, "PAYMENT", input)
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(balance - 25)
    expect(await db.cashMovement.count({ where: { referenceId: paid.movementId } })).toBe(1)
  })
  it("denies a revoked actor even when replaying a committed operation", async () => {
    const p = await product()
    const input = { productId: p.id, idempotencyKey: key() }
    await createReservations(db, customer, input)
    await db.user.update({ where: { id: customer }, data: { status: "REJECTED" } })
    await expect(createReservations(db, customer, input)).rejects.toMatchObject({ status: 403 })
    await db.user.update({ where: { id: customer }, data: { status: "APPROVED" } })
  })
  it("close targets a specific register and cash writes cannot survive its closure", async () => {
    await expect(changeCash(db, admin, { action: "CLOSE", registerId: "wrong", amount: 0, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    await changeCash(db, admin, { action: "CLOSE", registerId: register, amount: 0, idempotencyKey: key() })
    const p = await product(1)
    await expect(sell(db, admin, { items: [{ productId: p.id, quantity: 1 }], paymentMethod: "EFECTIVO", idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1)
  })
  it("workshop preserves intake, tracks location and rejects stale edits", async () => {
    const first = await db.workshopBranch.create({ data: { name: `${prefix}-A` } })
    const second = await db.workshopBranch.create({ data: { name: `${prefix}-B` } })
    const input = { idempotencyKey: key(), customerName: "Cliente ficticio", customerPhone: "0000000000", equipmentType: "Consola", reportedIssue: "No enciende", intakeBranchId: first.id }
    const { order } = await createRepair(db, admin, input)
    expect((await createRepair(db, admin, input)).order.id).toBe(order.id)
    await expect(createRepair(db, customer, { ...input, idempotencyKey: key() })).rejects.toMatchObject({ status: 403 })
    const moved = await updateRepair(db, admin, order.id, { idempotencyKey: key(), expectedVersion: 1, action: "TRANSFER", branchId: second.id, detail: "Recepción por técnico de prueba" })
    expect(moved.order.currentBranchId).toBe(second.id)
    expect(moved.order.intakeBranchId).toBe(first.id)
    await expect(updateRepair(db, admin, order.id, { idempotencyKey: key(), expectedVersion: 1, action: "NOTE", detail: "Texto obsoleto" })).rejects.toMatchObject({ status: 409 })
    expect(await db.repairEvent.count({ where: { orderId: order.id } })).toBe(2)
  })
  it("workshop requires diagnosis, approval and quality review before delivery", async () => {
    const branch = await db.workshopBranch.findFirstOrThrow({ where: { name: `${prefix}-A` } })
    const { order } = await createRepair(db, admin, { idempotencyKey: key(), customerName: "Cliente ficticio", customerPhone: "0000000001", equipmentType: "Audio", reportedIssue: "Sin sonido", intakeBranchId: branch.id })
    let version = order.version
    const update = async (payload: Record<string, unknown>) => {
      const result = await updateRepair(db, admin, order.id, { idempotencyKey: key(), expectedVersion: version, detail: "Prueba documentada", ...payload })
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

})
