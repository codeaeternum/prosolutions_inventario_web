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
