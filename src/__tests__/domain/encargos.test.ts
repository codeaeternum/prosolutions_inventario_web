import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import {
  assertEncargoTransition,
  canTransitionEncargo,
  createEncargo,
  listEncargos,
  resolveEncargoBranch,
  transitionEncargo,
} from "@/lib/domain/encargos"
import { sell } from "@/lib/domain/sales"
import { checkoutDocument } from "@/lib/domain/documents"

/**
 * Encargos de clientes: guard de transiciones de estado, restricción de
 * sucursal para empleados (siempre su homeBranchId) y alta/resolución con
 * recibo idempotente. El dominio corre sobre un tx falso (db.$transaction
 * entrega el mock).
 */
const BIZ = "biz"
const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ }
const employee = { ...admin, id: "emp-1", role: "EMPLOYEE" }
const branch = { id: "b1", name: "Matriz", isActive: true, businessId: BIZ }
let seq = 0
const key = () => `encargo-test-${++seq}`
// Mismo hash que operation(): sha256 del payload tal como lo arma el dominio.
const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex")

const tx = {
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  branch: { findFirst: vi.fn() },
  product: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  branchStock: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  sale: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  saleItem: { create: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  inventoryMovement: { create: vi.fn() },
  encargo: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  payment: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  supplier: { findFirst: vi.fn() },
  supplierPayment: { create: vi.fn() },
  cashRegister: { findMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  cashMovement: { create: vi.fn(), findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(admin)
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.branch.findFirst.mockResolvedValue(branch)
  tx.product.findFirst.mockResolvedValue(null)
  tx.product.findMany.mockResolvedValue([])
  tx.encargo.findMany.mockResolvedValue([])
  tx.auditEvent.create.mockResolvedValue({})
  // Ledger: caja abierta por defecto, sin asientos previos de pagos.
  tx.payment.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "pay-1", ...args.data }))
  tx.payment.update.mockResolvedValue({})
  tx.payment.updateMany.mockResolvedValue({ count: 1 })
  tx.payment.findMany.mockResolvedValue([])
  tx.supplier.findFirst.mockResolvedValue(null)
  tx.supplierPayment.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "sp-1", ...args.data }))
  tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-1", initialAmount: 0 }])
  tx.cashRegister.updateMany.mockResolvedValue({ count: 1 })
  tx.cashRegister.findUniqueOrThrow.mockResolvedValue({ id: "reg-1", initialAmount: 0 })
  tx.cashMovement.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "cm-1", ...args.data }))
  tx.cashMovement.findMany.mockResolvedValue([])
})

describe("guard de transiciones", () => {
  it("acepta el flujo feliz y la cancelación solo antes de entregar", () => {
    expect(canTransitionEncargo("PENDING", "ORDERED")).toBe(true)
    expect(canTransitionEncargo("ORDERED", "READY")).toBe(true)
    expect(canTransitionEncargo("READY", "DELIVERED")).toBe(true)
    for (const from of ["PENDING", "ORDERED", "READY"]) {
      expect(canTransitionEncargo(from, "CANCELLED")).toBe(true)
    }
    // Una pieza ya entregada no se cancela como encargo (se devuelve por venta).
    expect(canTransitionEncargo("DELIVERED", "CANCELLED")).toBe(false)
  })

  it("rechaza saltos hacia atrás y estados terminales", () => {
    expect(canTransitionEncargo("PENDING", "READY")).toBe(false)
    expect(canTransitionEncargo("ORDERED", "PENDING")).toBe(false)
    expect(canTransitionEncargo("DELIVERED", "READY")).toBe(false)
    // DELIVERED y CANCELLED son terminales: nada sale de ahí.
    for (const to of ["PENDING", "ORDERED", "READY", "DELIVERED", "CANCELLED"]) {
      expect(canTransitionEncargo("DELIVERED", to)).toBe(false)
      expect(canTransitionEncargo("CANCELLED", to)).toBe(false)
    }
    // Transición al mismo estado tampoco es un avance.
    expect(canTransitionEncargo("PENDING", "PENDING")).toBe(false)
  })

  it("assertEncargoTransition explica el salto inválido", async () => {
    expect(() => assertEncargoTransition("ORDERED", "PENDING")).toThrowError(/pedida.*pendiente/)
    expect(() => assertEncargoTransition("READY", "INVENTARIO")).toThrowError()
    expect(() => assertEncargoTransition("DELIVERED", "CANCELLED")).toThrowError(/entregada.*cancelada/)
    expect(() => assertEncargoTransition("READY", "DELIVERED")).not.toThrow()
  })
})

