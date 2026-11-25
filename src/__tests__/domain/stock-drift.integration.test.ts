import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { takeStock, transaction } from "@/lib/domain/operations"

/**
 * Guard STOCK_DRIFT de takeStock (src/lib/domain/operations.ts): la sucursal
 * descuenta con decremento condicional y —en la misma transacción— el total
 * cacheado Product.stock también. Si la sucursal alcanza pero el total NO
 * cubre lo descontado (drift: la suma de sucursales supera al total), la
 * operación entera falla con 409 STOCK_DRIFT y nada se persiste: vender así
 * dejaría el total negativo respecto a la realidad y escondería la
 * inconsistencia en vez de exigir conciliación.
 */
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url }).on("error", (err) => console.error("[pg-pool] idle client error:", err))) })
const prefix = `drift-test-${randomUUID()}`
let category: string, branchA: string, biz: string

const stockAt = async (productId: string) =>
  (await db.branchStock.findUnique({ where: { productId_branchId: { productId, branchId: branchA } } }))?.quantity ?? 0
const totalStock = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock

/** Producto con drift fabricado: la sucursal dice `branchQty` y el total cacheado `totalQty`. */
async function driftedProduct(branchQty: number, totalQty: number) {
  const row = await db.product.create({ data: { businessId: biz, name: `${prefix}-product`, categoryId: category, stock: 0, retailPrice: 100, wholesalePrice: 100, images: [] } })
  if (branchQty > 0) await db.branchStock.create({ data: { businessId: biz, productId: row.id, branchId: branchA, quantity: branchQty } })
  return db.product.update({ where: { id: row.id }, data: { stock: totalQty } })
}
const take = (productId: string, quantity: number) =>
  transaction(db, tx => takeStock(tx, { productId, quantity, branchId: branchA, businessId: biz }))

describe.skipIf(!enabled)("PostgreSQL takeStock STOCK_DRIFT guard", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("cuando la sucursal alcanza pero el total no cubre, falla con STOCK_DRIFT y revierte el decremento", async () => {
    // Drift fabricado: BranchStock 5 vs Product.stock 2 — la suma de
    // sucursales supera al total cacheado en 3 piezas.
    const p = await driftedProduct(5, 2)
    await expect(take(p.id, 3)).rejects.toMatchObject({ status: 409, code: "STOCK_DRIFT" })
    // Rollback completo: ni la sucursal ni el total se movieron.
    expect(await stockAt(p.id)).toBe(5)
    expect(await totalStock(p.id)).toBe(2)
    expect(await db.inventoryMovement.count({ where: { productId: p.id } })).toBe(0)
  })

  it("el drift se detecta aunque la sucursal tenga exactamente lo pedido", async () => {
    const p = await driftedProduct(3, 1)
    await expect(take(p.id, 3)).rejects.toMatchObject({ status: 409, code: "STOCK_DRIFT" })
    expect(await stockAt(p.id)).toBe(3)
    expect(await totalStock(p.id)).toBe(1)
  })

  it("sin drift el decremento de sucursal y total avanzan parejos", async () => {
    // Control consistente: branch 5, total 5 — misma forma que el drift pero
    // sin inconsistencia; el guard no debe estorbar.
    const p = await driftedProduct(5, 5)
    await take(p.id, 2)
    expect(await stockAt(p.id)).toBe(3)
    expect(await totalStock(p.id)).toBe(3)
    // Y al agotar lo consistente, el freno normal de stock insuficiente sigue vivo.
    await expect(take(p.id, 4)).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" })
    expect(await stockAt(p.id)).toBe(3)
    expect(await totalStock(p.id)).toBe(3)
  })

  it("un producto inactivo no descuenta aunque tenga existencias", async () => {
    const p = await driftedProduct(5, 5)
    await db.product.update({ where: { id: p.id }, data: { isActive: false } })
    await expect(take(p.id, 1)).rejects.toMatchObject({ status: 409 })
    expect(await stockAt(p.id)).toBe(5)
    expect(await totalStock(p.id)).toBe(5)
  })
})
