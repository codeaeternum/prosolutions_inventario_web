import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@/generated/prisma/client"
import { applyCount, createCount } from "@/lib/domain/counts"

/**
 * applyCount — separación de funciones (auditoría): un EMPLOYEE no puede
 * aplicar el conteo que él mismo creó (ajustaría stock sin revisión de un
 * segundo usuario); un ADMIN sí, porque los negocios chicos operan con un
 * solo administrador. El recibo BusinessOperation.response debe nombrar a
 * ambos actores (createdById vs appliedById) para trazabilidad.
 *
 * El dominio corre sobre un tx falso: db.$transaction entrega el mock, igual
 * que en shopping.test.ts / cash-close.test.ts.
 */
const BIZ = "biz"
const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ }
const employee = { id: "emp-1", name: "Empleado", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ }
let seq = 0
const key = () => `counts-test-${++seq}`

const tx = {
  user: { findUnique: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  inventoryCount: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  branch: { findFirst: vi.fn() },
  inventoryCountItem: { update: vi.fn() },
  branchStock: { findUnique: vi.fn(), upsert: vi.fn() },
  product: { update: vi.fn(), findMany: vi.fn() },
  inventoryMovement: { create: vi.fn() },
  // nextCountNumber() reserva el folio con un UPSERT atómico sobre
  // BusinessCounter ($queryRaw → RETURNING nextCountNumber - 1).
  $queryRaw: vi.fn(),
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

/** Conteo OPEN con un producto capturado 3 vs 5 en sistema al capturar (ajuste −2). */
const openCount = (createdById: string) => ({
  id: "count-1",
  businessId: BIZ,
  number: 7,
  branchId: "b1",
  status: "OPEN",
  blind: false,
  createdById,
  items: [{ id: "ci-1", productId: "p1", expectedQty: 5, countedQty: 3, product: { name: "Batería" } }],
  branch: { id: "b1", name: "Matriz" },
})

beforeEach(() => {
  vi.clearAllMocks()
  // actor() de operation() valida al usuario y el guard de applyCount relee su rol.
  tx.user.findUnique.mockResolvedValue(admin)
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.inventoryCount.findFirst.mockResolvedValue(openCount(admin.id))
  tx.inventoryCount.updateMany.mockResolvedValue({ count: 1 })
  tx.branchStock.findUnique.mockResolvedValue({ quantity: 5 })
  tx.branchStock.upsert.mockResolvedValue({})
  tx.product.update.mockResolvedValue({ stock: 8 })
  tx.product.findMany.mockResolvedValue([]) // syncLowStockAlerts post-commit
  tx.inventoryMovement.create.mockResolvedValue({ id: "mov-1" })
  // Solo para createCount: sucursal válida y sin otro conteo OPEN.
  tx.branch.findFirst.mockResolvedValue({ id: "b1", name: "Matriz", isActive: true, businessId: BIZ })
})

describe("createCount — folio por negocio", () => {
  it("reserva el folio desde BusinessCounter (upsert atómico), no el autoincrement global", async () => {
    tx.inventoryCount.findFirst.mockResolvedValue(null) // sin conteo abierto
    tx.$queryRaw.mockResolvedValue([{ n: 5 }]) // BusinessCounter.nextCountNumber reservado
    tx.inventoryCount.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "count-9", ...data }))
    const result = await createCount(db, admin.id, BIZ, { idempotencyKey: key(), branchId: "b1" })
    expect(tx.$queryRaw).toHaveBeenCalled()
    expect(tx.inventoryCount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: BIZ, number: 5 }),
    }))
    expect(result.folio).toBe("CC-000005")
  })

  it("el primer conteo de un negocio arranca en 1 aunque existan folios globales", async () => {
    tx.inventoryCount.findFirst.mockResolvedValue(null)
    tx.$queryRaw.mockResolvedValue([{ n: 1 }])
    tx.inventoryCount.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "count-1", ...data }))
    const result = await createCount(db, admin.id, BIZ, { idempotencyKey: key(), branchId: "b1" })
    expect(tx.inventoryCount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ number: 1 }),
    }))
    expect(result.folio).toBe("CC-000001")
  })
})

