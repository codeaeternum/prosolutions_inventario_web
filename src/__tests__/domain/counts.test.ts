import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
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
  inventoryCount: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  branch: { findFirst: vi.fn() },
  inventoryCountItem: { update: vi.fn() },
  branchStock: { findUnique: vi.fn(), upsert: vi.fn() },
  product: { update: vi.fn(), findMany: vi.fn() },
  inventoryMovement: { create: vi.fn() },
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

/** Conteo OPEN con un producto capturado 3 vs 5 en sistema (ajuste −2). */
const openCount = (createdById: string) => ({
  id: "count-1",
  businessId: BIZ,
  number: 7,
  branchId: "b1",
  status: "OPEN",
  blind: false,
  createdById,
  items: [{ id: "ci-1", productId: "p1", expectedQty: 5, countedQty: 3 }],
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
  it("asigna MAX(number) del tenant + 1, no el autoincrement global", async () => {
    tx.inventoryCount.findFirst.mockResolvedValue(null) // sin conteo abierto
    tx.inventoryCount.aggregate.mockResolvedValue({ _max: { number: 4 } })
    tx.inventoryCount.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "count-9", ...data }))
    const result = await createCount(db, admin.id, BIZ, { idempotencyKey: key(), branchId: "b1" })
    expect(tx.inventoryCount.aggregate).toHaveBeenCalledWith({ where: { businessId: BIZ }, _max: { number: true } })
    expect(tx.inventoryCount.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: BIZ, number: 5 }),
    }))
    expect(result.folio).toBe("CC-000005")
  })

  it("el primer conteo de un negocio arranca en 1 aunque existan folios globales", async () => {
    tx.inventoryCount.findFirst.mockResolvedValue(null)
    tx.inventoryCount.aggregate.mockResolvedValue({ _max: { number: null } })
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
