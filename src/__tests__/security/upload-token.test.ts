import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { updateRepair } from "@/lib/domain/workshop"

/**
 * Ciclo de vida del uploadToken (QR del sticker de evidencias): el enlace
 * público caduca (410), la cancelación rota el token y solo el admin puede
 * regenerarlo — un QR impreso ya no es una puerta trasera permanente.
 * Tokens históricos con uploadTokenExpiresAt NULL siguen válidos (backfill:
 * la vigencia solo corre para órdenes creadas con el campo).
 */

const mocks = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  photoCreate: vi.fn(),
  photoUpdate: vi.fn(),
  photoDelete: vi.fn(),
  eventCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    repairOrder: { findUnique: mocks.orderFindUnique },
    repairPhoto: { create: mocks.photoCreate, update: mocks.photoUpdate, delete: mocks.photoDelete },
    repairEvent: { create: mocks.eventCreate },
  },
}))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: vi.fn(() => true),
  getClientIp: vi.fn(() => "10.0.0.9"),
}))

import { GET as getEvidence, POST as postEvidence } from "@/app/api/evidencia/[token]/route"

const tokenParams = { params: Promise.resolve({ token: "tok-1" }) }
const req = (method = "GET") =>
  new Request("https://app.invalid/api/evidencia/tok-1", { method })

// Fila tal como la lee la ruta pública (select por uploadToken).
const evidenceOrder = (over: Record<string, unknown> = {}) => ({
  number: 7,
  uploadTokenExpiresAt: null,
  business: { isActive: true },
  photos: [],
  id: "o1",
  createdById: "u-staff",
  businessId: "biz-1",
  status: "IN_REPAIR",
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/evidencia/[token]", () => {
  it("token vencido responde 410 con el mensaje de vigencia", async () => {
    mocks.orderFindUnique.mockResolvedValue(evidenceOrder({ uploadTokenExpiresAt: new Date(Date.now() - 60_000) }))
    const res = await getEvidence(req(), tokenParams)
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe("Este link ya no está vigente.")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("token vigente responde 200", async () => {
    mocks.orderFindUnique.mockResolvedValue(evidenceOrder({ uploadTokenExpiresAt: new Date(Date.now() + 60_000) }))
    const res = await getEvidence(req(), tokenParams)
    expect(res.status).toBe(200)
    expect((await res.json()).orderNumber).toBe(7)
  })

  it("sin caducidad (NULL, órdenes anteriores al campo) sigue funcionando", async () => {
    mocks.orderFindUnique.mockResolvedValue(evidenceOrder({ uploadTokenExpiresAt: null }))
    const res = await getEvidence(req(), tokenParams)
    expect(res.status).toBe(200)
  })

  it("token inexistente o negocio suspendido responde 404 genérico", async () => {
    mocks.orderFindUnique.mockResolvedValue(null)
    expect((await getEvidence(req(), tokenParams)).status).toBe(404)
    mocks.orderFindUnique.mockResolvedValue(evidenceOrder({ business: { isActive: false } }))
    expect((await getEvidence(req(), tokenParams)).status).toBe(404)
  })
})

describe("POST /api/evidencia/[token]", () => {
  it("token vencido responde 410 y no registra la foto", async () => {
    mocks.orderFindUnique.mockResolvedValue(evidenceOrder({ uploadTokenExpiresAt: new Date(Date.now() - 60_000) }))
    const res = await postEvidence(req("POST"), tokenParams)
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe("Este link ya no está vigente.")
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })

  it("orden cerrada sigue respondiendo 404 aunque el token esté vigente", async () => {
    for (const status of ["DELIVERED", "CANCELLED", "NOT_AUTHORIZED", "NOT_REPAIRED"]) {
      mocks.orderFindUnique.mockResolvedValue(evidenceOrder({ status, uploadTokenExpiresAt: new Date(Date.now() + 60_000) }))
      expect((await postEvidence(req("POST"), tokenParams)).status).toBe(404)
    }
    expect(mocks.photoCreate).not.toHaveBeenCalled()
  })
})

/* ---------- Dominio: rotación del token en updateRepair ---------- */

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
const domainOrder = (over: Record<string, unknown> = {}) => ({
  id: "o1", businessId: "biz", number: 7, version: 3, status: "IN_REPAIR",
  customerId: "cust-1", customerPhone: "8112345678", customerPhoneAlt: null,
  quoteCents: null, approvedQuoteCents: 50000, diagnosticFeeCents: null,
  closedWithoutRepair: false, currentBranchId: "b1", uploadToken: "tok-viejo",
  ...over,
})
let op = 0
const payload = (over: Record<string, unknown>) => ({ idempotencyKey: `token-op-${++op}`, expectedVersion: 3, ...over })

beforeEach(() => {
  tx.user.findUnique.mockResolvedValue(admin)
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.repairOrder.findUniqueOrThrow.mockResolvedValue(domainOrder())
  tx.repairOrder.updateMany.mockResolvedValue({ count: 1 })
  tx.repairPart.findMany.mockResolvedValue([])
  tx.repairPart.updateMany.mockResolvedValue({ count: 0 })
  tx.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } })
  tx.cashMovement.groupBy.mockResolvedValue([])
})

