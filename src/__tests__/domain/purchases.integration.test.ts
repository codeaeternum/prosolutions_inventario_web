import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { createPurchase, setPurchaseStatus, updatePurchaseDraft } from "@/lib/domain/purchasing"

const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const prefix = `test-${randomUUID()}`
let admin: string, category: string, branchA: string, branchB: string, biz: string
const key = () => `${prefix}:${randomUUID()}`

async function product() {
  const row = await db.product.create({ data: { businessId: biz, name: `${prefix}-p-${randomUUID().slice(0, 8)}`, categoryId: category, stock: 0, retailPrice: 100, wholesalePrice: 100, images: [] } })
  return row.id
}
const draftOf = async (productId: string, over: object = {}) =>
  createPurchase(db, admin, biz, { branchId: branchA, items: [{ productId, quantity: 2, unitCostCents: 5000 }], idempotencyKey: key(), ...over })

describe.skipIf(!enabled)("purchase draft editing", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    branchB = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-B` } })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("edits items, branch and notes on a DRAFT order keeping its folio", async () => {
    const p1 = await product()
    const p2 = await product()
    const { purchase } = await draftOf(p1)
    const result = await updatePurchaseDraft(db, admin, biz, purchase.id, {
      branchId: branchB,
      notes: "corregida",
      items: [{ productId: p2, quantity: 5, unitCostCents: 3000 }],
    })
    expect(result.folio).toMatch(/^OC-\d{6}$/)
    const updated = await db.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { items: true } })
    expect(updated.number).toBe(purchase.number) // mismo folio, sin cancelar+recapturar
    expect(updated.branchId).toBe(branchB)
    expect(updated.notes).toBe("corregida")
    expect(updated.totalCents).toBe(15000)
    expect(updated.items).toHaveLength(1)
    expect(updated.items[0].productId).toBe(p2)
  })

  it("rejects editing once the order left DRAFT", async () => {
    const p1 = await product()
    const { purchase } = await draftOf(p1)
    await setPurchaseStatus(db, admin, biz, purchase.id, { action: "ORDER", idempotencyKey: key() })
    await expect(updatePurchaseDraft(db, admin, biz, purchase.id, {
      branchId: branchA,
      items: [{ productId: p1, quantity: 1, unitCostCents: 100 }],
    })).rejects.toThrow(/borrador/i)
  })

  it("folio per-tenant: correlativo dentro del negocio y OC-000001 en otro", async () => {
    const p1 = await product()
    const first = await draftOf(p1)
    const second = await draftOf(p1)
    // Sin huecos dentro del tenant aunque la plataforma tenga OCs de otros.
    expect(second.purchase.number).toBe(first.purchase.number + 1)

    const otherBiz = (await db.business.create({ data: { name: `${prefix}-o`, slug: `${prefix}-o` } })).id
    const otherAdmin = (await db.user.create({ data: { businessId: otherBiz, name: `${prefix}-o`, role: "ADMIN", status: "APPROVED" } })).id
    const otherCat = (await db.category.create({ data: { businessId: otherBiz, name: `${prefix}-o`, slug: `${prefix}-o` } })).id
    const otherBranch = (await db.branch.create({ data: { businessId: otherBiz, name: `${prefix}-o` } })).id
    const otherProduct = await db.product.create({ data: { businessId: otherBiz, name: `${prefix}-o-p`, categoryId: otherCat, stock: 0, retailPrice: 1, wholesalePrice: 1, images: [] } })
    const foreign = await createPurchase(db, otherAdmin, otherBiz, {
      branchId: otherBranch,
      items: [{ productId: otherProduct.id, quantity: 1, unitCostCents: 100 }],
      idempotencyKey: key(),
    })
    // Antes del fix este folio hubiera sido el siguiente del autoincrement
    // GLOBAL (p. ej. OC-000043), filtrando el volumen total de la plataforma.
    expect(foreign.purchase.number).toBe(1)
    expect(foreign.folio).toBe("OC-000001")
  })

  it("rejects items of another tenant", async () => {
    const p1 = await product()
    const { purchase } = await draftOf(p1)
    const foreignBiz = (await db.business.create({ data: { name: `${prefix}-f`, slug: `${prefix}-f` } })).id
    const foreignCat = (await db.category.create({ data: { businessId: foreignBiz, name: `${prefix}-f`, slug: `${prefix}-f` } })).id
    const foreign = await db.product.create({ data: { businessId: foreignBiz, name: `${prefix}-foreign`, categoryId: foreignCat, stock: 0, retailPrice: 1, wholesalePrice: 1, images: [] } })
    await expect(updatePurchaseDraft(db, admin, biz, purchase.id, {
      branchId: branchA,
      items: [{ productId: foreign.id, quantity: 1, unitCostCents: 100 }],
    })).rejects.toThrow(/no está disponible/i)
    const untouched = await db.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: { items: true } })
    expect(untouched.items[0].productId).toBe(p1) // la edición fallida no dejó items a medias
  })
})

/**
 * Recepción parcial (RECEIVE_PARTIAL): la OC sigue ORDERED hasta que todas
 * las líneas quedan receivedQty = quantity. Cliente propio porque el describe
 * anterior desconecta `db` en su afterAll (un Pool de pg cerrado no reusa).
 */
describe.skipIf(!enabled)("purchase partial receiving", () => {
  const db2 = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
  let biz2 = "", admin2 = "", cat2 = "", branch2 = ""

  beforeAll(async () => {
    biz2 = (await db2.business.create({ data: { name: `${prefix}-r`, slug: `${prefix}-r` } })).id
    admin2 = (await db2.user.create({ data: { businessId: biz2, name: `${prefix}-r`, role: "ADMIN", status: "APPROVED" } })).id
    cat2 = (await db2.category.create({ data: { businessId: biz2, name: `${prefix}-r`, slug: `${prefix}-r` } })).id
    branch2 = (await db2.branch.create({ data: { businessId: biz2, name: `${prefix}-r` } })).id
  })
  afterAll(async () => { await db2.$disconnect() })

  const product2 = async () =>
    (await db2.product.create({ data: { businessId: biz2, name: `${prefix}-pp-${randomUUID().slice(0, 8)}`, categoryId: cat2, stock: 0, retailPrice: 100, wholesalePrice: 100, images: [] } })).id
  const stockOf = async (productId: string) =>
    (await db2.product.findUniqueOrThrow({ where: { id: productId } })).stock
  /** OC de `quantity` unidades ya en ORDERED; devuelve el id y su única línea. */
  const orderedOf = async (productId: string, quantity = 5) => {
    const { purchase } = await createPurchase(db2, admin2, biz2, {
      branchId: branch2,
      items: [{ productId, quantity, unitCostCents: 5000 }],
      idempotencyKey: key(),
    })
    await setPurchaseStatus(db2, admin2, biz2, purchase.id, { action: "ORDER", idempotencyKey: key() })
    const item = await db2.purchaseItem.findFirstOrThrow({ where: { purchaseId: purchase.id } })
    return { purchaseId: purchase.id, item }
  }

  it("receives a line in parts: stock per delivery, stays ORDERED, ends RECEIVED", async () => {
    const p = await product2()
    const { purchaseId, item } = await orderedOf(p, 5)

    const first = await setPurchaseStatus(db2, admin2, biz2, purchaseId, {
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: item.id, quantity: 2 }],
      idempotencyKey: key(),
    })
    expect(first.status).toBe("ORDERED")
    expect(first.partial).toBe(true)
    expect(first.remaining).toBe(3)
    expect(first.received).toEqual([{ productId: p, qty: 2 }])
    expect(first.pendingItems).toEqual([{ purchaseItemId: item.id, productId: p, pending: 3 }])
    expect(await stockOf(p)).toBe(2)
    let row = await db2.purchaseItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(row.receivedQty).toBe(2)
    let purchase = await db2.purchase.findUniqueOrThrow({ where: { id: purchaseId } })
    expect(purchase.status).toBe("ORDERED")
    expect(purchase.receivedAt).toBeNull()

    const second = await setPurchaseStatus(db2, admin2, biz2, purchaseId, {
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: item.id, quantity: 3 }],
      idempotencyKey: key(),
    })
    expect(second.status).toBe("RECEIVED")
    expect(second.remaining).toBe(0)
    expect(await stockOf(p)).toBe(5)
    row = await db2.purchaseItem.findUniqueOrThrow({ where: { id: item.id } })
    expect(row.receivedQty).toBe(5)
    purchase = await db2.purchase.findUniqueOrThrow({ where: { id: purchaseId } })
    expect(purchase.status).toBe("RECEIVED")
    expect(purchase.receivedAt).not.toBeNull()

    const moves = await db2.inventoryMovement.findMany({ where: { productId: p, type: "IN" } })
    expect(moves.map(m => m.quantity).sort()).toEqual([2, 3])
    expect(moves.some(m => m.reason?.includes("(parcial)"))).toBe(true)
  })

  it("rejects receiving more than the pending quantity", async () => {
    const p = await product2()
    const { purchaseId, item } = await orderedOf(p, 5)
    await setPurchaseStatus(db2, admin2, biz2, purchaseId, {
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: item.id, quantity: 2 }],
      idempotencyKey: key(),
    })
    await expect(setPurchaseStatus(db2, admin2, biz2, purchaseId, {
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: item.id, quantity: 4 }],
      idempotencyKey: key(),
    })).rejects.toThrow(/pendiente/i)
    expect(await stockOf(p)).toBe(2) // el intento no dejó stock a medias
    expect((await db2.purchaseItem.findUniqueOrThrow({ where: { id: item.id } })).receivedQty).toBe(2)
  })

  it("rejects lines belonging to another purchase order", async () => {
    const p = await product2()
    const a = await orderedOf(p, 2)
    const b = await orderedOf(p, 3)
    await expect(setPurchaseStatus(db2, admin2, biz2, a.purchaseId, {
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: b.item.id, quantity: 1 }],
      idempotencyKey: key(),
    })).rejects.toThrow(/no pertenece/i)
    expect(await stockOf(p)).toBe(0)
    expect((await db2.purchaseItem.findUniqueOrThrow({ where: { id: b.item.id } })).receivedQty).toBe(0)
  })

  it("is idempotent by key: replaying the same key does not duplicate stock", async () => {
    const p = await product2()
    const { purchaseId, item } = await orderedOf(p, 4)
    const payload = {
      action: "RECEIVE_PARTIAL" as const,
      items: [{ purchaseItemId: item.id, quantity: 2 }],
      idempotencyKey: key(),
    }
    const first = await setPurchaseStatus(db2, admin2, biz2, purchaseId, payload)
    const replay = await setPurchaseStatus(db2, admin2, biz2, purchaseId, payload)
    expect(replay.operationId).toBe(first.operationId)
    expect(replay.status).toBe("ORDERED")
    expect(await stockOf(p)).toBe(2)
    expect((await db2.purchaseItem.findUniqueOrThrow({ where: { id: item.id } })).receivedQty).toBe(2)
    const moves = await db2.inventoryMovement.findMany({ where: { productId: p, type: "IN" } })
    expect(moves).toHaveLength(1)
  })

  it("keeps classic RECEIVE working on a partially received order", async () => {
    const p = await product2()
    const { purchaseId, item } = await orderedOf(p, 5)
    await setPurchaseStatus(db2, admin2, biz2, purchaseId, {
      action: "RECEIVE_PARTIAL",
      items: [{ purchaseItemId: item.id, quantity: 2 }],
      idempotencyKey: key(),
    })
    const done = await setPurchaseStatus(db2, admin2, biz2, purchaseId, { action: "RECEIVE", idempotencyKey: key() })
    expect(done.status).toBe("RECEIVED")
    expect(done.received).toEqual([{ productId: p, qty: 3 }]) // solo lo pendiente
    expect(await stockOf(p)).toBe(5)
    expect((await db2.purchaseItem.findUniqueOrThrow({ where: { id: item.id } })).receivedQty).toBe(5)
  })
})