const apply = (actorId: string) =>
  applyCount(db, actorId, BIZ, "count-1", { idempotencyKey: key() })

describe("applyCount — separación de funciones", () => {
  it("un EMPLOYEE no puede aplicar el conteo que él mismo creó (403, sin tocar stock)", async () => {
    tx.user.findUnique.mockResolvedValue(employee)
    tx.inventoryCount.findFirst.mockResolvedValue(openCount(employee.id))

    await expect(apply(employee.id)).rejects.toMatchObject({
      name: "BusinessError",
      status: 403,
      message: expect.stringContaining("Otro usuario debe aplicar el conteo"),
    })
    expect(tx.inventoryCount.updateMany).not.toHaveBeenCalled()
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
    expect(tx.branchStock.upsert).not.toHaveBeenCalled()
  })

  it("un EMPLOYEE sí puede aplicar el conteo creado por otro usuario", async () => {
    tx.user.findUnique.mockResolvedValue(employee)
    tx.inventoryCount.findFirst.mockResolvedValue(openCount(admin.id))

    const result = await apply(employee.id)
    expect(result).toMatchObject({
      status: "APPLIED",
      folio: "CC-000007",
      adjustments: 1,
      branchName: "Matriz",
      createdById: admin.id,
      appliedById: employee.id,
    })
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1)
  })

  it("un ADMIN puede aplicar su propio conteo (negocio de un solo administrador)", async () => {
    tx.user.findUnique.mockResolvedValue(admin)
    tx.inventoryCount.findFirst.mockResolvedValue(openCount(admin.id))

    const result = await apply(admin.id)
    expect(result).toMatchObject({ status: "APPLIED", createdById: admin.id, appliedById: admin.id })
  })

  it("el recibo de la operación registra quién creó y quién aplicó", async () => {
    tx.user.findUnique.mockResolvedValue(employee)
    tx.inventoryCount.findFirst.mockResolvedValue(openCount(admin.id))

    await apply(employee.id)
    const persisted = tx.businessOperation.update.mock.calls[0][0].data.response
    expect(persisted).toMatchObject({ createdById: admin.id, appliedById: employee.id, status: "APPLIED" })
  })
})

/**
 * Ajuste RELATIVO al stock vigente (auditoría D2): la varianza se fija al
 * capturar (countedQty − expectedQty de ese momento) y se aplica sobre la
 * existencia viva al aplicar. Fijar el contado como absoluto deshacía ventas
 * legítimas ocurridas durante la captura (contar 10 con stock 10, vender 1 y
 * aplicar "resucitaba" la pieza regresando a 10).
 */
