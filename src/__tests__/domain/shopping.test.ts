import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { addShoppingItem, createPurchaseFromNeeds, listShoppingNeeds, resolveShoppingItem } from "@/lib/domain/shopping"

/**
 * Lista de encargos: agregación de refacciones por órdenes abiertas, umbral de
 * stock bajo, alta/resolución de insumos manuales y la OC atómica que los liga.
 * El dominio corre sobre un tx falso (db.$transaction entrega el mock).
 */
const BIZ = "biz"
const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ }
const branch = { id: "b1", name: "Matriz", isActive: true, businessId: BIZ }
let seq = 0
const key = () => `encargos-test-${++seq}`
// Mismo hash que operation(): sha256 del payload tal como lo arma el dominio.
const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex")

const tx = {
  user: { findUnique: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairPart: { findMany: vi.fn() },
  branchStock: { findMany: vi.fn() },
  product: { findMany: vi.fn(), findFirst: vi.fn() },
  shoppingItem: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  branch: { findFirst: vi.fn() },
  supplier: { findFirst: vi.fn() },
  purchase: { create: vi.fn(), aggregate: vi.fn() },
}
// listShoppingNeeds lee directo de db; las operaciones entran por $transaction.
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(admin)
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.repairPart.findMany.mockResolvedValue([])
  tx.branchStock.findMany.mockResolvedValue([])
  tx.product.findMany.mockResolvedValue([])
  tx.shoppingItem.findMany.mockResolvedValue([])
  tx.branch.findFirst.mockResolvedValue(branch)
  // El folio es por tenant: MAX(number)=2 → la OC se crea con number 3.
  tx.purchase.aggregate.mockResolvedValue({ _max: { number: 2 } })
})

describe("refacciones faltantes", () => {
  const part = (over: Record<string, unknown> = {}) => ({
    productId: "p1", qty: 1, orderId: "o1",
    order: { number: 7 },
    product: { id: "p1", name: "Pantalla iPhone 11", stock: 4, costPrice: 350 },
    ...over,
  })

  it("suma la demanda por producto y calcula el faltante contra el stock total", async () => {
    tx.repairPart.findMany.mockResolvedValue([
      part({ qty: 2, orderId: "o1", order: { number: 7 } }),
      part({ qty: 3, orderId: "o2", order: { number: 9 } }),
      // p2 tiene existencias suficientes: no entra a la lista.
      part({ productId: "p2", qty: 1, orderId: "o3", order: { number: 10 }, product: { id: "p2", name: "Mica", stock: 10, costPrice: 20 } }),
    ])
    const { partsShortage } = await listShoppingNeeds(db, BIZ)
    expect(partsShortage).toHaveLength(1)
    expect(partsShortage[0]).toMatchObject({ productId: "p1", needed: 5, available: 4, shortage: 1 })
    expect(partsShortage[0].orders).toEqual([
      { orderId: "o1", number: 7, qty: 2, folio: "OT-000007" },
      { orderId: "o2", number: 9, qty: 3, folio: "OT-000009" },
    ])
  })

  it("incluye el faltante aunque haya stock parcial", async () => {
    tx.repairPart.findMany.mockResolvedValue([part({ qty: 6 })]) // needed 6, stock 4 → falta 2
    const { partsShortage } = await listShoppingNeeds(db, BIZ)
    expect(partsShortage[0]).toMatchObject({ needed: 6, available: 4, shortage: 2 })
  })

  it("solo cuenta piezas REQUESTED/APPROVED con producto en órdenes no terminales", async () => {
    await listShoppingNeeds(db, BIZ)
    expect(tx.repairPart.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        businessId: BIZ,
        productId: { not: null },
        status: { in: ["REQUESTED", "APPROVED"] },
        order: { status: { notIn: ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"] } },
      }),
    }))
  })

  it("con branchId compara contra el stock de esa sucursal, no el total", async () => {
    tx.repairPart.findMany.mockResolvedValue([part({ qty: 5 })])
    tx.branchStock.findMany.mockResolvedValue([{ productId: "p1", quantity: 1 }])
    const { partsShortage } = await listShoppingNeeds(db, BIZ, "b1")
    expect(partsShortage[0]).toMatchObject({ available: 1, shortage: 4 })
    expect(tx.branchStock.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: BIZ, branchId: { in: ["b1"] }, productId: { in: ["p1"] } }),
    }))
  })
})

