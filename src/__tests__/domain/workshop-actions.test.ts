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
  systemSettings: { findUnique: vi.fn() },
}
const db = { $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: "biz" }
const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: "biz", number: 7, version: 3, status: "READY",
  customerId: "cust-1", customerPhone: "8112345678", customerPhoneAlt: null,
  quoteCents: null, approvedQuoteCents: 50000, diagnosticFeeCents: null,
  closedWithoutRepair: false, currentBranchId: "b1",
  warrantyUntil: null, warrantyCount: 0, ...over,
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
  // Sin warranty_days configurado: el dominio cae al default de 30 días.
  tx.systemSettings.findUnique.mockResolvedValue(null)
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
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Recoge el cliente", paymentMethod: "TRANSFER" }))
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
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Recoge el cliente" }))
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

describe("constancia de entrega estructurada", () => {
  it("SETTLE_DELIVER exige el nombre de quien recoge", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "READY" }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", paymentMethod: "TRANSFER" })))
      .rejects.toMatchObject({ status: 400, message: "Indica el nombre de quien recoge el equipo." })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("el nombre de quien recoge no acepta un solo carácter ni más de 80", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "READY", approvedQuoteCents: null }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "x" }))).rejects.toThrow()
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "n".repeat(81) }))).rejects.toThrow()
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("persiste receptor, identificación, firma y quién entregó; rota el token de evidencias", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "READY", approvedQuoteCents: null }))
    const signature = "data:image/png;base64,iVBORw0KGgo="
    await updateRepair(db, "admin-1", "biz", "o1", payload({
      action: "SETTLE_DELIVER", deliveredTo: "María Pérez", deliveredToDoc: "INE-ABC123",
      deliverySignatureData: signature, detail: "Recoge por el titular",
    }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "DELIVERED",
        deliveredTo: "María Pérez",
        deliveredToDoc: "INE-ABC123",
        deliverySignatureData: signature,
        // Quién del staff entregó (auditoría de mostrador).
        deliveredById: "admin-1",
        // El QR de evidencias del sticker muere con la entrega: token rotado.
        uploadToken: expect.any(String),
        uploadTokenExpiresAt: expect.any(Date),
      }),
    }))
    // El evento privado de liquidación documenta receptor e identificación.
    const paymentEvent = tx.repairEvent.create.mock.calls
      .map(call => call[0] as { data: { type: string; detail: string; isPublic: boolean } })
      .find(call => call.data.type === "PAYMENT")
    expect(paymentEvent?.data.isPublic).toBe(false)
    expect(paymentEvent?.data.detail).toContain("Entrega a: María Pérez · ID: INE-ABC123")
    expect(paymentEvent?.data.detail).toContain("Recoge por el titular")
  })

  it("sin firma ni identificación la entrega guarda null en esos campos", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "READY", approvedQuoteCents: null }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Juan García" }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deliveredToDoc: null, deliverySignatureData: null }),
    }))
  })

  it("la firma de entrega debe ser un PNG data URL", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "READY", approvedQuoteCents: null }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({
      action: "SETTLE_DELIVER", deliveredTo: "María Pérez", deliverySignatureData: "data:image/jpeg;base64,xx",
    }))).rejects.toThrow()
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
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

