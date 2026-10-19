import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { createMarketplaceRequest } from "@/lib/domain/marketplace"

/**
 * Solicitudes al mercado B2B: la fila se crea con el tenant del PROVEEDOR
 * (dueño del producto) y el recibo idempotente en el tenant del comprador.
 * Cubre las tres guardias anti-duplicado y el pedido atómico con encargo:
 *
 * 1. `idempotencyKey` → replay devuelve el recibo guardado sin re-ejecutar.
 * 2. Cliente viejo sin llave propia → dedupe por (solicitante, producto,
 *    PENDING) devuelve la solicitud ya abierta.
 * 3. Con `encargoId` la deduplicación fuerte es la liga encargo → solicitud
 *    y la transición a ORDERED corre en la MISMA transacción serializable:
 *    si el encargo no admite el salto, la solicitud tampoco confirma.
 *
 * El dominio corre sobre un tx falso (db.$transaction entrega el mock); el
 * rollback real lo garantiza la serializable — aquí se comprueba que el
 * recibo nunca se asienta cuando la transición falla.
 */
const BUYER_BIZ = "biz-comprador"
const SELLER_BIZ = "biz-proveedor"
const admin = { id: "u-staff", name: "Mostrador", role: "ADMIN", status: "APPROVED", businessId: BUYER_BIZ }
const product = { id: "p1", name: "Pantalla iPhone 12", businessId: SELLER_BIZ }
let seq = 0
const key = () => `marketplace-test-${++seq}`
// Mismo hash que operation(): sha256 del payload tal como lo arma el dominio
// (el parse de zod emite las llaves en el orden del schema).
const hash = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex")

const tx = {
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  product: { findFirst: vi.fn() },
  encargo: { findFirst: vi.fn(), updateMany: vi.fn() },
  marketplaceRequest: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  auditEvent: { create: vi.fn() },
}
const db = { ...tx, $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const pendingEncargo = {
  id: "e1", businessId: BUYER_BIZ, status: "PENDING", description: "Pantalla",
  branchId: "b1", branch: { id: "b1", name: "Matriz" }, customer: null,
  customerId: null, marketplaceRequestId: null,
}
const baseInput = { productId: "p1", qty: 2, tallerName: "Refacciones Galindo" }

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(admin)
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.product.findFirst.mockResolvedValue(product)
  tx.encargo.findFirst.mockResolvedValue(null)
  tx.marketplaceRequest.findFirst.mockResolvedValue(null)
  tx.marketplaceRequest.findUnique.mockResolvedValue(null)
  tx.marketplaceRequest.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: "mr-1", status: "PENDING", ...args.data }))
  tx.auditEvent.create.mockResolvedValue({})
})

describe("alta de solicitud", () => {
  it("crea la fila en el tenant del PROVEEDOR y el recibo en el del comprador", async () => {
    const result = await createMarketplaceRequest(db, "u-staff", BUYER_BIZ, { ...baseInput, idempotencyKey: key() })
    expect(tx.marketplaceRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: SELLER_BIZ, productId: "p1", qty: 2,
        tallerName: "Refacciones Galindo", requestedById: "u-staff",
      }),
    }))
    expect(tx.businessOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: "u-staff", businessId: BUYER_BIZ, kind: "MARKETPLACE_REQUEST" }),
    }))
    expect(result).toMatchObject({ deduplicated: false, encargo: null })
    expect(result.request.id).toBe("mr-1")
  })

  it("un producto fuera del catálogo de aliados responde 404 sin escribir", async () => {
    tx.product.findFirst.mockResolvedValue(null)
    await expect(createMarketplaceRequest(db, "u-staff", BUYER_BIZ, { ...baseInput, idempotencyKey: key() }))
      .rejects.toMatchObject({ status: 404 })
    expect(tx.marketplaceRequest.create).not.toHaveBeenCalled()
    expect(tx.businessOperation.update).not.toHaveBeenCalled()
  })
})

describe("idempotencia por llave", () => {
  it("repetir con la MISMA llave devuelve el recibo guardado sin tocar el catálogo", async () => {
    const opKey = key()
    const stored = { request: { id: "mr-9", status: "PENDING" }, deduplicated: false, encargo: null, operationId: "op-9" }
    tx.businessOperation.findUnique.mockResolvedValue({
      key: opKey, actorId: "u-staff", kind: "MARKETPLACE_REQUEST", businessId: BUYER_BIZ,
      requestHash: hash({ idempotencyKey: opKey, productId: "p1", qty: 2, tallerName: "Refacciones Galindo" }),
      response: stored,
    })
    const result = await createMarketplaceRequest(db, "u-staff", BUYER_BIZ, {
      idempotencyKey: opKey, productId: "p1", qty: 2, tallerName: "Refacciones Galindo",
    })
    expect(result).toEqual(stored)
    // Ni el producto ni la solicitud se volvieron a tocar.
    expect(tx.product.findFirst).not.toHaveBeenCalled()
    expect(tx.marketplaceRequest.create).not.toHaveBeenCalled()
    expect(tx.businessOperation.create).not.toHaveBeenCalled()
  })

  it("la misma llave con otro producto/cantidad es conflicto, no una segunda solicitud", async () => {
    const opKey = key()
    tx.businessOperation.findUnique.mockResolvedValue({
      key: opKey, actorId: "u-staff", kind: "MARKETPLACE_REQUEST", businessId: BUYER_BIZ,
      requestHash: hash({ idempotencyKey: opKey, productId: "p1", qty: 5, tallerName: "Refacciones Galindo" }),
      response: {},
    })
    await expect(createMarketplaceRequest(db, "u-staff", BUYER_BIZ, {
      idempotencyKey: opKey, productId: "p1", qty: 2, tallerName: "Refacciones Galindo",
    })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" })
    expect(tx.marketplaceRequest.create).not.toHaveBeenCalled()
  })
})

describe("dedupe para clientes sin llave propia", () => {
  it("devuelve la solicitud PENDING ya abierta del mismo solicitante+producto", async () => {
    const existing = { id: "mr-previa", status: "PENDING", productId: "p1" }
    tx.marketplaceRequest.findFirst.mockResolvedValue(existing)
    const result = await createMarketplaceRequest(db, "u-staff", BUYER_BIZ, { ...baseInput, idempotencyKey: key() })
    expect(tx.marketplaceRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestedById: "u-staff", productId: "p1", status: "PENDING" }),
    }))
    expect(tx.marketplaceRequest.create).not.toHaveBeenCalled()
    expect(result).toMatchObject({ deduplicated: true })
    expect(result.request.id).toBe("mr-previa")
  })
})

