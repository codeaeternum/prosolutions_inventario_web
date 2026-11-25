import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { createProduct } from "@/lib/domain/products"

/**
 * createProduct con stock inicial (src/lib/domain/products.ts): la existencia
 * nace en UNA sucursal (branchId explícito o la sucursal base del actor), deja
 * su InventoryMovement de entrada auditado y el total cacheado Product.stock
 * siempre iguala la suma de sucursales — la inconsistencia inicial es la
 * semilla del drift que luego bloquea ventas con STOCK_DRIFT.
 */
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url }).on("error", (err) => console.error("[pg-pool] idle client error:", err))) })
const prefix = `product-test-${randomUUID()}`
let admin: string, category: string, branchA: string, branchB: string, biz: string

const branchSum = async (productId: string) =>
  (await db.branchStock.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? 0

describe.skipIf(!enabled)("PostgreSQL createProduct with initial stock", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    branchB = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-B` } })).id
    // El admin tiene sucursal base: sin branchId explícito el stock inicial
    // cae en homeBranchId, no en una sucursal arbitraria.
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED", homeBranchId: branchA } })).id
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
  })
  afterAll(async () => { await db.$disconnect() })

  const input = (extra: Record<string, unknown> = {}) => ({
    name: `${prefix}-pieza`, categoryId: category, retailPrice: 100, wholesalePrice: 80, ...extra,
  })

  it("stock inicial con branchId explícito: BranchStock, movimiento IN auditado y total consistente", async () => {
    const product = await createProduct(db, admin, biz, input({ stock: 8, branchId: branchB }))
    expect(product.stock).toBe(8)

    const row = await db.branchStock.findUnique({ where: { productId_branchId: { productId: product.id, branchId: branchB } } })
    expect(row?.quantity).toBe(8)
    // Nada cae en otra sucursal: la existencia nace en una sola.
    expect(await db.branchStock.count({ where: { productId: product.id } })).toBe(1)
    expect(await branchSum(product.id)).toBe(product.stock)

    const movements = await db.inventoryMovement.findMany({ where: { productId: product.id } })
    expect(movements).toHaveLength(1)
    const movement = movements[0]
    expect(movement.type).toBe("IN")
    expect(movement.quantity).toBe(8)
    expect(movement.previousStock).toBe(0)
    expect(movement.newStock).toBe(8)
    expect(movement.reason).toBe("Stock inicial")
    expect(movement.branchId).toBe(branchB)
    expect(movement.userId).toBe(admin)
    expect(movement.businessId).toBe(biz)
  })

  it("sin branchId el stock inicial cae en la sucursal base del actor", async () => {
    const product = await createProduct(db, admin, biz, input({ stock: 5 }))
    expect(product.stock).toBe(5)
    const row = await db.branchStock.findUnique({ where: { productId_branchId: { productId: product.id, branchId: branchA } } })
    expect(row?.quantity).toBe(5)
    expect(await branchSum(product.id)).toBe(5)
    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { productId: product.id } })
    expect(movement.branchId).toBe(branchA)
  })

  it("stock cero no crea fila de sucursal ni movimiento", async () => {
    const product = await createProduct(db, admin, biz, input({ stock: 0 }))
    expect(product.stock).toBe(0)
    expect(await db.branchStock.count({ where: { productId: product.id } })).toBe(0)
    expect(await db.inventoryMovement.count({ where: { productId: product.id } })).toBe(0)
  })

  it("la categoría de otro negocio se rechaza sin crear nada", async () => {
    const other = await db.business.create({ data: { name: `${prefix}-other`, slug: `${prefix}-other` } })
    const foreign = await db.category.create({ data: { businessId: other.id, name: `${prefix}-f`, slug: `${prefix}-f` } })
    await expect(createProduct(db, admin, biz, input({ categoryId: foreign.id, stock: 4 }))).rejects.toMatchObject({ status: 400 })
    expect(await db.product.count({ where: { businessId: biz, categoryId: foreign.id } })).toBe(0)
  })
})