describe("refacciones surtidas desde otra sucursal (almacén)", () => {
  // Stock disponible en la sucursal origen y en el total cacheado del producto.
  const stockMocks = (branchQty = 4, totalStock = 10) => {
    tx.product.findFirst.mockResolvedValue({ id: "p1", businessId: "biz" })
    tx.branchStock.findUnique.mockResolvedValue({ quantity: branchQty })
    tx.product.findUnique.mockResolvedValue({ stock: totalStock })
    tx.branchStock.updateMany.mockResolvedValue({ count: 1 })
    tx.product.update.mockResolvedValue({ id: "p1", stock: totalStock - 1 })
  }
  const approvedPart = (over: Record<string, unknown> = {}) => ({
    id: "pt1", productId: "p1", description: "Pantalla", qty: 1,
    unitCostCents: 0, unitPriceCents: 10000, status: "APPROVED", ...over,
  })

  it("PART_ADD con sourceBranchId descuenta del almacén, no de la sucursal de la orden", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    tx.branch.findFirst.mockResolvedValue({ id: "b2", name: "Almacén", isActive: true, businessId: "biz" })
    stockMocks()
    tx.repairPart.create.mockResolvedValue(approvedPart({ sourceBranchId: "b2" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_ADD", partDescription: "Pantalla", partQty: 1, partPriceCents: 10000, partProductId: "p1", sourceBranchId: "b2" }))
    // La sucursal origen se valida activa y del negocio, y se guarda en la pieza.
    expect(tx.branch.findFirst).toHaveBeenCalledWith({ where: { id: "b2", isActive: true, businessId: "biz" } })
    expect(tx.repairPart.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sourceBranchId: "b2" }),
    }))
    // El OUT descuenta de b2: fila de stock, guard atómico y movimiento.
    expect(tx.branchStock.findUnique).toHaveBeenCalledWith({ where: { productId_branchId: { productId: "p1", branchId: "b2" } } })
    expect(tx.branchStock.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ productId: "p1", branchId: "b2", quantity: { gte: 1 } }),
    }))
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "OUT", productId: "p1", branchId: "b2", quantity: 1 }),
    }))
  })

  it("PART_ADD sin sourceBranchId sigue descontando de la sucursal actual", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    stockMocks()
    tx.repairPart.create.mockResolvedValue(approvedPart({ sourceBranchId: null }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_ADD", partDescription: "Pantalla", partQty: 1, partPriceCents: 10000, partProductId: "p1" }))
    expect(tx.branch.findFirst).not.toHaveBeenCalled()
    expect(tx.branchStock.findUnique).toHaveBeenCalledWith({ where: { productId_branchId: { productId: "p1", branchId: "b1" } } })
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "OUT", branchId: "b1" }),
    }))
  })

  it("sourceBranchId inexistente/inactivo/ajeno se rechaza sin crear la refacción", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    tx.branch.findFirst.mockResolvedValue(null)
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_ADD", partDescription: "Pantalla", partQty: 1, sourceBranchId: "b-x" })))
      .rejects.toMatchObject({ status: 404 })
    expect(tx.repairPart.create).not.toHaveBeenCalled()
    expect(tx.branchStock.updateMany).not.toHaveBeenCalled()
  })

  it("PART_DECIDE al autorizar descuenta de la sucursal origen guardada en la pieza", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR", quoteCents: null, approvedQuoteCents: null, quoteApprovedAt: null }))
    tx.repairPart.findFirst.mockResolvedValue({ id: "pt1", productId: "p1", description: "Batería", qty: 1, unitCostCents: 0, unitPriceCents: 30000, status: "REQUESTED", sourceBranchId: "b2" })
    tx.repairPart.updateMany.mockResolvedValue({ count: 1 })
    stockMocks()
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_DECIDE", partId: "pt1", approve: true }))
    expect(tx.branchStock.findUnique).toHaveBeenCalledWith({ where: { productId_branchId: { productId: "p1", branchId: "b2" } } })
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "OUT", branchId: "b2" }),
    }))
  })

  it("PART_REMOVE repone en la sucursal donde salió la pieza (el OUT manda)", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    tx.repairPart.findFirst.mockResolvedValue(approvedPart({ sourceBranchId: "b2" }))
    // El OUT quedó registrado contra el almacén b2: la reposición va ahí.
    tx.inventoryMovement.findMany.mockResolvedValue([{ quantity: 1, branchId: "b2" }])
    tx.inventoryMovement.aggregate.mockResolvedValue({ _sum: { quantity: null } })
    tx.product.update.mockResolvedValue({ id: "p1", stock: 11 })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_REMOVE", partId: "pt1" }))
    expect(tx.branchStock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_branchId: { productId: "p1", branchId: "b2" } },
      create: expect.objectContaining({ branchId: "b2", quantity: 1 }),
      update: { quantity: { increment: 1 } },
    }))
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "RETURN", productId: "p1", branchId: "b2", quantity: 1 }),
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

