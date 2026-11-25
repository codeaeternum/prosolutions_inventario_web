import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { randomUUID } from "node:crypto"
import { applyCount, cancelCount, countForClient, countFolio, createCount, getCount, listCounts, setCountItems } from "@/lib/domain/counts"
import { sell } from "@/lib/domain/sales"

/**
 * Invariantes del conteo físico contra PostgreSQL real — promueve
 * scripts/smoke-counts.mts a pruebas del suite. La matemática correcta del
 * ajuste es: la diferencia REAL se calcula al capturar
 * (countedQty − expectedQty_de_captura) y se aplica al stock VIVO al aplicar,
 * de modo que las ventas/traspasos ocurridos durante la captura se conservan:
 *
 *   finalBranchStock = stockVivo + (countedQty − expectedQtyCaptura)
 *
 * Un conteo que cuadra exacto (countedQty == expectedQty) no debe generar
 * ningún ajuste aunque el stock se haya movido después de capturar.
 */
const enabled = process.env.RUN_DATABASE_TESTS === "1"
const url = process.env.DATABASE_URL ?? "postgresql://audit:audit-isolated-only@127.0.0.1:55433/hardening"
if (enabled) {
  const target = new URL(url)
  if (target.hostname !== "127.0.0.1" || target.port !== "55433" || target.pathname !== "/hardening" || target.username !== "audit") throw new Error("Tests require the dedicated localhost:55433/hardening fixture database")
}
const db = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: url }).on("error", (err) => console.error("[pg-pool] idle client error:", err))) })
const prefix = `count-test-${randomUUID()}`
let admin: string, category: string, branchA: string, branchB: string, biz: string
const key = () => `${prefix}:${randomUUID()}`

/** Producto con existencias en una sucursal; el total cacheado siempre iguala la suma de sucursales. */
async function product(stock = 5, branchId = branchA) {
  const row = await db.product.create({ data: { businessId: biz, name: `${prefix}-product`, categoryId: category, stock: 0, retailPrice: 100, wholesalePrice: 100, images: [] } })
  if (stock > 0) await db.branchStock.create({ data: { businessId: biz, productId: row.id, branchId, quantity: stock } })
  return db.product.update({ where: { id: row.id }, data: { stock } })
}
const stockAt = async (productId: string, branchId = branchA) =>
  (await db.branchStock.findUnique({ where: { productId_branchId: { productId, branchId } } }))?.quantity ?? 0
const totalStock = async (productId: string) => (await db.product.findUniqueOrThrow({ where: { id: productId } })).stock

/** Abre un conteo en branchA y captura los items dados. */
async function captureCount(items: { productId: string; countedQty: number }[], branchId = branchA) {
  const created = await createCount(db, admin, biz, { branchId, idempotencyKey: key() })
  await setCountItems(db, admin, biz, created.count.id, { items, idempotencyKey: key() })
  return created
}

/** Venta de mostrador por tarjeta: descuenta stock sin exigir caja abierta. */
const sellUnits = (productId: string, quantity: number, branchId = branchA) =>
  sell(db, admin, biz, { items: [{ productId, quantity }], paymentMethod: "TARJETA", branchId, idempotencyKey: key() })

