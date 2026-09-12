import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { moveInventory } from "@/lib/domain/inventory"
import { createReservations, changeReservation } from "@/lib/domain/reservations"
import { sell, returnSaleItems } from "@/lib/domain/sales"
import { PRINCIPAL_BRANCH_ID } from "@/lib/domain/operations"

const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Dedicated localhost:55433/hardening fixture required")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const prefix = `refund-test-${randomUUID()}`
let admin: string, customer: string, category: string

async function product(stock = 1) {
  const row = await db.product.create({ data: { name: prefix, categoryId: category, stock: 0, retailPrice: 100, wholesalePrice: 100, images: [] } })
  if (stock > 0) await db.branchStock.create({ data: { productId: row.id, branchId: PRINCIPAL_BRANCH_ID, quantity: stock } })
  return db.product.update({ where: { id: row.id }, data: { stock } })
}

describe.skipIf(!enabled)("deposit refund safety in PostgreSQL", () => {
  beforeAll(async () => {
    admin = (await db.user.create({ data: { name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    customer = (await db.user.create({ data: { name: prefix, role: "CUSTOMER", status: "APPROVED", creditLimit: 10000, creditBalance: 500 } })).id
    category = (await db.category.create({ data: { name: prefix, slug: prefix } })).id
    await db.branch.upsert({ where: { id: PRINCIPAL_BRANCH_ID }, create: { id: PRINCIPAL_BRANCH_ID, name: "Local principal" }, update: { isActive: true } })
  })
  afterAll(async () => { await db.$disconnect() })

  it.each(["EFECTIVO", "CREDIT", "TRANSFERENCIA"])("does not refund the full price using the final %s method", async paymentMethod => {
    const product = await db.product.create({ data: { name: prefix, categoryId: category, stock: 4, retailPrice: 100, wholesalePrice: 100, images: [] } })
    const reservation = await db.reservation.create({ data: {
      productId: product.id, userId: customer, quantity: 1, totalPrice: 100,
      type: "DEPOSIT", depositAmount: 50, depositPaid: true, status: "COMPLETED",
      paymentMethod, businessVersion: 1, expiresAt: new Date(Date.now() + 60000),
    } })
    const key = `${prefix}:${randomUUID()}`
    await expect(moveInventory(db, admin, { idempotencyKey: key, items: [{ productId: product.id, type: "RETURN", quantity: 1, reason: "Fixture refund", reservationId: reservation.id }] })).rejects.toMatchObject({ status: 409, code: "MIXED_PAYMENT_REFUND_REVIEW" })
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(4)
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(500)
    expect(await db.inventoryMovement.count({ where: { productId: product.id } })).toBe(0)
    expect(await db.creditMovement.count({ where: { referenceId: reservation.id } })).toBe(0)
    expect(await db.cashMovement.count({ where: { userId: admin } })).toBe(0)
    expect(await db.businessOperation.count({ where: { key } })).toBe(0)
  })

  it("cancellation offsets a debt with REVERSAL and never reports a payment", async () => {
    const p = await product(1)
    const result = await createReservations(db, customer, { productId: p.id, paymentMethod: "CREDIT", idempotencyKey: `${prefix}:${randomUUID()}` })
    const reservation = result.reservations[0]
    await changeReservation(db, customer, reservation.id, { action: "cancel" })
    await changeReservation(db, customer, reservation.id, { action: "cancel" })
    const entries = await db.creditMovement.findMany({ where: { referenceId: reservation.id }, orderBy: { createdAt: "asc" } })
    expect(entries.map(entry => ({ type: entry.type, amount: entry.amount }))).toEqual([{ type: "DEBT", amount: 100 }, { type: "REVERSAL", amount: 100 }])
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(500)
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1)
    expect(await db.cashMovement.count({ where: { referenceId: reservation.id } })).toBe(0)
    expect((await db.creditMovement.aggregate({ where: { userId: customer, type: "PAYMENT" }, _sum: { amount: true } }))._sum.amount ?? 0).toBe(0)
  })

  it("a returned credit sale creates one REVERSAL without a cash receipt", async () => {
    const p = await product(1)
    const sale = await sell(db, admin, { items: [{ productId: p.id, quantity: 1 }], customerId: customer, paymentMethod: "CREDITO", idempotencyKey: `${prefix}:${randomUUID()}` })
    const input = { idempotencyKey: `${prefix}:${randomUUID()}`, saleId: sale.sale.id, items: [{ saleItemId: sale.items[0].id, quantity: 1 }], refundMethod: "CREDITO", reason: "Fixture return" }
    const result = await returnSaleItems(db, admin, input)
    await returnSaleItems(db, admin, input)
    const entries = await db.creditMovement.findMany({ where: { referenceId: sale.sale.id }, orderBy: { createdAt: "asc" } })
    expect(entries.map(entry => ({ type: entry.type, amount: entry.amount }))).toEqual([{ type: "DEBT", amount: 100 }, { type: "REVERSAL", amount: 100 }])
    expect((await db.user.findUniqueOrThrow({ where: { id: customer } })).creditBalance).toBe(500)
    expect(result.refund.method).toBe("CREDIT")
    expect(await db.cashMovement.count({ where: { referenceId: sale.sale.id } })).toBe(0)
    expect((await db.creditMovement.aggregate({ where: { userId: customer, type: "PAYMENT" }, _sum: { amount: true } }))._sum.amount ?? 0).toBe(0)
  })
})