describe("vigencia de la cotización (\"Válida por 15 días\")", () => {
  it("QUOTE fija quoteExpiresAt y quoteTokenExpiresAt al presentarla", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DIAGNOSIS", quoteCents: null, approvedQuoteCents: null }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "QUOTE", quoteCents: 150000, detail: "Cambio de pantalla" }))
    const data = (tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.status).toBe("WAITING_APPROVAL")
    expect(data.quoteExpiresAt).toBeInstanceOf(Date)
    // El link público muere con la cotización: misma fecha en ambos campos.
    expect(data.quoteTokenExpiresAt).toEqual(data.quoteExpiresAt)
    // ~15 días (margen de un día para no depender del milisegundo exacto).
    expect((data.quoteExpiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 14 * 24 * 60 * 60 * 1000)
  })

  it("re-presentar la cotización renueva la vigencia", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "WAITING_APPROVAL", quoteCents: 150000, quoteExpiresAt: new Date(Date.now() - 1000) }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "QUOTE", quoteCents: 180000, detail: "Cotización actualizada" }))
    const data = (tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect((data.quoteExpiresAt as Date).getTime()).toBeGreaterThan(Date.now())
  })
})

describe("re-autorización del cliente al cambiar refacciones", () => {
  const requestedPart = { id: "pt1", productId: null, description: "Batería", qty: 1, unitCostCents: 0, unitPriceCents: 30000, status: "REQUESTED" }
  const eventDetails = () => tx.repairEvent.create.mock.calls.map(call => (call[0] as { data: { detail: string; isPublic: boolean; type: string } }).data)
  const orderUpdateData = () => (tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data

  it.each(["IN_REPAIR", "WAITING_PARTS", "EXTERNAL_LAB", "QUALITY_CHECK", "READY", "WARRANTY"] as const)(
    "PART_DECIDE autorizando en %s con cotización aprobada devuelve a WAITING_APPROVAL",
    async status => {
      tx.repairOrder.findUnique.mockResolvedValue(order({ status, quoteCents: 150000, approvedQuoteCents: 150000, quoteApprovedAt: new Date() }))
      tx.repairPart.findFirst.mockResolvedValue(requestedPart)
      tx.repairPart.updateMany.mockResolvedValue({ count: 1 })
      await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_DECIDE", partId: "pt1", approve: true }))
      const data = orderUpdateData()
      expect(data.status).toBe("WAITING_APPROVAL")
      expect(data.quoteApprovedAt).toBeNull()
      // La vigencia del link se reinicia para la re-autorización.
      expect(data.quoteExpiresAt).toBeInstanceOf(Date)
      expect((data.quoteExpiresAt as Date).getTime()).toBeGreaterThan(Date.now())
      // Evento PART privado con la pieza + aviso público limpio para el cliente.
      const events = eventDetails()
      expect(events.some(e => !e.isPublic && e.type === "PART" && e.detail.includes("Batería"))).toBe(true)
      expect(events.some(e => e.isPublic && e.detail.includes("esperando tu autorización"))).toBe(true)
      // La autorización pública vuelve a ser posible: el updateMany de la
      // decisión pública exige quoteApprovedAt null, que aquí se resetea.
    },
  )

  it("una segunda refacción autorizada ya en espera de re-autorización solo renueva la vigencia", async () => {
    // La orden ya está en WAITING_APPROVAL con quoteApprovedAt null (la
    // primera pieza ya detonó la re-autorización): no se repite el aviso.
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "WAITING_APPROVAL", quoteCents: 150000, quoteApprovedAt: null }))
    tx.repairPart.findFirst.mockResolvedValue(requestedPart)
    tx.repairPart.updateMany.mockResolvedValue({ count: 1 })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_DECIDE", partId: "pt1", approve: true }))
    const data = orderUpdateData()
    expect(data.status).toBeUndefined()
    expect(data.quoteApprovedAt).toBeUndefined()
    expect(data.quoteExpiresAt).toBeInstanceOf(Date)
    const events = eventDetails()
    expect(events.filter(e => e.isPublic)).toHaveLength(0)
    expect(events).toHaveLength(1) // solo el evento PART privado
  })

  it("PART_DECIDE sin cotización aprobada (IN_REPAIR sin QUOTE previo) no toca la orden", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR", quoteCents: null, approvedQuoteCents: null, quoteApprovedAt: null }))
    tx.repairPart.findFirst.mockResolvedValue(requestedPart)
    tx.repairPart.updateMany.mockResolvedValue({ count: 1 })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_DECIDE", partId: "pt1", approve: true }))
    const data = orderUpdateData()
    expect(data.status).toBeUndefined()
    expect(data.quoteExpiresAt).toBeUndefined()
    expect(eventDetails().filter(e => e.isPublic)).toHaveLength(0)
  })

  it("PART_ADD del admin nace APPROVED y también detona la re-autorización", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "READY", quoteCents: 150000, approvedQuoteCents: 150000, quoteApprovedAt: new Date() }))
    tx.repairPart.create.mockResolvedValue({ id: "pt9", productId: null, description: "Flexor", qty: 1, unitCostCents: 0, unitPriceCents: 20000, status: "APPROVED" })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_ADD", partDescription: "Flexor", partQty: 1, partPriceCents: 20000 }))
    const data = orderUpdateData()
    expect(data.status).toBe("WAITING_APPROVAL")
    expect(data.quoteApprovedAt).toBeNull()
    expect(eventDetails().some(e => e.isPublic && e.detail.includes("esperando tu autorización"))).toBe(true)
  })

  it("PART_REQUEST de un técnico (queda REQUESTED) aún no detona re-autorización", async () => {
    tx.user.findUnique.mockResolvedValue({ ...admin, id: "emp-1", role: "EMPLOYEE" })
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR", quoteCents: 150000, approvedQuoteCents: 150000, quoteApprovedAt: new Date() }))
    tx.repairPart.create.mockResolvedValue({ ...requestedPart })
    await updateRepair(db, "emp-1", "biz", "o1", payload({ action: "PART_REQUEST", partDescription: "Batería", partQty: 1, partPriceCents: 30000 }))
    const data = orderUpdateData()
    expect(data.status).toBeUndefined()
    expect(data.quoteApprovedAt).toBeUndefined()
  })

  it("PART_DECIDE rechazando no cambia el total ni exige re-autorización", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR", quoteCents: 150000, approvedQuoteCents: 150000, quoteApprovedAt: new Date() }))
    tx.repairPart.findFirst.mockResolvedValue(requestedPart)
    tx.repairPart.updateMany.mockResolvedValue({ count: 1 })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "PART_DECIDE", partId: "pt1", approve: false, detail: "No procede" }))
    const data = orderUpdateData()
    expect(data.status).toBeUndefined()
    expect(data.quoteApprovedAt).toBeUndefined()
    expect(eventDetails().filter(e => e.isPublic)).toHaveLength(0)
  })
})