describe("sucursal del encargo", () => {
  it("el empleado registra siempre en su sucursal base aunque pida otra", async () => {
    const emp = { role: "EMPLOYEE", homeBranchId: "b1" }
    const got = await resolveEncargoBranch(tx as never, emp, undefined, BIZ)
    expect(got.id).toBe("b1")
    expect(tx.branch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "b1", businessId: BIZ, isActive: true }),
    }))
    // Pedir otra sucursal estando en una base asignada es 403.
    await expect(resolveEncargoBranch(tx as never, emp, "b-ajena", BIZ))
      .rejects.toMatchObject({ status: 403 })
  })

  it("el admin elige cualquier sucursal activa del negocio", async () => {
    tx.branch.findFirst.mockResolvedValue({ ...branch, id: "b2", name: "Sucursal Norte" })
    const got = await resolveEncargoBranch(tx as never, { role: "ADMIN", homeBranchId: null }, "b2", BIZ)
    expect(got.id).toBe("b2")
  })

  it("sin sucursal pedida cae en la primera activa del negocio", async () => {
    await resolveEncargoBranch(tx as never, { role: "ADMIN", homeBranchId: null }, undefined, BIZ)
    expect(tx.branch.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: BIZ, isActive: true }),
    }))
  })
})

describe("alta de encargo", () => {
  it("crea con defaults, sucursal resuelta y el actor como capturista", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e1", ...args.data }))
    const result = await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Pantalla iPhone 12" })
    expect(tx.encargo.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: BIZ, description: "Pantalla iPhone 12", branchId: "b1",
        quantity: 1, deposit: 0, createdById: "admin-1",
      }),
    }))
    expect(result.encargo.id).toBe("e1")
  })

  it("un empleado no puede registrar el encargo en otra sucursal", async () => {
    tx.user.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "emp-1" ? { ...employee, homeBranchId: "b1" } : admin)
    tx.branch.findFirst.mockImplementation(async (args: { where: { id?: string } }) =>
      args.where.id === "b1" ? branch : null)
    await expect(createEncargo(db, "emp-1", BIZ, { idempotencyKey: key(), description: "Flex A32", branchId: "b-otra" }))
      .rejects.toMatchObject({ status: 403 })
    expect(tx.encargo.create).not.toHaveBeenCalled()
  })

  it("el cliente debe existir en el negocio", async () => {
    tx.user.findFirst.mockResolvedValue(null)
    await expect(createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Batería", customerId: "u-x" }))
      .rejects.toMatchObject({ status: 404 })
    expect(tx.encargo.create).not.toHaveBeenCalled()
  })

  it("rechaza anticipos con más de dos decimales", async () => {
    await expect(createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Mica", deposit: 50.555 }))
      .rejects.toMatchObject({ status: 400 })
    expect(tx.encargo.create).not.toHaveBeenCalled()
  })

  it("rechaza un anticipo mayor que el precio cotizado", async () => {
    await expect(createEncargo(db, "admin-1", BIZ, {
      idempotencyKey: key(), description: "Pantalla A54", priceQuoted: 800, deposit: 1200,
    }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining("anticipo") })
    expect(tx.encargo.create).not.toHaveBeenCalled()
  })

  it("acepta anticipo igual al cotizado, o cualquier anticipo sin cotización", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e1", ...args.data }))
    await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Batería", priceQuoted: 500, deposit: 500 })
    // Sin precio cotizado no hay con qué acotar: el anticipo queda a criterio.
    await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Flex", deposit: 9000 })
    expect(tx.encargo.create).toHaveBeenCalledTimes(2)
  })

  it("graba el alta en la bitácora", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e2", ...args.data }))
    await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Cargador 65W", deposit: 100 })
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "ENCARGO_CREATE", entity: "encargo", entityId: "e2" }),
    }))
  })
})

