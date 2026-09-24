import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { parkDocument, checkoutDocument } from "@/lib/domain/documents"
import { changeCash } from "@/lib/domain/cash"

const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const prefix = `test-${randomUUID()}`
let admin: string, employee: string, category: string, branchA: string, biz: string
const key = () => `${prefix}:${randomUUID()}`

/** Producto con existencias en una sucursal; el total cacheado siempre iguala la suma de sucursales. */
async function product(stock = 5, price = 200, branchId = branchA) {
  const row = await db.product.create({ data: { businessId: biz, name: `${prefix}-product`, categoryId: category, stock: 0, retailPrice: price, wholesalePrice: price, images: [] } })
  if (stock > 0) await db.branchStock.create({ data: { businessId: biz, productId: row.id, branchId, quantity: stock } })
  return db.product.update({ where: { id: row.id }, data: { stock } })
}
const stockAt = async (productId: string, branchId = branchA) =>
  (await db.branchStock.findUnique({ where: { productId_branchId: { productId, branchId } } }))?.quantity ?? 0

/** Suspende un documento RETAIL del admin listo para cobrar. */
const park = (productId: string, quantity = 1) =>
  parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId, quantity }], branchId: branchA, idempotencyKey: key() })

describe.skipIf(!enabled)("PostgreSQL checkout con descuento autorizado", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    employee = (await db.user.create({ data: { businessId: biz, name: `${prefix}-emp`, role: "EMPLOYEE", status: "APPROVED" } })).id
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    // La base de fixture persiste entre corridas y archivos paralelos: solo se
    // cierran cajas huérfanas de corridas muertas (>5 min), como en los otros
    // archivos de integración.
    await db.cashRegister.updateMany({
      where: { status: "OPEN", openedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
      data: { status: "CLOSED", closedAt: new Date() },
    })
    await changeCash(db, admin, biz, { action: "OPEN", amount: 0, branchId: branchA, idempotencyKey: key() })
  })
  afterAll(async () => { await db.$disconnect() })

  it("ADMIN cobra con descuento: los pagos cuadran contra total − dto y queda en la venta", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    const result = await checkoutDocument(db, admin, biz, {
      saleId: doc.sale.id, paymentMethod: "EFECTIVO",
      discountCents: 5000, discountReason: "Cliente frecuente", idempotencyKey: key(),
    })
    expect(result.sale.status).toBe("COMPLETED")
    expect(result.total).toBe(200) // catálogo intacto
    expect(result.payableCents).toBe(15000)
    expect(result.discountCents).toBe(5000)
    expect(result.discountReason).toBe("Cliente frecuente")
    expect(result.number).toBe(doc.sale.number)
    // El pago único sin monto liquida lo cobrado, no el catálogo.
    expect(result.payments).toHaveLength(1)
    expect(result.payments[0].amount).toBe(150)
    const stored = await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })
    expect(stored.discountCents).toBe(5000)
    expect(stored.discountReason).toBe("Cliente frecuente")
    expect(await db.cashMovement.count({ where: { referenceId: doc.sale.id, type: "IN", amount: 150 } })).toBe(1)
    expect(await stockAt(p.id)).toBe(1)
  })

  it("el pago dividido cuadra contra el total con descuento, no contra el catálogo", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    // Suma del catálogo (200) con descuento de $50: ya no cuadra.
    await expect(checkoutDocument(db, admin, biz, {
      saleId: doc.sale.id, discountCents: 5000, discountReason: "Precio acordado",
      payments: [{ method: "EFECTIVO", amount: 150 }, { method: "TARJETA", amount: 50 }], idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 409 })
    const result = await checkoutDocument(db, admin, biz, {
      saleId: doc.sale.id, discountCents: 5000, discountReason: "Precio acordado",
      payments: [{ method: "EFECTIVO", amount: 100 }, { method: "TARJETA", amount: 50 }], idempotencyKey: key(),
    })
    expect(result.payments).toHaveLength(2)
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("COMPLETED")
  })

  it("EMPLOYEE con descuento mayor al 10% del total se rechaza con 403", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    await expect(checkoutDocument(db, employee, biz, {
      saleId: doc.sale.id, paymentMethod: "TARJETA",
      discountCents: 2100, discountReason: "Se me hizo barato", idempotencyKey: key(),
    })).rejects.toMatchObject({ status: 403, message: "Los empleados pueden descontar hasta 10%; pide autorización al administrador." })
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("DRAFT")
    expect(await db.payment.count({ where: { saleId: doc.sale.id } })).toBe(0)
    expect(await stockAt(p.id)).toBe(2)
  })

  it("EMPLOYEE con descuento de exactamente 10% cobra normal", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    const result = await checkoutDocument(db, employee, biz, {
      saleId: doc.sale.id, paymentMethod: "TARJETA",
      discountCents: 2000, discountReason: "Descuento de mostrador", idempotencyKey: key(),
    })
    expect(result.sale.status).toBe("COMPLETED")
    expect(result.payableCents).toBe(18000)
    expect(result.payments[0].amount).toBe(180)
  })

  it("descuento sin motivo se rechaza por el contrato", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    await expect(checkoutDocument(db, admin, biz, {
      saleId: doc.sale.id, paymentMethod: "TARJETA", discountCents: 1000, idempotencyKey: key(),
    })).rejects.toThrow()
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("DRAFT")
  })

  it("descuento que iguala o supera el total se rechaza", async () => {
    const p = await product(3, 200)
    const doc = await park(p.id)
    for (const discountCents of [20000, 25000]) {
      await expect(checkoutDocument(db, admin, biz, {
        saleId: doc.sale.id, paymentMethod: "TARJETA",
        discountCents, discountReason: "Cortesía indebida", idempotencyKey: key(),
      })).rejects.toMatchObject({ status: 409 })
    }
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("DRAFT")
    expect(await db.payment.count({ where: { saleId: doc.sale.id } })).toBe(0)
  })

  it("el reintento idempotente no duplica el cobro con descuento", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    const input = {
      saleId: doc.sale.id, paymentMethod: "TARJETA" as const,
      discountCents: 5000, discountReason: "Cliente frecuente", idempotencyKey: key(),
    }
    const [first, second] = await Promise.all([
      checkoutDocument(db, admin, biz, input),
      checkoutDocument(db, admin, biz, input),
    ])
    expect(first.operationId).toBe(second.operationId)
    expect(first.payableCents).toBe(15000)
    await expect(checkoutDocument(db, admin, biz, { ...input, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await db.payment.count({ where: { saleId: doc.sale.id } })).toBe(1)
    expect(await stockAt(p.id)).toBe(1)
  })

  it("checkout sin descuento sigue cobrando el total de catálogo", async () => {
    const p = await product(2, 200)
    const doc = await park(p.id)
    const result = await checkoutDocument(db, admin, biz, { saleId: doc.sale.id, paymentMethod: "TARJETA", idempotencyKey: key() })
    expect(result.payableCents).toBe(20000)
    expect(result.discountCents).toBe(0)
    expect(result.payments[0].amount).toBe(200)
    const stored = await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })
    expect(stored.discountCents).toBe(0)
    expect(stored.discountReason).toBeNull()
  })
})
