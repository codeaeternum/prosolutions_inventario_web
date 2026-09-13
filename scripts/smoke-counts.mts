// Smoke test del dominio de conteo físico contra una base scratch.
// Uso: DATABASE_URL=... npx tsx scripts/smoke-counts.mts
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { applyCount, cancelCount, countFolio, createCount, getCount, listCounts, setCountItems } from "../src/lib/domain/counts"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL requerida")
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url })) })
const p = `ct-${randomUUID().slice(0, 8)}`
let failures = 0
const check = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`)
  if (!cond) failures++
}

const biz = await db.business.create({ data: { name: p, slug: p } })
const admin = await db.user.create({ data: { businessId: biz.id, name: p, role: "ADMIN", status: "APPROVED" } })
const branch = await db.branch.create({ data: { businessId: biz.id, name: `${p}-a` } })
const branch2 = await db.branch.create({ data: { businessId: biz.id, name: `${p}-b` } })
const cat = await db.category.create({ data: { businessId: biz.id, name: p, slug: p } })
const mkProduct = async (stock: number, branchQty: number | null) => {
  const prod = await db.product.create({ data: { businessId: biz.id, name: `${p}-${randomUUID().slice(0, 4)}`, categoryId: cat.id, stock, retailPrice: 10, wholesalePrice: 8, images: [] } })
  if (branchQty != null) await db.branchStock.create({ data: { businessId: biz.id, productId: prod.id, branchId: branch.id, quantity: branchQty } })
  return prod
}
const key = () => `smoke-${randomUUID()}`

// Fixture: prodA stock total 5, en sucursal 5; prodB sin fila en sucursal (stock total 0)
const prodA = await mkProduct(5, 5)
const prodB = await mkProduct(0, null)

// 1) createCount
const c1 = await createCount(db, admin.id, biz.id, { branchId: branch.id, notes: "conteo de prueba", idempotencyKey: key() })
check("createCount OPEN", c1.count.status === "OPEN" && c1.folio === "CC-000001", c1.folio)

// 2) segundo OPEN en la misma sucursal → 409
let dup = ""
try { await createCount(db, admin.id, biz.id, { branchId: branch.id, idempotencyKey: key() }) } catch (e) { dup = String((e as { status?: number }).status) }
check("segundo OPEN rechazado (409)", dup === "409", dup)

// 3) idempotencia: misma llave + mismo payload devuelve el mismo conteo
const c2a = await createCount(db, admin.id, biz.id, { branchId: branch2.id, idempotencyKey: "smoke-fixed-key-2" })
const c2b = await createCount(db, admin.id, biz.id, { branchId: branch2.id, idempotencyKey: "smoke-fixed-key-2" })
check("createCount idempotente", c2a.count.id === c2b.count.id && c2a.operationId === c2b.operationId)

// 4) setCountItems: expectedQty del BranchStock vivo (5 y 0)
await setCountItems(db, admin.id, biz.id, c1.count.id, { items: [{ productId: prodA.id, countedQty: 3 }, { productId: prodB.id, countedQty: 2 }], idempotencyKey: key() })
const afterSet = await getCount(db, biz.id, c1.count.id)
const itemA = afterSet!.items.find(i => i.productId === prodA.id)!
const itemB = afterSet!.items.find(i => i.productId === prodB.id)!
check("expectedQty capturado", itemA.expectedQty === 5 && itemB.expectedQty === 0, `A=${itemA.expectedQty} B=${itemB.expectedQty}`)

// 5) drift entre captura y aplicar: se vende 1 de prodA (branch 5→4, total 5→4)
await db.branchStock.update({ where: { productId_branchId: { productId: prodA.id, branchId: branch.id } }, data: { quantity: 4 } })
await db.product.update({ where: { id: prodA.id }, data: { stock: 4 } })

// 6) applyCount: diff vs stock VIVO → A: 3-4=-1 (OUT), B: 2-0=+2 (IN)
const applied = await applyCount(db, admin.id, biz.id, c1.count.id, { idempotencyKey: key() })
check("applyCount APPLIED", applied.status === "APPLIED" && applied.adjustments === 2, `adjustments=${applied.adjustments}`)
const stockA = await db.branchStock.findUnique({ where: { productId_branchId: { productId: prodA.id, branchId: branch.id } } })
const stockB = await db.branchStock.findUnique({ where: { productId_branchId: { productId: prodB.id, branchId: branch.id } } })
const totalA = await db.product.findUniqueOrThrow({ where: { id: prodA.id } })
const totalB = await db.product.findUniqueOrThrow({ where: { id: prodB.id } })
check("branchStock absoluto", stockA?.quantity === 3 && stockB?.quantity === 2, `A=${stockA?.quantity} B=${stockB?.quantity}`)
check("product.stock consistente", totalA.stock === 3 && totalB.stock === 2, `A=${totalA.stock} B=${totalB.stock}`)
const movs = await db.inventoryMovement.findMany({ where: { businessId: biz.id, reason: `Conteo físico ${applied.folio}` }, orderBy: { createdAt: "asc" } })
check("2 movimientos ADJUSTMENT", movs.length === 2 && movs.every(m => m.type === "ADJUSTMENT"), movs.map(m => `${m.type}:${m.quantity}:${m.previousStock}->${m.newStock}`).join(" | "))
check("movimientos con sucursal y usuario", movs.every(m => m.branchId === branch.id && m.userId === admin.id))
const itemA2 = (await getCount(db, biz.id, c1.count.id))!.items.find(i => i.productId === prodA.id)!
check("expectedQty re-sincronizado al aplicar", itemA2.expectedQty === 4 && itemA2.countedQty === 3, `expected=${itemA2.expectedQty}`)

// 7) aplicar dos veces → 409 (y la repetición por idempotency con OTRA llave también falla)
let reapply = ""
try { await applyCount(db, admin.id, biz.id, c1.count.id, { idempotencyKey: key() }) } catch (e) { reapply = String((e as { status?: number }).status) }
check("re-apply rechazado (409)", reapply === "409")

// 8) items en conteo no abierto → 409
let closed = ""
try { await setCountItems(db, admin.id, biz.id, c1.count.id, { items: [{ productId: prodA.id, countedQty: 1 }], idempotencyKey: key() }) } catch (e) { closed = String((e as { status?: number }).status) }
check("items en APPLIED rechazado (409)", closed === "409")

// 9) cancelCount en OPEN (c2a en branch2) y luego reabrir otra en branch2? no: sigue OPEN hasta cancelar
const cancelled = await cancelCount(db, admin.id, biz.id, c2a.count.id, { idempotencyKey: key() })
check("cancelCount CANCELLED", cancelled.status === "CANCELLED")
const c3 = await createCount(db, admin.id, biz.id, { branchId: branch2.id, idempotencyKey: key() })
check("nuevo OPEN tras cancelar", c3.count.status === "OPEN")

// 10) tenant: conteo ajeno no visible
const other = await db.business.create({ data: { name: `${p}-o`, slug: `${p}-o` } })
const foreign = await getCount(db, other.id, c1.count.id)
check("aislamiento por negocio", foreign === null)

// 11) listCounts
const list = await listCounts(db, biz.id, { status: "APPLIED" })
check("listCounts filtra APPLIED", list.length === 1 && list[0].id === c1.count.id)
check("folio CC", countFolio(1) === "CC-000001" && countFolio(42) === "CC-000042")

console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLAS`)
await db.$disconnect()
process.exit(failures === 0 ? 0 : 1)
