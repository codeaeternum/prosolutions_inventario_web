import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { createReservations } from "@/lib/domain/reservations"

/**
 * Lista de precio de la reserva web: la misma regla que el POS y los
 * documentos — STORE y TECHNICIAN pagan wholesalePrice, NORMAL paga retail.
 * Antes el técnico reservaba en línea a precio retail y compraba en
 * mostrador a mayoreo.
 *
 * El dominio corre sobre un tx falso (db.$transaction entrega el mock).
 */
const BIZ = "biz"
const customer = (customerType: string) => ({
  id: "u-cust", name: "Cliente", role: "CUSTOMER", status: "APPROVED",
  businessId: BIZ, customerType, creditBalance: 0, creditLimit: null,
})
const product = { id: "p1", name: "Flex A32", isActive: true, stock: 10, wholesalePrice: 150, retailPrice: 200, businessId: BIZ }
const branch = { id: "b1", name: "Matriz", isActive: true, businessId: BIZ }
let seq = 0
const key = () => `reservation-test-${++seq}`

const tx = {
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  settings: { findFirst: vi.fn() },
  product: { findFirst: vi.fn(), updateMany: vi.fn() },
  branch: { findFirst: vi.fn() },
  branchStock: { updateMany: vi.fn() },
  reservation: { create: vi.fn() },
  inventoryMovement: { create: vi.fn() },
}
// La alerta de stock bajo corre post-commit sobre `db`; con findMany: [] no
// hay nada que revisar.
const db = { ...tx, product: { ...tx.product, findMany: vi.fn().mockResolvedValue([]) }, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

beforeEach(() => {
  vi.clearAllMocks()
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.settings.findFirst.mockResolvedValue(null)
  tx.product.findFirst.mockResolvedValue(product)
  tx.branch.findFirst.mockResolvedValue(branch)
  tx.branchStock.updateMany.mockResolvedValue({ count: 1 })
  tx.product.updateMany.mockResolvedValue({ count: 1 })
  tx.reservation.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "r1", ...args.data }))
  tx.inventoryMovement.create.mockResolvedValue({})
})

describe("lista de precio por tipo de cliente", () => {
  it("TECHNICIAN reserva a precio de mayoreo como en el POS", async () => {
    tx.user.findUnique.mockResolvedValue(customer("TECHNICIAN"))
    const result = await createReservations(db, "u-cust", BIZ, { idempotencyKey: key(), productId: "p1", quantity: 2 })
    expect(tx.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalPrice: 300 }), // 150 × 2
    }))
    expect(result.total).toBe(300)
  })

  it("STORE sigue pagando mayoreo", async () => {
    tx.user.findUnique.mockResolvedValue(customer("STORE"))
    const result = await createReservations(db, "u-cust", BIZ, { idempotencyKey: key(), productId: "p1", quantity: 2 })
    expect(result.total).toBe(300)
  })

  it("NORMAL paga el precio de lista", async () => {
    tx.user.findUnique.mockResolvedValue(customer("NORMAL"))
    const result = await createReservations(db, "u-cust", BIZ, { idempotencyKey: key(), productId: "p1", quantity: 2 })
    expect(tx.reservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalPrice: 400 }), // 200 × 2
    }))
    expect(result.total).toBe(400)
  })
})
