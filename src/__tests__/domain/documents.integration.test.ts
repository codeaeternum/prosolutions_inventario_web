import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { parkDocument, checkoutDocument, payDocument, cancelDocument, listDocuments } from "@/lib/domain/documents"
import { changeCash } from "@/lib/domain/cash"

const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const prefix = `test-${randomUUID()}`
let admin: string, customer: string, category: string, branchA: string, biz: string
let bizB: string, adminB: string
const key = () => `${prefix}:${randomUUID()}`

/** Producto con existencias en una sucursal; el total cacheado siempre iguala la suma de sucursales. */
async function product(stock = 5, price = 100, branchId = branchA, businessId = biz, categoryId = category) {
  const row = await db.product.create({ data: { businessId, name: `${prefix}-product`, categoryId, stock: 0, retailPrice: price, wholesalePrice: price, images: [] } })
  if (stock > 0) await db.branchStock.create({ data: { businessId, productId: row.id, branchId, quantity: stock } })
  return db.product.update({ where: { id: row.id }, data: { stock } })
}
const stockAt = async (productId: string, branchId = branchA) =>
  (await db.branchStock.findUnique({ where: { productId_branchId: { productId, branchId } } }))?.quantity ?? 0

describe.skipIf(!enabled)("PostgreSQL sales documents (suspendida, cotización, apartado)", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    customer = (await db.user.create({ data: { businessId: biz, name: prefix, role: "CUSTOMER", status: "APPROVED", creditLimit: 10000 } })).id
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    // Segundo tenant para probar el aislamiento entre negocios.
    bizB = (await db.business.create({ data: { name: `${prefix}-B`, slug: `${prefix}-B` } })).id
    adminB = (await db.user.create({ data: { businessId: bizB, name: `${prefix}-B`, role: "ADMIN", status: "APPROVED" } })).id
    // La base de fixture persiste entre corridas: se cierran cajas huérfanas
    // y cada corrida abre la suya en su propia sucursal. Solo se cierran las
    // abiertas hace >5 min (corridas muertas) — las recién abiertas pueden ser
    // de otro archivo de integración corriendo en paralelo.
    await db.cashRegister.updateMany({
      where: { status: "OPEN", openedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
      data: { status: "CLOSED", closedAt: new Date() },
    })
    await changeCash(db, admin, biz, { action: "OPEN", amount: 0, branchId: branchA, idempotencyKey: key() })
  })
  afterAll(async () => { await db.$disconnect() })

  it("park crea un DRAFT con precios snapshot y sin mover stock ni dinero", async () => {
    const p = await product(3, 120)
    const result = await parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId: p.id, quantity: 2 }], branchId: branchA, note: "Cliente volvió por su cartera", idempotencyKey: key() })
    expect(result.sale.status).toBe("DRAFT")
    expect(result.sale.kind).toBe("RETAIL")
    expect(result.sale.total).toBe(240)
    expect(result.items[0].unitPrice).toBe(120)
    expect(result.items[0].totalPrice).toBe(240)
    expect(result.balance).toBe(240)
    // Documento puro: nada de stock, movimientos ni pagos.
    expect(await stockAt(p.id)).toBe(3)
    expect(await db.inventoryMovement.count({ where: { saleId: result.sale.id } })).toBe(0)
    expect(await db.payment.count({ where: { saleId: result.sale.id } })).toBe(0)
  })

  it("checkout cobra con el precio snapshot aunque el catálogo ya cambió", async () => {
    const p = await product(2, 100)
    const doc = await parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, idempotencyKey: key() })
    await db.product.update({ where: { id: p.id }, data: { retailPrice: 999 } })
    const result = await checkoutDocument(db, admin, biz, { saleId: doc.sale.id, paymentMethod: "EFECTIVO", idempotencyKey: key() })
    expect(result.sale.status).toBe("COMPLETED")
    expect(result.total).toBe(100)
    expect(result.payments).toHaveLength(1)
    expect(await stockAt(p.id)).toBe(1)
    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { saleId: doc.sale.id, type: "OUT" } })
    expect(movement.reason).toBe(`Venta V-${doc.sale.number}`)
    expect(movement.unitPrice).toBe(100)
    expect(await db.cashMovement.count({ where: { referenceId: doc.sale.id, type: "IN" } })).toBe(1)
  })

  it("un segundo checkout sobre el mismo documento se rechaza", async () => {
    const p = await product(2)
    const doc = await parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, idempotencyKey: key() })
    await checkoutDocument(db, admin, biz, { saleId: doc.sale.id, paymentMethod: "TARJETA", idempotencyKey: key() })
    await expect(checkoutDocument(db, admin, biz, { saleId: doc.sale.id, paymentMethod: "TARJETA", idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await stockAt(p.id)).toBe(1)
    expect(await db.payment.count({ where: { saleId: doc.sale.id } })).toBe(1)
  })

  it("la cotización vencida no puede cobrarse", async () => {
    const p = await product(2)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const doc = await parkDocument(db, admin, biz, { kind: "QUOTE", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, expiresAt, idempotencyKey: key() })
    expect(doc.sale.status).toBe("DRAFT")
    // La vigencia corre aunque el mostrador no la revise a tiempo.
    await db.sale.update({ where: { id: doc.sale.id }, data: { expiresAt: new Date(0) } })
    await expect(checkoutDocument(db, admin, biz, { saleId: doc.sale.id, paymentMethod: "TARJETA", idempotencyKey: key() })).rejects.toMatchObject({ status: 410, message: "La cotización venció." })
    expect(await stockAt(p.id)).toBe(2)
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("DRAFT")
  })

  it("valida reglas por tipo: apartado con cliente, cotización con vigencia y sin anticipo indebido", async () => {
    const p = await product(5)
    const docsBefore = await db.sale.count({ where: { businessId: biz } })
    await expect(parkDocument(db, admin, biz, { kind: "LAYAWAY", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, idempotencyKey: key() })).rejects.toMatchObject({ status: 400 })
    await expect(parkDocument(db, admin, biz, { kind: "QUOTE", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, idempotencyKey: key() })).rejects.toMatchObject({ status: 400 })
    await expect(parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, payments: [{ method: "EFECTIVO", amount: 10 }], idempotencyKey: key() })).rejects.toMatchObject({ status: 400 })
    await expect(parkDocument(db, admin, biz, { kind: "LAYAWAY", customerId: customer, items: [{ productId: p.id, quantity: 1 }], branchId: branchA, payments: [{ method: "CREDITO", amount: 10 }], idempotencyKey: key() })).rejects.toMatchObject({ status: 400 })
    // Un anticipo que liquida el total no es apartado: es venta.
    await expect(parkDocument(db, admin, biz, { kind: "LAYAWAY", customerId: customer, items: [{ productId: p.id, quantity: 1 }], branchId: branchA, payments: [{ method: "EFECTIVO" }], idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await stockAt(p.id)).toBe(5)
    expect(await db.sale.count({ where: { businessId: biz } })).toBe(docsBefore)
  })

  it("el apartado nace OPEN con stock comprometido y anticipo registrado", async () => {
    const p = await product(4, 100)
    const result = await parkDocument(db, admin, biz, {
      kind: "LAYAWAY", customerId: customer, branchId: branchA, idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 2 }],
      payments: [{ method: "EFECTIVO", amount: 50 }],
    })
    expect(result.sale.status).toBe("OPEN")
    expect(result.sale.kind).toBe("LAYAWAY")
    expect(result.paid).toBe(50)
    expect(result.balance).toBe(150)
    expect(await stockAt(p.id)).toBe(2)
    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { saleId: result.sale.id, type: "OUT" } })
    expect(movement.reason).toBe(`Apartado V-${result.sale.number}`)
    expect(await db.cashMovement.count({ where: { referenceId: result.sale.id, type: "IN", amount: 50 } })).toBe(1)
  })

  it("abono parcial mantiene OPEN y el abono que liquida cierra a COMPLETED", async () => {
    const p = await product(2, 100)
    const doc = await parkDocument(db, admin, biz, {
      kind: "LAYAWAY", customerId: customer, branchId: branchA, idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 1 }], payments: [{ method: "EFECTIVO", amount: 30 }],
    })
    const abono = await payDocument(db, admin, biz, { saleId: doc.sale.id, payments: [{ method: "TARJETA", amount: 40 }], idempotencyKey: key() })
    expect(abono.completed).toBe(false)
    expect(abono.paid).toBe(70)
    expect(abono.balance).toBe(30)
    expect(abono.sale.status).toBe("OPEN")
    // Abono único sin monto = liquidar el saldo.
    const cierre = await payDocument(db, admin, biz, { saleId: doc.sale.id, payments: [{ method: "EFECTIVO" }], idempotencyKey: key() })
    expect(cierre.completed).toBe(true)
    expect(cierre.balance).toBe(0)
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("COMPLETED")
    expect(await db.payment.count({ where: { saleId: doc.sale.id, status: "CONFIRMED" } })).toBe(3)
    await expect(payDocument(db, admin, biz, { saleId: doc.sale.id, payments: [{ method: "EFECTIVO", amount: 1 }], idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
  })

  it("un abono que supera el saldo se rechaza sin registrar dinero", async () => {
    const p = await product(2, 100)
    const doc = await parkDocument(db, admin, biz, {
      kind: "LAYAWAY", customerId: customer, branchId: branchA, idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 1 }], payments: [{ method: "EFECTIVO", amount: 60 }],
    })
    await expect(payDocument(db, admin, biz, { saleId: doc.sale.id, payments: [{ method: "EFECTIVO", amount: 41 }], idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await db.payment.count({ where: { saleId: doc.sale.id } })).toBe(1)
    expect(await db.cashMovement.count({ where: { referenceId: doc.sale.id } })).toBe(1)
  })

  it("cancelar un DRAFT lo anula limpio, sin contramovimientos", async () => {
    const p = await product(2)
    const doc = await parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, idempotencyKey: key() })
    const cancelled = await cancelDocument(db, admin, biz, { saleId: doc.sale.id, reason: "El cliente no volvió", idempotencyKey: key() })
    expect(cancelled.saleId).toBe(doc.sale.id)
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("VOIDED")
    expect(await stockAt(p.id)).toBe(2)
    expect(await db.inventoryMovement.count({ where: { saleId: doc.sale.id } })).toBe(0)
    await expect(checkoutDocument(db, admin, biz, { saleId: doc.sale.id, paymentMethod: "TARJETA", idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
  })

  it("cancelar un apartado repone el stock y reembolsa el anticipo", async () => {
    const p = await product(3, 100)
    const doc = await parkDocument(db, admin, biz, {
      kind: "LAYAWAY", customerId: customer, branchId: branchA, idempotencyKey: key(),
      items: [{ productId: p.id, quantity: 2 }], payments: [{ method: "EFECTIVO", amount: 80 }],
    })
    await cancelDocument(db, admin, biz, { saleId: doc.sale.id, reason: "Cliente se arrepintió", idempotencyKey: key() })
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("VOIDED")
    expect(await stockAt(p.id)).toBe(3)
    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { saleId: doc.sale.id, type: "IN" } })
    expect(movement.reason).toContain(`Cancelación apartado V-${doc.sale.number}`)
    // El anticipo queda VOIDED con su asiento REFUNDED y la salida de caja.
    expect(await db.payment.count({ where: { saleId: doc.sale.id, status: "VOIDED" } })).toBe(1)
    expect(await db.payment.count({ where: { saleId: doc.sale.id, status: "REFUNDED", amount: -80 } })).toBe(1)
    expect(await db.cashMovement.count({ where: { referenceId: doc.sale.id, type: "OUT", amount: 80 } })).toBe(1)
  })

  it("el reintento idempotente de parkDocument devuelve el mismo documento", async () => {
    const p = await product(2)
    const quotesBefore = await db.sale.count({ where: { businessId: biz, kind: "QUOTE", status: "DRAFT" } })
    const input = { kind: "QUOTE" as const, items: [{ productId: p.id, quantity: 1 }], branchId: branchA, expiresAt: new Date(Date.now() + 86400000).toISOString(), idempotencyKey: key() }
    const [first, second] = await Promise.all([parkDocument(db, admin, biz, input), parkDocument(db, admin, biz, input)])
    expect(first.operationId).toBe(second.operationId)
    expect(first.sale.id).toBe(second.sale.id)
    expect(await db.sale.count({ where: { businessId: biz, kind: "QUOTE", status: "DRAFT" } })).toBe(quotesBefore + 1)
  })

  it("un documento de otro negocio no se ve, ni se cobra, ni se cancela", async () => {
    const p = await product(2)
    const doc = await parkDocument(db, admin, biz, { kind: "RETAIL", items: [{ productId: p.id, quantity: 1 }], branchId: branchA, idempotencyKey: key() })
    await expect(checkoutDocument(db, adminB, bizB, { saleId: doc.sale.id, paymentMethod: "TARJETA", idempotencyKey: key() })).rejects.toMatchObject({ status: 404 })
    await expect(cancelDocument(db, adminB, bizB, { saleId: doc.sale.id, reason: "Ajeno", idempotencyKey: key() })).rejects.toMatchObject({ status: 404 })
    const listB = await listDocuments(db, bizB, { status: "DRAFT" })
    expect(listB.some(row => row.id === doc.sale.id)).toBe(false)
    const listA = await listDocuments(db, biz, { status: "DRAFT", kind: "RETAIL" })
    const row = listA.find(r => r.id === doc.sale.id)
    expect(row).toBeTruthy()
    expect(row!.itemCount).toBe(1)
    expect(row!.balance).toBe(100)
    expect((await db.sale.findUniqueOrThrow({ where: { id: doc.sale.id } })).status).toBe("DRAFT")
  })
})
