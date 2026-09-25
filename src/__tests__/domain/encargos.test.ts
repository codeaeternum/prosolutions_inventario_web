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
  product: { findFirst: vi.fn() },
  encargo: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
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
  tx.encargo.findMany.mockResolvedValue([])
  tx.auditEvent.create.mockResolvedValue({})
})

describe("guard de transiciones", () => {
  it("acepta el flujo feliz y la cancelación desde cualquier estado", () => {
    expect(canTransitionEncargo("PENDING", "ORDERED")).toBe(true)
    expect(canTransitionEncargo("ORDERED", "READY")).toBe(true)
    expect(canTransitionEncargo("READY", "DELIVERED")).toBe(true)
    for (const from of ["PENDING", "ORDERED", "READY", "DELIVERED"]) {
      expect(canTransitionEncargo(from, "CANCELLED")).toBe(true)
    }
  })

  it("rechaza saltos hacia atrás y estados terminales", () => {
    expect(canTransitionEncargo("PENDING", "READY")).toBe(false)
    expect(canTransitionEncargo("ORDERED", "PENDING")).toBe(false)
    expect(canTransitionEncargo("DELIVERED", "READY")).toBe(false)
    // Cancelado es terminal: nada sale de ahí.
    for (const to of ["PENDING", "ORDERED", "READY", "DELIVERED", "CANCELLED"]) {
      expect(canTransitionEncargo("CANCELLED", to)).toBe(false)
    }
    // Transición al mismo estado tampoco es un avance.
    expect(canTransitionEncargo("PENDING", "PENDING")).toBe(false)
  })

  it("assertEncargoTransition explica el salto inválido", async () => {
    expect(() => assertEncargoTransition("ORDERED", "PENDING")).toThrowError(/pedida.*pendiente/)
    expect(() => assertEncargoTransition("READY", "INVENTARIO")).toThrowError()
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

  it("graba el alta en la bitácora", async () => {
    tx.encargo.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "e2", ...args.data }))
    await createEncargo(db, "admin-1", BIZ, { idempotencyKey: key(), description: "Cargador 65W", deposit: 100 })
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "ENCARGO_CREATE", entity: "encargo", entityId: "e2" }),
    }))
  })
})

describe("transición de encargo", () => {
  const pending = { id: "e1", businessId: BIZ, status: "PENDING", description: "Pantalla", branchId: "b1", branch, customer: null, marketplaceRequestId: null }

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

  it("entregar marca quién lo resolvió", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...pending, status: "READY" })
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    await transitionEncargo(db, "emp-1", BIZ, "e1", { idempotencyKey: key(), action: "DELIVERED" })
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DELIVERED", resolvedById: "emp-1" }),
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