describe("pedido atómico con encargoId", () => {
  it("crea la solicitud Y pasa el encargo a ORDERED ligando marketplaceRequestId en la misma tx", async () => {
    tx.encargo.findFirst.mockResolvedValue(pendingEncargo)
    tx.encargo.updateMany.mockResolvedValue({ count: 1 })
    const result = await createMarketplaceRequest(db, "u-staff", BUYER_BIZ, {
      ...baseInput, idempotencyKey: key(), encargoId: "e1", supplierNote: "Pedida a Taller Aliado",
    })
    expect(tx.marketplaceRequest.create).toHaveBeenCalledOnce()
    expect(tx.encargo.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "e1", status: "PENDING" },
      data: expect.objectContaining({ status: "ORDERED", marketplaceRequestId: "mr-1", supplierNote: "Pedida a Taller Aliado" }),
    }))
    expect(result.encargo).toMatchObject({ encargoId: "e1", status: "ORDERED", marketplaceRequestId: "mr-1" })
    // La dedupe por producto NO corre: cada encargo pide su propia pieza.
    expect(tx.marketplaceRequest.findFirst).not.toHaveBeenCalled()
    // El avance queda en la bitácora con antes/después.
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "ENCARGO_STATUS", entityId: "e1" }),
    }))
  })

  it("un encargo ya pedido devuelve SU solicitud ligada — no abre otra ni reordena", async () => {
    tx.encargo.findFirst.mockResolvedValue({ ...pendingEncargo, status: "ORDERED", marketplaceRequestId: "mr-old" })
    tx.marketplaceRequest.findUnique.mockResolvedValue({ id: "mr-old", status: "PENDING" })
    const result = await createMarketplaceRequest(db, "u-staff", BUYER_BIZ, {
      ...baseInput, idempotencyKey: key(), encargoId: "e1",
    })
    expect(result.deduplicated).toBe(true)
    expect(result.request.id).toBe("mr-old")
    expect(result.encargo).toMatchObject({ encargoId: "e1", status: "ORDERED", marketplaceRequestId: "mr-old" })
    expect(tx.marketplaceRequest.create).not.toHaveBeenCalled()
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
  })

  it("un encargo ajeno o inexistente responde 404 y no escribe nada", async () => {
    tx.encargo.findFirst.mockResolvedValue(null)
    await expect(createMarketplaceRequest(db, "u-staff", BUYER_BIZ, { ...baseInput, idempotencyKey: key(), encargoId: "e-ajeno" }))
      .rejects.toMatchObject({ status: 404 })
    expect(tx.marketplaceRequest.create).not.toHaveBeenCalled()
    expect(tx.businessOperation.update).not.toHaveBeenCalled()
  })

  it("si el encargo no admite ORDERED falla TODO: el recibo nunca se asienta", async () => {
    // DELIVERED → ORDERED es salto inválido. En la serializable real la
    // solicitud recién creada se revierte junto con el recibo; aquí se
    // comprueba que el error propaga y que businessOperation.update —que
    // sella el recibo— jamás corrió.
    tx.encargo.findFirst.mockResolvedValue({ ...pendingEncargo, status: "DELIVERED" })
    await expect(createMarketplaceRequest(db, "u-staff", BUYER_BIZ, { ...baseInput, idempotencyKey: key(), encargoId: "e1" }))
      .rejects.toMatchObject({ status: 409, code: "ENCARGO_BAD_TRANSITION" })
    expect(tx.encargo.updateMany).not.toHaveBeenCalled()
    expect(tx.businessOperation.update).not.toHaveBeenCalled()
  })

  it("una cuenta WORKSHOP no puede pedir con encargo (trabajo de mostrador)", async () => {
    tx.user.findUnique.mockResolvedValue({ id: "u-ws", role: "WORKSHOP", status: "APPROVED", businessId: BUYER_BIZ })
    await expect(createMarketplaceRequest(db, "u-ws", BUYER_BIZ, { ...baseInput, idempotencyKey: key(), encargoId: "e1" }))
      .rejects.toMatchObject({ status: 403 })
    expect(tx.product.findFirst).not.toHaveBeenCalled()
  })
})