describe("applyCount — varianza de captura aplicada al stock vigente", () => {
  const countWith = (item: { expectedQty: number; countedQty: number }) => ({
    ...openCount(admin.id),
    items: [{ id: "ci-1", productId: "p1", product: { name: "Batería" }, ...item }],
  })

  it("conteo cuadrado al capturar NO ajusta aunque el stock se mueva después: la venta intermedia se conserva", async () => {
    // Al capturar: sistema 10, físico 10 — sin merma. Antes de aplicar se
    // vende 1 (vigente 9). El ajuste correcto es NINGUNO; el bug fijaba 10.
    tx.inventoryCount.findFirst.mockResolvedValue(countWith({ expectedQty: 10, countedQty: 10 }))
    tx.branchStock.findUnique.mockResolvedValue({ quantity: 9 })

    const result = await apply(admin.id)
    expect(result.status).toBe("APPLIED")
    expect(result.adjustments).toBe(0)
    expect(tx.branchStock.upsert).not.toHaveBeenCalled()
    expect(tx.product.update).not.toHaveBeenCalled()
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
  })

  it("merma real con venta intermedia: el delta de captura (−2) se aplica sobre el vigente (9 → 7), no el contado absoluto", async () => {
    // Al capturar: sistema 10, físico 8 — merma real de 2. Antes de aplicar
    // se vende 1 (vigente 9): la verdad física es 8 − 1 = 7.
    tx.inventoryCount.findFirst.mockResolvedValue(countWith({ expectedQty: 10, countedQty: 8 }))
    tx.branchStock.findUnique.mockResolvedValue({ quantity: 9 })
    tx.product.update.mockResolvedValue({ stock: 7 })

    const result = await apply(admin.id)
    expect(result.adjustments).toBe(1)
    // Existencia final 7 (vigente − delta), no 8 (contado absoluto).
    expect(tx.branchStock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ quantity: 7 }),
      update: expect.objectContaining({ quantity: 7 }),
    }))
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { stock: { increment: -2 } } })
    const movement = tx.inventoryMovement.create.mock.calls[0][0].data
    expect(movement).toMatchObject({ type: "ADJUSTMENT", quantity: 2, previousStock: 9, newStock: 7 })
    expect(movement.notes).toContain("Contado 8 vs 10 en sistema al capturar (-2)")
    expect(movement.notes).toContain("existencia 9 → 7 al aplicar")
  })

  it("sobrante con recepción intermedia: el delta (+2) se suma al vigente", async () => {
    // Al capturar: sistema 5, físico 7 — sobrante de 2. Antes de aplicar
    // entran 3 por compra (vigente 8): queda 10.
    tx.inventoryCount.findFirst.mockResolvedValue(countWith({ expectedQty: 5, countedQty: 7 }))
    tx.branchStock.findUnique.mockResolvedValue({ quantity: 8 })
    tx.product.update.mockResolvedValue({ stock: 10 })

    const result = await apply(admin.id)
    expect(result.adjustments).toBe(1)
    expect(tx.branchStock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ quantity: 10 }),
    }))
    expect(tx.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { stock: { increment: 2 } } })
  })

  it("expectedQty NO se re-sincroniza al aplicar: queda como foto histórica de la captura", async () => {
    tx.inventoryCount.findFirst.mockResolvedValue(countWith({ expectedQty: 10, countedQty: 8 }))
    tx.branchStock.findUnique.mockResolvedValue({ quantity: 9 })
    tx.product.update.mockResolvedValue({ stock: 7 })

    await apply(admin.id)
    expect(tx.inventoryCountItem.update).not.toHaveBeenCalled()
  })

  it("409 cuando el faltante del conteo excede la existencia vigente (la captura contradice los movimientos posteriores)", async () => {
    // Al capturar: sistema 10, físico 2 — faltante de 8. Pero el vigente es 3:
    // aplicar −8 daría −5, físicamente imposible (y prohibido por el CHECK de
    // BD). La captura y las ventas se contradicen: se exige recapturar.
    tx.inventoryCount.findFirst.mockResolvedValue(countWith({ expectedQty: 10, countedQty: 2 }))
    tx.branchStock.findUnique.mockResolvedValue({ quantity: 3 })

    await expect(apply(admin.id)).rejects.toMatchObject({
      name: "BusinessError",
      status: 409,
      message: expect.stringContaining("Vuelve a capturar"),
    })
    expect(tx.branchStock.upsert).not.toHaveBeenCalled()
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
    // El conteo sigue OPEN (la tx revertiría todo de todos modos).
    expect(tx.inventoryCount.updateMany).not.toHaveBeenCalled()
  })

  it("el error del guard nombra el producto en conflicto", async () => {
    tx.inventoryCount.findFirst.mockResolvedValue(countWith({ expectedQty: 10, countedQty: 2 }))
    tx.branchStock.findUnique.mockResolvedValue({ quantity: 3 })

    await expect(apply(admin.id)).rejects.toMatchObject({
      message: expect.stringContaining("Batería"),
    })
  })
})