describe("ledger del anticipo", () => {
  it("el anticipo en efectivo crea su Payment ADVANCE y el CashMovement IN en la caja de la sucursal", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e1", ...args.data }))
    const result = await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Pantalla", deposit: 500 })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ encargoId: "e1", purpose: "ADVANCE", method: "CASH", amount: 500, businessId: BIZ }),
    }))
    // La caja que entra es la de la sucursal del encargo.
    expect(tx.cashRegister.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "OPEN", branchId: "b1", businessId: BIZ }),
    }))
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "IN", amount: 500, registerId: "reg-1", businessId: BIZ,
        referenceType: "ENCARGO_DEPOSIT", referenceId: "pay-1",
      }),
    }))
    // El comprobante queda ligado a su asiento de caja.
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { cashMovementId: "cm-1" } })
    expect(result.depositPaymentId).toBe("pay-1")
  })

  it("anticipo por tarjeta: comprobante sin asiento de caja (el dinero no pasa por el cajón)", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e1", ...args.data }))
    await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Batería", deposit: 300, depositMethod: "CARD" })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: "CARD", purpose: "ADVANCE", amount: 300 }),
    }))
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("anticipo en efectivo sin caja abierta se rechaza (409) y no deja encargo", async () => {
    tx.cashRegister.findMany.mockResolvedValue([])
    await expect(createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Mica", deposit: 100 }))
      .rejects.toMatchObject({ status: 409, code: "REGISTER_REQUIRED" })
    expect(tx.payment.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("sin anticipo no hay ledger", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e1", ...args.data }))
    const result = await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Flex" })
    expect(tx.payment.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
    expect(result.depositPaymentId).toBeNull()
  })
})

describe("transición de encargo", () => {
  const pending = { id: "e1", businessId: BIZ, status: "PENDING", description: "Pantalla", deposit: 0, branchId: "b1", branch, customer: null, marketplaceRequestId: null }

  it("PENDING → ORDERED liga la solicitud del mercado", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED", marketplaceRequestId: "mr-9", supplierNote: "Pedida a Taller Aliado",
    })
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "e1", status: "PENDING" },
      data: expect.objectContaining({ status: "ORDERED", marketplaceRequestId: "mr-9", supplierNote: "Pedida a Taller Aliado" }),
    }))
    expect(result.status).toBe("ORDERED")
    expect(result.marketplaceRequestId).toBe("mr-9")
    // El cambio queda en la bitácora con antes/después.
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "ENCARGO_STATUS",
        changes: { status: { before: "PENDING", after: "ORDERED" } },
      }),
    }))
  })

  it("READY devuelve descripción y sucursal para el aviso al staff", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...pending, status: "ORDERED" })
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "READY" })
    expect(result).toMatchObject({ status: "READY", description: "Pantalla", branchId: "b1", branchName: "Matriz" })
  })

  it("un salto inválido (READY desde PENDING) no toca la base", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    await expect(transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "READY" }))
      .rejects.toMatchObject({ status: 409 })
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
  })

  it("bloquea READY → DELIVERED directo cuando hay saldo por cobrar o sin cotización", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...pending, status: "READY", priceQuoted: 500, deposit: 200 })
    await expect(transitionEncargo(db, "emp-1", BIZ, "e1", { idempotencyKey: key(), action: "DELIVERED" }))
      .rejects.toMatchObject({ status: 409, code: "ENCARGO_REQUIRES_SALE" })
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()

    tx.encargo.findFirst.mockResolvedValue({ ...pending, status: "READY", priceQuoted: null, deposit: 0 })
    await expect(transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "DELIVERED" }))
      .rejects.toMatchObject({ status: 409, code: "ENCARGO_REQUIRES_SALE" })
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
  })

  it("permite READY → DELIVERED directo si el anticipo ya cubrió el 100% del precio cotizado", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...pending, status: "READY", priceQuoted: 500, deposit: 500 })
    tx.payment.findMany.mockImplementation(async (args: { where: { purpose?: string } }) =>
      args.where.purpose === "ADVANCE" ? [{ method: "CASH", amount: 500, status: "CONFIRMED" }] : [])
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await transitionEncargo(db, "emp-1", BIZ, "e1", { idempotencyKey: key(), action: "DELIVERED" })
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", resolvedById: "emp-1" }),
    }))
  })

  it("permite a ADMIN entregar sin cobro cuando declara motivo explícito (garantía/cortesía)", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...pending, status: "READY", priceQuoted: 500, deposit: 0 })
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "DELIVERED", reason: "Reposición por garantía sin costo",
    })
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", resolvedById: "admin-1" }),
    }))
  })

  it("reintentar con la MISMA llave devuelve el recibo guardado sin tocar la base", async () => {
    const opKey = key()
    const stored = { encargoId: "e1", status: "READY", operationId: "op-1" }
    tx.businessOperation.findUnique.mockResolvedValue({
      key: opKey, actorId: "admin-1", kind: "ENCARGO_STATUS", businessId: BIZ,
      requestHash: hash({ id: "e1", idempotencyKey: opKey, action: "READY" }),
      response: stored,
    })
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: opKey, action: "READY" })
    expect(result).toEqual(stored)
    expect(tx.encargo.findFirst).not.toHaveBeenCalled()
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
  })
})