describe.skipIf(!enabled)("PostgreSQL physical inventory counts", () => {
  beforeAll(async () => {
    biz = (await db.business.create({ data: { name: prefix, slug: prefix } })).id
    admin = (await db.user.create({ data: { businessId: biz, name: prefix, role: "ADMIN", status: "APPROVED" } })).id
    category = (await db.category.create({ data: { businessId: biz, name: prefix, slug: prefix } })).id
    // "branch-principal" queda ligado al primer negocio que lo creó en la base
    // persistente; cada corrida crea sus propias sucursales.
    branchA = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-A` } })).id
    branchB = (await db.branch.create({ data: { businessId: biz, name: `${prefix}-B` } })).id
  })
  afterAll(async () => { await db.$disconnect() })

  it("flujo básico: folio correlativo, una sola OPEN por sucursal, idempotencia y aislamiento", async () => {
    const first = await createCount(db, admin, biz, { branchId: branchA, notes: "conteo de prueba", idempotencyKey: key() })
    expect(first.count.status).toBe("OPEN")
    // Primer conteo del negocio: la secuencia por tenant arranca en 1.
    expect(first.folio).toBe("CC-000001")

    // Misma sucursal ya tiene una OPEN → 409, aunque sea otro usuario o con llave nueva.
    await expect(createCount(db, admin, biz, { branchId: branchA, idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })

    // Idempotencia: misma llave + mismo payload devuelve el mismo conteo sin duplicar.
    const dupKey = key()
    const replay1 = await createCount(db, admin, biz, { branchId: branchB, idempotencyKey: dupKey })
    const replay2 = await createCount(db, admin, biz, { branchId: branchB, idempotencyKey: dupKey })
    expect(replay2.count.id).toBe(replay1.count.id)
    expect(replay2.operationId).toBe(replay1.operationId)
    expect(await db.inventoryCount.count({ where: { businessId: biz, branchId: branchB } })).toBe(1)

    // Cancelar no toca inventario y libera la sucursal para un nuevo conteo.
    const cancelled = await cancelCount(db, admin, biz, replay1.count.id, { idempotencyKey: key() })
    expect(cancelled.status).toBe("CANCELLED")
    const reopened = await createCount(db, admin, biz, { branchId: branchB, idempotencyKey: key() })
    expect(reopened.count.status).toBe("OPEN")

    // Aislamiento por negocio: el conteo no existe para otro tenant.
    const other = await db.business.create({ data: { name: `${prefix}-other`, slug: `${prefix}-other` } })
    expect(await getCount(db, other.id, first.count.id)).toBeNull()
    expect((await listCounts(db, other.id, {})).length).toBe(0)

    // listCounts filtra por status dentro del negocio.
    const opens = await listCounts(db, biz, { status: "OPEN" })
    expect(opens.map(c => c.id).sort()).toEqual([first.count.id, reopened.count.id].sort())
    expect(countFolio(1)).toBe("CC-000001")
    expect(countFolio(42)).toBe("CC-000042")

    // Limpieza para no bloquear branchA/branchB en las pruebas siguientes.
    await cancelCount(db, admin, biz, first.count.id, { idempotencyKey: key() })
    await cancelCount(db, admin, biz, reopened.count.id, { idempotencyKey: key() })
  })

  it("captura expectedQty del BranchStock vivo y rechaza edición fuera de OPEN", async () => {
    const p = await product(5)
    const empty = await product(0)
    const created = await createCount(db, admin, biz, { branchId: branchA, idempotencyKey: key() })
    await setCountItems(db, admin, biz, created.count.id, {
      items: [{ productId: p.id, countedQty: 5 }, { productId: empty.id, countedQty: 0 }],
      idempotencyKey: key(),
    })
    const stored = await getCount(db, biz, created.count.id)
    expect(stored!.items.find(i => i.productId === p.id)!.expectedQty).toBe(5)
    // Sin fila en la sucursal, el esperado es 0.
    expect(stored!.items.find(i => i.productId === empty.id)!.expectedQty).toBe(0)

    // Conteo exacto: no hay ajustes ni movimientos, solo se cierra la sesión.
    const applied = await applyCount(db, admin, biz, created.count.id, { idempotencyKey: key() })
    expect(applied.status).toBe("APPLIED")
    expect(applied.adjustments).toBe(0)
    expect(await db.inventoryMovement.count({ where: { businessId: biz, productId: { in: [p.id, empty.id] } } })).toBe(0)
    expect(await stockAt(p.id)).toBe(5)
    expect(await totalStock(p.id)).toBe(5)

    // Ni reaplicar ni editar un conteo ya aplicado.
    await expect(applyCount(db, admin, biz, created.count.id, { idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    await expect(setCountItems(db, admin, biz, created.count.id, { items: [{ productId: p.id, countedQty: 1 }], idempotencyKey: key() })).rejects.toMatchObject({ status: 409 })
    expect(await stockAt(p.id)).toBe(5)
  })

  it("conteo ciego oculta expectedQty al capturador y lo revela al aplicar", async () => {
    const p = await product(7)
    const blind = await createCount(db, admin, biz, { branchId: branchA, blind: true, idempotencyKey: key() })
    expect(blind.count.blind).toBe(true)
    await setCountItems(db, admin, biz, blind.count.id, { items: [{ productId: p.id, countedQty: 9 }], idempotencyKey: key() })

    // La BD conserva el esperado real; solo la versión de cliente lo enmascara.
    const stored = await getCount(db, biz, blind.count.id)
    expect(stored!.items[0].expectedQty).toBe(7)
    const masked = countForClient(stored!)
    expect(masked.items[0].expectedQty).toBeNull()
    expect(masked.items[0].countedQty).toBe(9)

    const applied = await applyCount(db, admin, biz, blind.count.id, { idempotencyKey: key() })
    expect(applied.status).toBe("APPLIED")
    const revealed = countForClient((await getCount(db, biz, blind.count.id))!)
    expect(revealed.items[0].expectedQty).toBe(7)
    expect(revealed.items[0].countedQty).toBe(9)
    // Sobrante de +2: el stock de la sucursal y el total quedan en lo contado.
    expect(await stockAt(p.id)).toBe(9)
    expect(await totalStock(p.id)).toBe(9)
  })

  it("una venta capturada antes de aplicar se conserva: contar 10 con stock 10 y vender 1 deja 9, no 10", async () => {
    const p = await product(10)
    const created = await captureCount([{ productId: p.id, countedQty: 10 }])

    // Drift legítimo entre captura y aplicación: se vende una pieza por tarjeta
    // (sin caja de por medio). BranchStock 10→9 y Product.stock 10→9.
    await sellUnits(p.id, 1)
    expect(await stockAt(p.id)).toBe(9)
    expect(await totalStock(p.id)).toBe(9)

    const applied = await applyCount(db, admin, biz, created.count.id, { idempotencyKey: key() })
    expect(applied.status).toBe("APPLIED")
    // El conteo cuadraba al capturar (10 físicas vs 10 del sistema): no hay
    // merma que ajustar y la venta se conserva — el ajuste no resucita la pieza.
    expect(applied.adjustments).toBe(0)
    expect(await stockAt(p.id)).toBe(9)
    expect(await totalStock(p.id)).toBe(9)
    expect(await db.inventoryMovement.count({ where: { businessId: biz, productId: p.id, type: "ADJUSTMENT" } })).toBe(0)
    // El registro del conteo conserva la foto real de la captura: esperado 10,
    // contado 10 — diferencia cero, sin reescribir la historia.
    const record = (await getCount(db, biz, created.count.id))!.items.find(i => i.productId === p.id)!
    expect(record.expectedQty).toBe(10)
    expect(record.countedQty).toBe(10)
  })

  it("merma real: cuentan 9 contra 10 esperado sin ventas — queda 9 con ajuste auditado de −1", async () => {
    const p = await product(10)
    const created = await captureCount([{ productId: p.id, countedQty: 9 }])
    const applied = await applyCount(db, admin, biz, created.count.id, { idempotencyKey: key() })
    expect(applied.status).toBe("APPLIED")
    expect(applied.adjustments).toBe(1)

    expect(await stockAt(p.id)).toBe(9)
    expect(await totalStock(p.id)).toBe(9)

    const movements = await db.inventoryMovement.findMany({ where: { businessId: biz, productId: p.id, type: "ADJUSTMENT" } })
    expect(movements).toHaveLength(1)
    const movement = movements[0]
    expect(movement.quantity).toBe(1) // magnitud; la dirección va en previousStock → newStock
    expect(movement.previousStock).toBe(10)
    expect(movement.newStock).toBe(9)
    expect(movement.reason).toBe(`Conteo físico ${applied.folio}`)
    expect(movement.branchId).toBe(branchA)
    expect(movement.userId).toBe(admin)
  })

  it("merma con venta durante la captura: el ajuste real (−2) se aplica al stock vivo, no al contado absoluto", async () => {
    // Sistema dice 5, físico hay 3 (merma real de 2). Antes de aplicar se
    // vende 1: la verdad física es 3 − 1 = 2 y el sistema vivo dice 4.
    const p = await product(5)
    const created = await captureCount([{ productId: p.id, countedQty: 3 }])
    await sellUnits(p.id, 1)
    expect(await stockAt(p.id)).toBe(4)

    const applied = await applyCount(db, admin, biz, created.count.id, { idempotencyKey: key() })
    expect(applied.status).toBe("APPLIED")
    expect(applied.adjustments).toBe(1)
    // Ajuste = countedQty − expectedQtyCaptura = 3 − 5 = −2 sobre el stock vivo
    // (4): queda 2. Aplicar el contado absoluto (3) resucitaría la pieza vendida.
    expect(await stockAt(p.id)).toBe(2)
    expect(await totalStock(p.id)).toBe(2)

    const movement = await db.inventoryMovement.findFirstOrThrow({ where: { businessId: biz, productId: p.id, type: "ADJUSTMENT" } })
    expect(movement.quantity).toBe(2)
    expect(movement.previousStock).toBe(4)
    expect(movement.newStock).toBe(2)
  })
})
