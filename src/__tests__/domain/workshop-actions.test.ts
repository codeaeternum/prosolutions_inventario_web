import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { updateRepair } from "@/lib/domain/workshop"
import { repairNextStages } from "@/lib/workshop-labels"

/**
 * Reglas críticas del dominio de órdenes de reparación. El dominio corre de
 * verdad sobre un tx falso: db.$transaction entrega el tx mock y los asserts
 * verifican tanto el rechazo como los efectos (stock, caja, pagos).
 */

const tx = {
  user: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairOrder: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  repairEvent: { create: vi.fn() },
  repairPart: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
  payment: { aggregate: vi.fn(), create: vi.fn(), update: vi.fn() },
  cashRegister: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  cashMovement: { create: vi.fn(), groupBy: vi.fn() },
  inventoryMovement: { findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
  branchStock: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  product: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  branch: { findFirst: vi.fn() },
}
const db = { $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: "biz" }
const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: "biz", number: 7, version: 3, status: "READY",
  customerId: "cust-1", customerPhone: "8112345678", customerPhoneAlt: null,
  quoteCents: null, approvedQuoteCents: 50000, diagnosticFeeCents: null,
  closedWithoutRepair: false, currentBranchId: "b1", ...over,
})
let op = 0
const payload = (over: Record<string, unknown>) => ({ idempotencyKey: `test-op-${++op}`, expectedVersion: 3, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(admin)
  tx.user.findMany.mockResolvedValue([])
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.repairOrder.findUniqueOrThrow.mockResolvedValue(order())
  tx.repairOrder.updateMany.mockResolvedValue({ count: 1 })
  tx.repairPart.findMany.mockResolvedValue([])
  tx.repairPart.updateMany.mockResolvedValue({ count: 0 })
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
  tx.cashMovement.groupBy.mockResolvedValue([])
})

describe("la entrega solo ocurre por SETTLE_DELIVER", () => {
  it.each(["READY", "NOT_REPAIRED", "NOT_AUTHORIZED"] as const)("STATUS→DELIVERED se rechaza desde %s", async status => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "DELIVERED", detail: "Entrega directa" })))
      .rejects.toMatchObject({ status: 409, message: "El cambio de estado no corresponde a la etapa actual." })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("ninguna etapa declara DELIVERED como destino de STATUS", () => {
    expect(Object.values(repairNextStages).flat()).not.toContain("DELIVERED")
  })

  it("SETTLE_DELIVER desde NOT_AUTHORIZED marca closedWithoutRepair y cobra solo el diagnóstico", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "NOT_AUTHORIZED", quoteCents: 90000, approvedQuoteCents: null, diagnosticFeeCents: 15000 }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", detail: "Recoge el cliente", paymentMethod: "TRANSFER" }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", closedWithoutRepair: true }),
    }))
    // Solo el cargo de diagnóstico: $150, no la cotización de $900.
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purpose: "SETTLEMENT", method: "TRANSFER", amount: 150 }),
    }))
  })

  it("SETTLE_DELIVER con excedente lo documenta como pendiente de devolver", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "NOT_REPAIRED", diagnosticFeeCents: 20000 }))
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 500 } }) // anticipo de $500
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", detail: "Recoge el cliente" }))
    // SETTLE_DELIVER crea dos eventos: el PAYMENT privado (montos + excedente
    // documentado) y un STATUS público "→ Entregado" para el seguimiento.
    const paymentEvent = tx.repairEvent.create.mock.calls
      .map(call => call[0] as { data: { type: string; detail: string; isPublic: boolean } })
      .find(call => call.data.type === "PAYMENT")
    expect(paymentEvent?.data.detail).toContain("Excedente pendiente de devolver al cliente: 300.00 MXN")
    const publicEvent = tx.repairEvent.create.mock.calls
      .map(call => call[0] as { data: { type: string; detail: string; isPublic: boolean } })
      .find(call => call.data.isPublic)
    expect(publicEvent?.data.detail).toContain("→ Entregado")
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", closedWithoutRepair: true }),
    }))
  })
})

describe("cierre sin reparación persistente", () => {
  it("REFUND tras entrega sin reparación devuelve el excedente sobre el diagnóstico", async () => {
    // Cotización de $900 autorizada, anticipo de $500, cargo final $200:
    // sin closedWithoutRepair el total "reviviría" los $900 y no habría excedente.
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED", closedWithoutRepair: true, quoteCents: 90000, approvedQuoteCents: 90000, diagnosticFeeCents: 20000 }))
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 500 } })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "REFUND", paymentCents: 30000, paymentMethod: "TRANSFER", detail: "Devolución de excedente" }))
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purpose: "REFUND", status: "REFUNDED", amount: -300 }),
    }))
  })

  it("REFUND no puede exceder lo cobrado de más", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED", closedWithoutRepair: true, diagnosticFeeCents: 20000 }))
    tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 500 } })
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "REFUND", paymentCents: 30001, paymentMethod: "TRANSFER", detail: "De más" })))
      .rejects.toMatchObject({ status: 409, message: "La devolución excede lo cobrado de más (300.00 MXN)." })
    expect(tx.payment.create).not.toHaveBeenCalled()
  })
})