describe("stock bajo", () => {
  it("incluye productos en su mínimo o debajo y sugiere reabasto al doble del mínimo", async () => {
    tx.product.findMany.mockResolvedValue([
      { id: "p1", name: "Batería", stock: 2, minStock: 5, costPrice: 200 },        // sugerido: 10-2 = 8
      { id: "p2", name: "Centro de carga", stock: 5, minStock: 5, costPrice: 90 }, // en el mínimo: 10-5 = 5
      { id: "p3", name: "Flex", stock: 10, minStock: 1, costPrice: 15 },           // excluido
      { id: "p4", name: "Tapa", stock: 0, minStock: 0, costPrice: 10 },            // mínimo 0: sugiere 1
    ])
    const { lowStock } = await listShoppingNeeds(db, BIZ)
    expect(tx.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: BIZ, isActive: true },
    }))
    expect(lowStock.map(row => row.productId).sort()).toEqual(["p1", "p2", "p4"])
    const byId = Object.fromEntries(lowStock.map(row => [row.productId, row]))
    expect(byId.p1.suggested).toBe(8)
    expect(byId.p2.suggested).toBe(5)
    expect(byId.p4.suggested).toBe(1)
  })
})

describe("alta manual de insumos", () => {
  it("crea el encargo con defaults y el actor como capturista", async () => {
    tx.shoppingItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "si-1", ...args.data }))
    const result = await addShoppingItem(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Alcohol isopropílico" })
    expect(tx.shoppingItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: BIZ, description: "Alcohol isopropílico",
        quantity: 1, unitCostCents: 0, productId: null, createdById: "admin-1",
      }),
    }))
    expect(result.item.id).toBe("si-1")
  })

  it("con productId valida que exista en el negocio y copia su nombre si falta la descripción", async () => {
    tx.product.findFirst.mockResolvedValue({ id: "p1", name: "Pantalla A32", businessId: BIZ })
    tx.shoppingItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "si-2", ...args.data }))
    await addShoppingItem(db, "admin-1", BIZ, { idempotencyKey: key(), productId: "p1", quantity: 2 })
    expect(tx.shoppingItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: "p1", description: "Pantalla A32", quantity: 2 }),
    }))
  })

  it("rechaza un producto inexistente o de otro negocio", async () => {
    tx.product.findFirst.mockResolvedValue(null)
    await expect(addShoppingItem(db, "admin-1", BIZ, { idempotencyKey: key(), productId: "px", description: "Algo" }))
      .rejects.toMatchObject({ status: 404 })
    expect(tx.shoppingItem.create).not.toHaveBeenCalled()
  })

  it("sin descripción ni producto no hay cómo nombrar el encargo", async () => {
    await expect(addShoppingItem(db, "admin-1", BIZ, { idempotencyKey: key() }))
      .rejects.toMatchObject({ status: 400 })
    expect(tx.shoppingItem.create).not.toHaveBeenCalled()
  })
})

describe("resolución de encargos", () => {
  const pending = { id: "si-1", businessId: BIZ, status: "PENDING" }

  it("marca PURCHASED con quién y cuándo lo resolvió", async () => {
    tx.shoppingItem.findFirst.mockResolvedValue(pending)
    tx.shoppingItem.updateMany.mockResolvedValue({ count: 1 })
    const result = await resolveShoppingItem(db, "admin-1", BIZ, "si-1", { idempotencyKey: key(), action: "PURCHASED" })
    expect(tx.shoppingItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "si-1", status: "PENDING" },
      data: expect.objectContaining({ status: "PURCHASED", resolvedById: "admin-1", resolvedAt: expect.any(Date) }),
    }))
    expect(result.status).toBe("PURCHASED")
  })

  it("un segundo intento con otra llave se rechaza: el encargo ya fue resuelto", async () => {
    tx.shoppingItem.findFirst.mockResolvedValue({ ...pending, status: "PURCHASED" })
    await expect(resolveShoppingItem(db, "admin-1", BIZ, "si-1", { idempotencyKey: key(), action: "CANCELLED" }))
      .rejects.toMatchObject({ status: 409, message: "El encargo ya fue resuelto." })
    expect(tx.shoppingItem.updateMany).not.toHaveBeenCalled()
  })

  it("reintentar con la MISMA llave devuelve la respuesta guardada sin tocar la base", async () => {
    const opKey = key()
    const stored = { itemId: "si-1", status: "PURCHASED", operationId: "op-1" }
    tx.businessOperation.findUnique.mockResolvedValue({
      key: opKey, actorId: "admin-1", kind: "SHOPPING_ITEM_RESOLVE", businessId: BIZ,
      requestHash: hash({ id: "si-1", idempotencyKey: opKey, action: "PURCHASED" }),
      response: stored,
    })
    const result = await resolveShoppingItem(db, "admin-1", BIZ, "si-1", { idempotencyKey: opKey, action: "PURCHASED" })
    expect(result).toEqual(stored)
    expect(tx.shoppingItem.findFirst).not.toHaveBeenCalled()
    expect(tx.shoppingItem.updateMany).not.toHaveBeenCalled()
  })
})