describe("pago al proveedor al pedir", () => {
  const pending = { id: "e1", businessId: BIZ, status: "PENDING", description: "Pantalla", deposit: 0, branchId: "b1", branch, customer: null, marketplaceRequestId: null }

  it("ORDERED con pago asienta SupplierPayment ligado al encargo", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.supplier.findFirst.mockResolvedValue({ id: "sup-1", name: "Repuestos MX" })
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED",
      supplierId: "sup-1", supplierAmountCents: 25000, supplierMethod: "TRANSFER",
    })
    expect(tx.supplierPayment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: BIZ, supplierId: "sup-1", encargoId: "e1",
        amountCents: 25000, method: "TRANSFER", createdById: "admin-1",
      }),
    }))
    expect(result.supplierPaymentId).toBe("sp-1")
    // TRANSFER no pasa por el cajón.
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("CASH con cashFromRegister asienta la salida en el cajón del cobrador", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.supplier.findFirst.mockResolvedValue({ id: "sup-1", name: "Repuestos MX" })
    // Caja con 1000 pesos de entradas.
    tx.cashMovement.findMany.mockResolvedValue([{ type: "IN", amount: 1000 }])
    await transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED",
      supplierId: "sup-1", supplierAmountCents: 30000, supplierMethod: "CASH", cashFromRegister: true,
    })
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "OUT", amount: 300, registerId: "reg-1",
        referenceType: "SUPPLIER_PAYMENT", referenceId: "sp-1",
      }),
    }))
  })

  it("CASH sin cashFromRegister solo documenta la salida (como paySupplier)", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.supplier.findFirst.mockResolvedValue({ id: "sup-1", name: "Repuestos MX" })
    await transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED",
      supplierId: "sup-1", supplierAmountCents: 30000, supplierMethod: "CASH",
    })
    expect(tx.supplierPayment.create).toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("un empleado no puede registrar salidas de dinero del negocio (403)", async () => {
    tx.user.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "emp-1" ? employee : admin)
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await expect(transitionEncargo(db, "emp-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED",
      supplierId: "sup-1", supplierAmountCents: 1000, supplierMethod: "CASH",
    })).rejects.toMatchObject({ status: 403 })
    expect(tx.supplierPayment.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("campos de pago incompletos se rechazan sin asentar nada", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await expect(transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED", supplierId: "sup-1",
    })).rejects.toMatchObject({ status: 400 })
    expect(tx.supplierPayment.create).not.toHaveBeenCalled()
  })

  it("la salida de caja no puede superar el efectivo disponible", async () => {
    tx.encargo.findFirst.mockResolvedValue(pending)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.supplier.findFirst.mockResolvedValue({ id: "sup-1", name: "Repuestos MX" })
    tx.cashMovement.findMany.mockResolvedValue([{ type: "IN", amount: 100 }])
    await expect(transitionEncargo(db, "admin-1", BIZ, "e1", {
      idempotencyKey: key(), action: "ORDERED",
      supplierId: "sup-1", supplierAmountCents: 30000, supplierMethod: "CASH", cashFromRegister: true,
    })).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_CASH" })
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })
})