describe("reposición de stock al cerrar", () => {
  it.each(["CANCELLED", "NOT_REPAIRED"] as const)("STATUS→%s repone las refacciones APPROVED y rechaza las pendientes", async status => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    tx.repairPart.findMany.mockResolvedValue([
      { id: "pt1", productId: "p1", description: "Pantalla", qty: 2, unitCostCents: 5000, unitPriceCents: 10000, status: "APPROVED" },
      { id: "pt2", productId: null, description: "Mica", qty: 1, unitCostCents: 0, unitPriceCents: 5000, status: "REQUESTED" },
    ])
    // La pantalla salió del stock con un OUT previo de 2 piezas en b1.
    tx.inventoryMovement.findMany.mockResolvedValue([{ quantity: 2, branchId: "b1" }])
    tx.inventoryMovement.aggregate.mockResolvedValue({ _sum: { quantity: null } })
    tx.product.update.mockResolvedValue({ id: "p1", stock: 7 })
    tx.repairPart.updateMany.mockResolvedValue({ count: 2 })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status, detail: "Cierre de la orden" }))
    expect(tx.branchStock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ productId: "p1", branchId: "b1", quantity: 2 }),
      update: { quantity: { increment: 2 } },
    }))
    expect(tx.product.update).toHaveBeenCalledWith(expect.objectContaining({ data: { stock: { increment: 2 } } }))
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "RETURN", quantity: 2, productId: "p1", branchId: "b1" }),
    }))
    expect(tx.repairPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: "o1", status: { in: ["APPROVED", "REQUESTED"] } },
      data: expect.objectContaining({ status: "REJECTED" }),
    }))
  })
})

describe("permisos y caja", () => {
  it("REFUND exige rol ADMIN: un empleado recibe 403", async () => {
    tx.user.findUnique.mockResolvedValue({ ...admin, id: "emp-1", role: "EMPLOYEE" })
    await expect(updateRepair(db, "emp-1", "biz", "o1", payload({ action: "REFUND", paymentCents: 100, paymentMethod: "TRANSFER", detail: "Devolución" })))
      .rejects.toMatchObject({ status: 403, message: "Se requiere administrador." })
    expect(tx.repairOrder.findUnique).not.toHaveBeenCalled()
  })

  it("PAYMENT en efectivo sin caja abierta falla antes de registrar el cobro", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    tx.cashRegister.findMany.mockResolvedValue([])
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PAYMENT", paymentCents: 10000, paymentMethod: "CASH" })))
      .rejects.toMatchObject({ status: 409, code: "REGISTER_REQUIRED", message: "Abre la caja antes de cobrar en efectivo." })
    expect(tx.payment.create).not.toHaveBeenCalled()
  })

  it("PAYMENT en efectivo con caja abierta genera su asiento IN", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-1", status: "OPEN" }])
    tx.payment.create.mockResolvedValue({ id: "pay-1" })
    tx.cashMovement.create.mockResolvedValue({ id: "cm-1" })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PAYMENT", paymentCents: 10000, paymentMethod: "CASH" }))
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "IN", amount: 100, registerId: "reg-1", referenceType: "REPAIR_PAYMENT" }),
    }))
  })

  it("PAYMENT por transferencia no exige caja", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PAYMENT", paymentCents: 10000, paymentMethod: "TRANSFER" }))
    expect(tx.cashRegister.findMany).not.toHaveBeenCalled()
    expect(tx.payment.create).toHaveBeenCalled()
  })
})

describe("refacciones en estados terminales", () => {
  it.each(["NOT_AUTHORIZED", "NOT_REPAIRED", "CANCELLED", "DELIVERED"] as const)("PART_REQUEST se rechaza en %s", async status => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_REQUEST", partDescription: "Pantalla", partQty: 1 })))
      .rejects.toMatchObject({ status: 409 })
    expect(tx.repairPart.create).not.toHaveBeenCalled()
  })

  it("PART_DECIDE se rechaza en NOT_REPAIRED aunque el actor sea admin", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "NOT_REPAIRED" }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_DECIDE", partId: "pt1", approve: true })))
      .rejects.toMatchObject({ status: 409, message: "La orden está cerrada; las refacciones ya no se pueden agregar ni resolver." })
    expect(tx.repairPart.updateMany).not.toHaveBeenCalled()
  })
})