describe("orden de compra desde la lista", () => {
  const purchase = { id: "pu-1", number: 3, businessId: BIZ, branchId: "b1" }

  it("crea la OC y liga los insumos manuales como PURCHASED en la misma transacción", async () => {
    tx.product.findFirst.mockResolvedValue({ id: "p1", businessId: BIZ, isActive: true })
    tx.shoppingItem.findMany.mockResolvedValue([
      { id: "si-1", businessId: BIZ, status: "PENDING" },
      { id: "si-2", businessId: BIZ, status: "PENDING" },
    ])
    tx.purchase.create.mockResolvedValue(purchase)
    tx.shoppingItem.updateMany.mockResolvedValue({ count: 2 })
    const result = await createPurchaseFromNeeds(db, "admin-1", BIZ, {
      idempotencyKey: key(), branchId: "b1",
      items: [{ productId: "p1", quantity: 4, unitCostCents: 15000 }],
      manualItemIds: ["si-1", "si-2"],
    })
    expect(result.folio).toBe("OC-000003")
    expect(result.linkedManualItems).toBe(2)
    expect(tx.purchase.aggregate).toHaveBeenCalledWith({ where: { businessId: BIZ }, _max: { number: true } })
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: BIZ, number: 3, branchId: "b1", totalCents: 60000, createdById: "admin-1",
        items: { create: [{ businessId: BIZ, productId: "p1", quantity: 4, unitCostCents: 15000 }] },
      }),
    }))
    expect(tx.shoppingItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["si-1", "si-2"] }, status: "PENDING" },
      data: expect.objectContaining({ status: "PURCHASED", purchaseId: "pu-1", resolvedById: "admin-1", resolvedAt: expect.any(Date) }),
    }))
  })

  it("si un insumo ya no está pendiente, la OC entera se aborta", async () => {
    tx.product.findFirst.mockResolvedValue({ id: "p1", businessId: BIZ, isActive: true })
    tx.shoppingItem.findMany.mockResolvedValue([{ id: "si-1", businessId: BIZ, status: "PURCHASED" }])
    await expect(createPurchaseFromNeeds(db, "admin-1", BIZ, {
      idempotencyKey: key(), branchId: "b1",
      items: [{ productId: "p1", quantity: 1, unitCostCents: 0 }],
      manualItemIds: ["si-1"],
    })).rejects.toMatchObject({ status: 409 })
    expect(tx.purchase.create).not.toHaveBeenCalled()
  })

  it("un insumo de otro negocio no entra a la OC", async () => {
    tx.product.findFirst.mockResolvedValue({ id: "p1", businessId: BIZ, isActive: true })
    // El where filtra por businessId: el encargo ajeno no regresa y falta uno.
    tx.shoppingItem.findMany.mockResolvedValue([])
    await expect(createPurchaseFromNeeds(db, "admin-1", BIZ, {
      idempotencyKey: key(), branchId: "b1",
      items: [{ productId: "p1", quantity: 1, unitCostCents: 0 }],
      manualItemIds: ["si-ajeno"],
    })).rejects.toMatchObject({ status: 404 })
    expect(tx.purchase.create).not.toHaveBeenCalled()
  })

  it("el mismo producto tildado en dos secciones queda en una sola línea", async () => {
    tx.product.findFirst.mockResolvedValue({ id: "p1", businessId: BIZ, isActive: true })
    tx.purchase.create.mockResolvedValue(purchase)
    await createPurchaseFromNeeds(db, "admin-1", BIZ, {
      idempotencyKey: key(), branchId: "b1",
      items: [
        { productId: "p1", quantity: 2, unitCostCents: 1000 },
        { productId: "p1", quantity: 5, unitCostCents: 1000 },
      ],
    })
    expect(tx.purchase.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        totalCents: 5000,
        items: { create: [{ businessId: BIZ, productId: "p1", quantity: 5, unitCostCents: 1000 }] },
      }),
    }))
  })
})