describe("reembolso del anticipo al cancelar", () => {
  const withDeposit = { id: "e1", businessId: BIZ, status: "READY", description: "Pantalla", deposit: 500, branchId: "b1", branch, customer: null, marketplaceRequestId: null }
  const paidLedger = (method = "CASH") => (args: { where: { purpose?: string } }) =>
    Promise.resolve(args.where.purpose === "ADVANCE" ? [{ method, amount: 500, status: "CONFIRMED" }] : [])

  it("cancelar con anticipo en efectivo: Payment REFUND negativo + CashMovement OUT", async () => {
    tx.encargo.findFirst.mockResolvedValue(withDeposit)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findMany.mockImplementation(paidLedger("CASH"))
    tx.cashMovement.findMany.mockResolvedValue([{ type: "IN", amount: 2000 }])
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED" })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        encargoId: "e1", purpose: "REFUND", method: "CASH", amount: -500, status: "REFUNDED",
      }),
    }))
    expect(tx.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "OUT", amount: 500, registerId: "reg-1",
        referenceType: "ENCARGO_REFUND", referenceId: "pay-1",
      }),
    }))
    expect(tx.payment.update).toHaveBeenCalledWith({ where: { id: "pay-1" }, data: { cashMovementId: "cm-1" } })
    expect(result.refundPaymentId).toBe("pay-1")
    // La bitácora anota la devolución.
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ summary: expect.stringContaining("anticipo devuelto") }),
    }))
  })

  it("la devolución usa el método del anticipo: tarjeta no pasa por caja", async () => {
    tx.encargo.findFirst.mockResolvedValue(withDeposit)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findMany.mockImplementation(paidLedger("CARD"))
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED" })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: "CARD", amount: -500 }),
    }))
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
    expect(result.refundPaymentId).toBe("pay-1")
  })

  it("devolución por tarjeta sin folio se asienta y deja advertencia de conciliación", async () => {
    tx.encargo.findFirst.mockResolvedValue(withDeposit)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findMany.mockImplementation(paidLedger("CARD"))
    await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED", refundMethod: "CARD" })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: "CARD", status: "REFUNDED", reference: null }),
    }))
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "REFUND_NO_REFERENCE", entity: "payment", entityId: "pay-1" }),
    }))
  })

  it("devolución por transferencia con folio lo guarda y no advierte", async () => {
    tx.encargo.findFirst.mockResolvedValue(withDeposit)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findMany.mockImplementation(paidLedger("TRANSFER"))
    await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED", refundMethod: "TRANSFER", refundReference: "SPEI-4321" })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: "TRANSFER", reference: "SPEI-4321" }),
    }))
    expect(tx.auditEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "REFUND_NO_REFERENCE" }),
    }))
  })

  it("encargo sin asientos (legacy) devuelve el deposit de la ficha, refundMethod decide el medio", async () => {
    tx.encargo.findFirst.mockResolvedValue(withDeposit)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED", refundMethod: "TRANSFER" })
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ method: "TRANSFER", amount: -500 }),
    }))
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("la devolución en efectivo no puede superar lo que hay en caja", async () => {
    tx.encargo.findFirst.mockResolvedValue(withDeposit)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findMany.mockImplementation(paidLedger("CASH"))
    // Caja con solo 100 pesos: no alcanza para devolver 500.
    tx.cashMovement.findMany.mockResolvedValue([{ type: "IN", amount: 100 }])
    await expect(transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED" }))
      .rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_CASH" })
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("un anticipo ya devuelto no se paga dos veces", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...withDeposit, status: "READY" })
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    // Ledger: anticipo de 500 y una devolución previa (-500): retenido 0.
    tx.payment.findMany.mockImplementation(async (args: { where: { purpose?: string } }) =>
      args.where.purpose === "ADVANCE" ? [{ method: "CASH", amount: 500, status: "CONFIRMED" }] : [{ amount: -500 }])
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED" })
    expect(result.refundPaymentId).toBeNull()
    expect(tx.payment.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })

  it("prohíbe cancelar un encargo ya DELIVERED (409)", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...withDeposit, status: "DELIVERED" })
    await expect(transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED" }))
      .rejects.toMatchObject({ status: 409, code: "ENCARGO_BAD_TRANSITION" })
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
    expect(tx.payment.create).not.toHaveBeenCalled()
  })

  it("EMPLOYEE no puede cancelar un encargo registrado por otra persona (403), pero sí el propio", async () => {
    tx.user.findUnique.mockResolvedValue(employee)
    tx.encargo.findFirst.mockResolvedValue({ ...withDeposit, createdById: "admin-1", createdBy: { id: "admin-1", name: "Admin" } })
    await expect(transitionEncargo(db, "emp-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED", reason: "Cliente canceló" }))
      .rejects.toMatchObject({ status: 403 })
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
    expect(tx.payment.create).not.toHaveBeenCalled()

    // El mismo empleado sí puede cancelar un encargo que él mismo registró.
    tx.encargo.findFirst.mockResolvedValue({ ...withDeposit, deposit: 0, createdById: "emp-1", createdBy: { id: "emp-1", name: "Emp" } })
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    const own = await transitionEncargo(db, "emp-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED", reason: "Cliente ya no la quiso" })
    expect(own.status).toBe("CANCELLED")
  })

  it("cancelar sin anticipo no toca el ledger", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...withDeposit, deposit: 0 })
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: key(), action: "CANCELLED" })
    expect(tx.payment.findMany).not.toHaveBeenCalled()
    expect(tx.payment.create).not.toHaveBeenCalled()
  })

  it("repetir la cancelación con la misma llave no duplica el reembolso", async () => {
    const opKey = key()
    const stored = { encargoId: "e1", status: "CANCELLED", refundPaymentId: "pay-1", operationId: "op-1" }
    tx.businessOperation.findUnique.mockResolvedValue({
      key: opKey, actorId: "admin-1", kind: "ENCARGO_STATUS", businessId: BIZ,
      requestHash: hash({ id: "e1", idempotencyKey: opKey, action: "CANCELLED" }),
      response: stored,
    })
    const result = await transitionEncargo(db, "admin-1", BIZ, "e1", { idempotencyKey: opKey, action: "CANCELLED" })
    expect(result).toEqual(stored)
    expect(tx.encargo.findFirst).not.toHaveBeenCalled()
    expect(tx.payment.create).not.toHaveBeenCalled()
    expect(tx.cashMovement.create).not.toHaveBeenCalled()
  })
})