describe("STATUS→CANCELLED rota el token de evidencias", () => {
  it("escribe uploadToken nuevo y vigencia — el QR impreso muere", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(domainOrder({ status: "IN_REPAIR" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "CANCELLED", detail: "El cliente se arrepintió" }))
    const update = tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(update.data.status).toBe("CANCELLED")
    expect(typeof update.data.uploadToken).toBe("string")
    expect(update.data.uploadToken).not.toBe("tok-viejo")
    expect(update.data.uploadTokenExpiresAt).toBeInstanceOf(Date)
    expect((update.data.uploadTokenExpiresAt as Date).getTime()).toBeGreaterThan(Date.now())
  })

  it("STATUS→NOT_REPAIRED NO rota: la orden sigue abierta hasta la entrega", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(domainOrder({ status: "IN_REPAIR" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "NOT_REPAIRED", detail: "No tuvo reparación" }))
    const update = tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(update.data.status).toBe("NOT_REPAIRED")
    expect(update.data.uploadToken).toBeUndefined()
    expect(update.data.uploadTokenExpiresAt).toBeUndefined()
  })

  it("otros cambios de etapa no tocan el token", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(domainOrder({ status: "IN_REPAIR" }))
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "STATUS", status: "QUALITY_CHECK", detail: "Pasa a revisión" }))
    const update = tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(update.data.uploadToken).toBeUndefined()
  })
})

describe("ROTATE_UPLOAD_TOKEN (solo admin)", () => {
  it("regenera el token y deja un evento privado", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(domainOrder())
    await updateRepair(db, "admin-1", "biz", "o1", payload({ action: "ROTATE_UPLOAD_TOKEN" }))
    const update = tx.repairOrder.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(typeof update.data.uploadToken).toBe("string")
    expect(update.data.uploadToken).not.toBe("tok-viejo")
    expect((update.data.uploadTokenExpiresAt as Date).getTime()).toBeGreaterThan(Date.now())
    const event = tx.repairEvent.create.mock.calls[0][0] as { data: { type: string; detail: string; isPublic: boolean } }
    expect(event.data.detail).toContain("Se regeneró el link de evidencias")
    expect(event.data.isPublic).toBe(false)
  })

  it("un empleado recibe 403 antes de tocar la orden", async () => {
    tx.user.findUnique.mockResolvedValue({ ...admin, id: "emp-1", role: "EMPLOYEE" })
    await expect(updateRepair(db, "emp-1", "biz", "o1", payload({ action: "ROTATE_UPLOAD_TOKEN" })))
      .rejects.toMatchObject({ status: 403 })
    expect(tx.repairOrder.findUnique).not.toHaveBeenCalled()
  })

  it("en orden cerrada la rotación queda bloqueada", async () => {
    tx.repairOrder.findUnique.mockResolvedValue(domainOrder({ status: "CANCELLED" }))
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "ROTATE_UPLOAD_TOKEN" })))
      .rejects.toMatchObject({ status: 409, message: "La orden está cerrada. El historial se conserva." })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })

  it("una llave ya usada con otro contenido se rechaza (recibo idempotente)", async () => {
    // La llave existe pero el hash del payload no coincide: la operación no
    // vuelve a ejecutar el trabajo — un reintento no rota el token dos veces.
    tx.businessOperation.findUnique.mockResolvedValue({
      actorId: "admin-1", kind: "REPAIR_UPDATE", businessId: "biz",
      requestHash: "hash-de-otra-peticion", response: {},
    })
    await expect(updateRepair(db, "admin-1", "biz", "o1", payload({ action: "ROTATE_UPLOAD_TOKEN" })))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" })
    expect(tx.repairOrder.updateMany).not.toHaveBeenCalled()
  })
})