describe("avance de etapa sin detalle (STATUS con detalle opcional)", () => {
  const statusEvent = () => tx.repairEvent.create.mock.calls
    .map(call => call[0] as { data: { type: string; detail: string; isPublic: boolean } })
    .find(call => call.data.type === "STATUS")

  it("STATUS sin detail avanza y el evento conserva la transición automática", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DIAGNOSIS" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "EXTERNAL_LAB" }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "EXTERNAL_LAB" }),
    }))
    // Sin texto del staff el detalle es solo "Origen → Destino." — nunca "undefined".
    expect(statusEvent()?.data.detail).toBe("En diagnóstico → Laboratorio externo.")
    expect(statusEvent()?.data.isPublic).toBe(true)
  })

  it("STATUS con detail lo conserva tras la transición, como antes", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "QUALITY_CHECK", detail: "Quedó el flexor" }))
    expect(statusEvent()?.data.detail).toBe("En reparación → En revisión final. Quedó el flexor")
  })

  it("el resto de acciones sigue exigiendo detalle (NOTE lo rechaza)", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "IN_REPAIR" }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "NOTE" })))
      .rejects.toMatchObject({ message: "Describe el detalle de la acción." })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })
})

describe("ciclo de garantía con vigencia", () => {
  const DAY_MS = 24 * 60 * 60 * 1000
  const updateData = () => (tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data
  const statusEvent = () => tx.repairEvent.create.mock.calls
    .map(call => call[0] as { data: { type: string; detail: string; isPublic: boolean } })
    .find(call => call.data.type === "STATUS")

  it("STATUS→WARRANTY desde DELIVERED fija warrantyUntil ~30 días e incrementa el contador", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "WARRANTY", detail: "El cliente reporta la misma falla" }))
    const data = updateData()
    expect(data.status).toBe("WARRANTY")
    expect(data.warrantyUntil).toBeInstanceOf(Date)
    expect((data.warrantyUntil as Date).getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS)
    expect((data.warrantyUntil as Date).getTime()).toBeLessThan(Date.now() + 31 * DAY_MS)
    // El contador viaja como incremento atómico (no valor absoluto).
    expect(data.warrantyCount).toEqual({ increment: 1 })
    // El evento público lleva la N de la garantía y su vigencia.
    expect(statusEvent()?.data.isPublic).toBe(true)
    expect(statusEvent()?.data.detail).toContain("Entregado → En garantía. Garantía 1 — válida hasta")
  })

  it.each(["READY", "IN_REPAIR", "DIAGNOSIS"] as const)("STATUS→WARRANTY se rechaza desde %s (solo aplica a entregadas)", async status => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "WARRANTY", detail: "Reingreso" })))
      .rejects.toMatchObject({ status: 409, message: "El cambio de estado no corresponde a la etapa actual." })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("STATUS→DELIVERED desde WARRANTY sigue rechazado: la entrega es solo por SETTLE_DELIVER", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "WARRANTY", warrantyCount: 1 }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "DELIVERED", detail: "Entrega directa" })))
      .rejects.toMatchObject({ status: 409, message: "El cambio de estado no corresponde a la etapa actual." })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("la vigencia respeta warranty_days configurado por el negocio", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED" }))
    tx.systemSettings.findUnique.mockResolvedValue({ value: "60" })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "WARRANTY", detail: "Reingreso" }))
    const until = updateData().warrantyUntil as Date
    expect(until.getTime()).toBeGreaterThan(Date.now() + 59 * DAY_MS)
    expect(until.getTime()).toBeLessThan(Date.now() + 61 * DAY_MS)
  })

  it("warranty_days inválido cae al default de 30 días", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED" }))
    tx.systemSettings.findUnique.mockResolvedValue({ value: "0" })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "WARRANTY", detail: "Reingreso" }))
    const until = updateData().warrantyUntil as Date
    expect(until.getTime()).toBeGreaterThan(Date.now() + 29 * DAY_MS)
    expect(until.getTime()).toBeLessThan(Date.now() + 31 * DAY_MS)
  })

  it("un segundo reingreso registra Garantía 2 en el evento", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED", warrantyCount: 1 }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "WARRANTY", detail: "Otra vez la misma falla" }))
    expect(statusEvent()?.data.detail).toContain("Garantía 2 —")
    expect(updateData().warrantyCount).toEqual({ increment: 1 })
  })

  it("SETTLE_DELIVER desde WARRANTY entrega y cierra el ciclo limpiando warrantyUntil", async () => {
    // La orden reingresó por garantía; al entregarla de nuevo la vigencia se
    // limpia y warrantyCount conserva el historial (no se toca aquí).
    tx.repairOrder.findUnique.mockResolvedValue(order({
      status: "WARRANTY", approvedQuoteCents: null, quoteCents: null,
      warrantyUntil: new Date(Date.now() + 10 * DAY_MS), warrantyCount: 1,
    }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Recoge el cliente" }))
    const data = updateData()
    expect(data.status).toBe("DELIVERED")
    expect(data.warrantyUntil).toBeNull()
  })

  it("SETTLE_DELIVER tras reparar la garantía (READY de nuevo) también limpia warrantyUntil", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({
      status: "READY", approvedQuoteCents: null, quoteCents: null,
      warrantyUntil: new Date(Date.now() + 10 * DAY_MS), warrantyCount: 2,
    }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Recoge el cliente" }))
    expect(updateData().warrantyUntil).toBeNull()
  })

  it("STATUS→WARRANTY limpia closedWithoutRepair: el ciclo reabierto vuelve a cobrar normal", async () => {
    // Orden entregada sin reparación (solo cobró el diagnóstico): sin esta
    // limpieza la segunda entrega cobraría solo el diagnóstico aunque el
    // ciclo de garantía consumiera refacciones — saldrían gratis.
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "DELIVERED", closedWithoutRepair: true, diagnosticFeeCents: 20000 }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "WARRANTY", detail: "El cliente lo trae de vuelta" }))
    expect(updateData().closedWithoutRepair).toBe(false)
  })

  it("SETTLE_DELIVER desde WARRANTY cobra mano de obra + refacciones aprobadas, no solo el diagnóstico", async () => {
    // Estado tras el reingreso de una orden entregada sin reparación:
    // closedWithoutRepair ya en false — la entrega factura lo consumido.
    tx.repairOrder.findUnique.mockResolvedValue(order({
      status: "WARRANTY", closedWithoutRepair: false, diagnosticFeeCents: 20000,
      quoteCents: null, approvedQuoteCents: 50000,
      warrantyUntil: new Date(Date.now() + 10 * DAY_MS), warrantyCount: 1,
    }))
    tx.repairPart.findMany.mockResolvedValue([
      { id: "pt1", productId: "p1", description: "Pantalla", qty: 1, unitCostCents: 5000, unitPriceCents: 30000, status: "APPROVED" },
    ])
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Recoge el cliente", paymentMethod: "TRANSFER" }))
    // $500 mano de obra + $300 refacción autorizada = $800 liquidados.
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purpose: "SETTLEMENT", method: "TRANSFER", amount: 800 }),
    }))
    // La refacción se cobra: no se rechaza ni repone su stock.
    expect(tx.repairPart.updateMany).not.toHaveBeenCalled()
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
  })

  it("WARRANTY→NOT_REPAIRED libera las refacciones del ciclo como cualquier cierre sin reparación", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "WARRANTY", closedWithoutRepair: false, warrantyCount: 1 }))
    tx.repairPart.findMany.mockResolvedValue([
      { id: "pt1", productId: "p1", description: "Pantalla", qty: 1, unitCostCents: 0, unitPriceCents: 10000, status: "APPROVED" },
      { id: "pt2", productId: null, description: "Mica", qty: 1, unitCostCents: 0, unitPriceCents: 5000, status: "REQUESTED" },
    ])
    // La pantalla llegó a descontar stock (OUT previo de 1 pieza en b1).
    tx.inventoryMovement.findMany.mockResolvedValue([{ quantity: 1, branchId: "b1" }])
    tx.inventoryMovement.aggregate.mockResolvedValue({ _sum: { quantity: null } })
    tx.product.update.mockResolvedValue({ id: "p1", stock: 7 })
    tx.repairPart.updateMany.mockResolvedValue({ count: 2 })
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "NOT_REPAIRED", detail: "Tampoco quedó" }))
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "RETURN", quantity: 1, productId: "p1" }),
    }))
    expect(tx.repairPart.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId: "o1", status: { in: ["APPROVED", "REQUESTED"] } },
      data: expect.objectContaining({ status: "REJECTED" }),
    }))
  })

  it("SETTLE_DELIVER tras cerrar el ciclo de garantía sin reparación re-fija closedWithoutRepair y cobra el diagnóstico", async () => {
    // La garantía tampoco pudo reparar (WARRANTY→NOT_REPAIRED): la entrega
    // cobra solo el cargo de diagnóstico y la marca queda otra vez en true.
    tx.repairOrder.findUnique.mockResolvedValue(order({ status: "NOT_REPAIRED", diagnosticFeeCents: 20000, warrantyCount: 1 }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "SETTLE_DELIVER", deliveredTo: "Recoge el cliente", paymentMethod: "TRANSFER" }))
    expect(tx.repairOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", closedWithoutRepair: true, warrantyUntil: null }),
    }))
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purpose: "SETTLEMENT", amount: 200 }),
    }))
  })
})