describe("lista de encargos", () => {
  it("ordena activos primero y filtra por estado", async () => {
    tx.encargo.findMany.mockResolvedValue([
      { id: "e1", status: "DELIVERED", createdAt: new Date() },
      { id: "e2", status: "PENDING", createdAt: new Date() },
      { id: "e3", status: "READY", createdAt: new Date() },
      { id: "e4", status: "ORDERED", createdAt: new Date() },
      { id: "e5", status: "CANCELLED", createdAt: new Date() },
    ])
    const encargos = await listEncargos(db, BIZ, { status: undefined })
    expect(encargos.map(e => e.id)).toEqual(["e2", "e3", "e4", "e1", "e5"])
    expect(tx.encargo.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: BIZ }),
    }))
  })

  it("ignora un status inválido en vez de filtrar mal", async () => {
    await listEncargos(db, BIZ, { status: "INVENTADO" })
    expect(tx.encargo.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ status: "INVENTADO" }),
    }))
  })
})

describe("cobro de encargo en POS (sell / checkoutDocument)", () => {
  const catalogProduct = {
    id: "prod-1",
    businessId: BIZ,
    name: "Pantalla iPhone 13",
    isActive: true,
    stock: 2,
    minStock: 0,
    retailPrice: 1200,
    wholesalePrice: 1000,
    lowStockAlertAt: null,
  }
  const readyEncargo = {
    id: "enc-1",
    businessId: BIZ,
    branchId: "b1",
    branch,
    status: "READY",
    description: "Pantalla iPhone 13",
    quantity: 1,
    deposit: 300,
    priceQuoted: 1000,
    productId: "prod-1",
    product: { id: "prod-1", name: "Pantalla iPhone 13" },
    customerId: "cust-1",
    customer: { id: "cust-1", name: "Cliente", phone: "5512345678" },
    createdById: "emp-1",
    createdBy: { id: "emp-1", name: "Emp" },
    resolvedBy: null,
    marketplaceRequestId: null,
  }

  beforeEach(() => {
    tx.user.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === "cust-1") return { id: "cust-1", name: "Cliente", role: "CUSTOMER", customerType: "NORMAL", status: "APPROVED", businessId: BIZ }
      if (args.where.id === "emp-1") return { ...employee, homeBranchId: "b1" }
      return admin
    })
    tx.product.findFirst.mockResolvedValue(catalogProduct)
    tx.product.findUnique.mockResolvedValue(catalogProduct)
    tx.product.findUniqueOrThrow.mockResolvedValue({ ...catalogProduct, stock: 1 })
    tx.branchStock.upsert.mockResolvedValue({})
    tx.branchStock.updateMany.mockResolvedValue({ count: 1 })
    tx.product.updateMany.mockResolvedValue({ count: 1 })
    tx.sale.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "sale-1", number: 42, ...args.data }))
    tx.saleItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "si-1", ...args.data }))
    tx.inventoryMovement.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "im-1", ...args.data, product: { id: "prod-1", name: "Pantalla iPhone 13" } }))
    tx.encargo.findFirst.mockResolvedValue(readyEncargo)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    tx.payment.findMany.mockImplementation(async (args: { where: { purpose?: string } }) =>
      args.where.purpose === "ADVANCE" ? [{ method: "CASH", amount: 300, status: "CONFIRMED" }] : [])
  })

  it("sell con encargoId usa priceQuoted, descuenta el anticipo del cobro, liga el Payment ADVANCE y cierra a DELIVERED en la misma tx", async () => {
    const result = await sell(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }],
      paymentMethod: "TARJETA",
    })

    // Sale.total refleja el precio cotizado ($1,000), no el de catálogo ($1,200).
    expect(result.total).toBe(1000)
    expect(result.depositCents).toBe(30000)
    expect(result.payableCents).toBe(70000)

    // Solo se crea Payment por el resto ($700), sin duplicar el anticipo de $300.
    expect(tx.payment.create).toHaveBeenCalledTimes(1)
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        saleId: "sale-1",
        method: "CARD",
        amount: 700,
        status: "CONFIRMED",
      }),
    }))

    // El Payment ADVANCE original se liga a saleId para cuadrar Sale.payments sin tocar su createdAt.
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { encargoId: "enc-1", purpose: "ADVANCE", status: "CONFIRMED" },
      data: { saleId: "sale-1" },
    })

    // El encargo pasa a DELIVERED dentro de la misma transacción.
    expect(tx.encargo.updateMany).toHaveBeenCalledWith({
      where: { id: "enc-1", status: "READY" },
      data: expect.objectContaining({ status: "DELIVERED", resolvedById: "emp-1" }),
    })
  })

  it("rechaza en sell un pago dividido que intente cobrar el total sin descontar el anticipo", async () => {
    await expect(sell(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }],
      payments: [{ method: "EFECTIVO", amount: 500 }, { method: "TARJETA", amount: 500 }],
    })).rejects.toMatchObject({ status: 409 })
  })

  it("rechaza cobrar un encargo que no está en estado READY o pertenece a otra sucursal", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...readyEncargo, status: "DELIVERED" })
    await expect(sell(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }],
      paymentMethod: "EFECTIVO",
    })).rejects.toMatchObject({ status: 409, code: "ENCARGO_NOT_READY" })

    tx.encargo.findFirst.mockResolvedValue({ ...readyEncargo, branchId: "b-otra" })
    await expect(sell(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      encargoId: "enc-1",
      items: [{ productId: "prod-1", quantity: 1 }],
      paymentMethod: "EFECTIVO",
    })).rejects.toMatchObject({ status: 409 })
  })

  it("checkoutDocument con encargoId aplica descuento + anticipo y cierra el encargo a DELIVERED", async () => {
    tx.sale.findUnique.mockResolvedValue({
      id: "sale-draft-1",
      businessId: BIZ,
      number: 55,
      status: "DRAFT",
      kind: "RETAIL",
      total: 1000,
      branchId: "b1",
      sellerId: "emp-1",
      customerId: "cust-1",
    })
    tx.saleItem.findMany.mockResolvedValue([
      { id: "si-1", saleId: "sale-draft-1", productId: "prod-1", quantity: 1, unitPrice: 1000, totalPrice: 1000 },
    ])
    tx.saleItem.findUniqueOrThrow.mockResolvedValue(
      { id: "si-1", saleId: "sale-draft-1", productId: "prod-1", quantity: 1, unitPrice: 1000, totalPrice: 1000 },
    )
    tx.sale.updateMany.mockResolvedValue({ count: 1 })

    const result = await checkoutDocument(db, "emp-1", BIZ, {
      idempotencyKey: key(),
      saleId: "sale-draft-1",
      encargoId: "enc-1",
      discountCents: 10000, // $100 de descuento
      discountReason: "Cliente frecuente",
      paymentMethod: "EFECTIVO",
    })

    // Total $1,000 − $100 dto − $300 anticipo = $600 por cobrar hoy.
    expect(result.payableCents).toBe(60000)
    expect(result.depositCents).toBe(30000)
    expect(tx.payment.create).toHaveBeenCalledTimes(1)
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ saleId: "sale-draft-1", method: "CASH", amount: 600 }),
    }))
    expect(tx.encargo.updateMany).toHaveBeenCalledWith({
      where: { id: "enc-1", status: "READY" },
      data: expect.objectContaining({ status: "DELIVERED", resolvedById: "emp-1" }),
    })
  })
})
