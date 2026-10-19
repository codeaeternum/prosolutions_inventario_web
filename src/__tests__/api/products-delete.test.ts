import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * DELETE /api/products/[id] — borrado de producto:
 *
 * - El guard de reservas activas usa el set completo del dominio
 *   (PENDING, PENDING_PAYMENT, DEPOSIT_VERIFIED, APPROVED): una reserva viva
 *   a crédito o con anticipo bloquea el delete con 409 — borrarla dejaría la
 *   deuda del cliente apuntando a una fila inexistente.
 * - Solo las reservas TERMINALES se purgan con el producto; el delete se
 *   re-verifica dentro de la transacción por si una reserva nació entre el
 *   chequeo y el commit.
 * - Una FK Restrict (SaleItem, MarketplaceRequest…) aborta con 409 pidiendo
 *   desactivar el producto en lugar de borrarlo.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindUnique: vi.fn(),
  productDelete: vi.fn(),
  productModelDeleteMany: vi.fn(),
  inventoryMovementDeleteMany: vi.fn(),
  reservationCount: vi.fn(),
  reservationDeleteMany: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
// Bitácora real sobre el auditEvent mockeado; la alerta Telegram queda fuera.
vi.mock("@/lib/audit-alerts", () => ({
  ALERTED_ACTIONS: new Set(["PRODUCT_DELETE"]),
  alertSensitiveAudit: vi.fn(async () => {}),
  escapeAlertHtml: (v: string) => v,
  notifyOwner: vi.fn(async () => false),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: mocks.productFindUnique },
    auditEvent: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}))

import { DELETE } from "@/app/api/products/[id]/route"

// El tx que la ruta recibe dentro de $transaction.
const tx = {
  productModel: { deleteMany: mocks.productModelDeleteMany },
  inventoryMovement: { deleteMany: mocks.inventoryMovementDeleteMany },
  reservation: { count: mocks.reservationCount, deleteMany: mocks.reservationDeleteMany },
  product: { delete: mocks.productDelete },
}

const session = (id = "u-admin", role = "ADMIN", extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const productRow = (reservations: unknown[] = []) => ({
  id: "p1",
  name: "Pantalla iPhone 11",
  retailPrice: 1200,
  reservations,
})

const del = (id = "p1") =>
  DELETE(new NextRequest(`https://app.invalid/api/products/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.productFindUnique.mockResolvedValue(productRow())
  mocks.reservationCount.mockResolvedValue(0)
  mocks.reservationDeleteMany.mockResolvedValue({ count: 0 })
  mocks.productModelDeleteMany.mockResolvedValue({ count: 0 })
  mocks.inventoryMovementDeleteMany.mockResolvedValue({ count: 0 })
  mocks.productDelete.mockResolvedValue({})
  mocks.auditCreate.mockResolvedValue({})
  mocks.transaction.mockImplementation((work: (t: unknown) => unknown) => work(tx))
})

describe("acceso", () => {
  it("rechaza sin sesión y a empleados sin el módulo inventario", async () => {
    for (const s of [
      null,
      session("u1", "EMPLOYEE", { allowedModules: ["caja"] }),
      session("u2", "CUSTOMER"),
    ]) {
      mocks.auth.mockResolvedValue(s)
      const res = await del()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("reservas activas", () => {
  it.each(["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"])(
    "409 cuando el producto tiene una reserva %s (p. ej. a crédito)",
    async (status) => {
      mocks.productFindUnique.mockResolvedValue(
        productRow([{ id: "r1", status, paymentMethod: "CREDIT" }])
      )
      const res = await del()
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toContain("reservas activas")
      expect(json.error).toContain("desactiva")
      // Ni la tx ni el delete corrieron: reserva y deuda quedan intactas.
      expect(mocks.transaction).not.toHaveBeenCalled()
      expect(mocks.reservationDeleteMany).not.toHaveBeenCalled()
      expect(mocks.productDelete).not.toHaveBeenCalled()
    }
  )

  it("la consulta filtra por TODO el set de reservas activas del dominio", async () => {
    await del()
    const include = mocks.productFindUnique.mock.calls[0][0].include.reservations.where.status.in
    expect(include).toEqual(
      expect.arrayContaining(["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"])
    )
  })

  it("re-verifica dentro de la tx: una reserva creada durante el delete bloquea con 409", async () => {
    mocks.reservationCount.mockResolvedValue(1)
    const res = await del()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain("reservas activas")
    // La tx abortó: no se purgaron reservas ni se borró el producto.
    expect(mocks.reservationDeleteMany).not.toHaveBeenCalled()
    expect(mocks.productDelete).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})

describe("borrado exitoso", () => {
  it("con solo reservas terminales borra el producto y purga SOLO las terminales", async () => {
    // El include filtra activas: con pura historia COMPLETED/CANCELLED llega vacío.
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })

    expect(mocks.reservationDeleteMany).toHaveBeenCalledTimes(1)
    const where = mocks.reservationDeleteMany.mock.calls[0][0].where
    expect(where.productId).toBe("p1")
    expect(where.businessId).toBe("biz-1")
    expect(where.status.in).toEqual(
      expect.arrayContaining(["COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"])
    )
    for (const active of ["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"]) {
      expect(where.status.in).not.toContain(active)
    }

    expect(mocks.productModelDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.inventoryMovementDeleteMany).toHaveBeenCalledTimes(1)
    expect(mocks.productDelete).toHaveBeenCalledWith({ where: { id: "p1", businessId: "biz-1" } })

    // Bitácora PRODUCT_DELETE con el nombre del producto.
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit).toMatchObject({
      businessId: "biz-1",
      actorId: "u-admin",
      action: "PRODUCT_DELETE",
      entity: "product",
      entityId: "p1",
      entityName: "Pantalla iPhone 11",
    })
  })
})

describe("llaves foráneas Restrict", () => {
  it.each(["P2003", "P2014"])(
    "%s (ventas/solicitudes asociadas) responde 409 pidiendo desactivar",
    async (code) => {
      mocks.productDelete.mockRejectedValue(Object.assign(new Error("FK violation"), { code }))
      const res = await del()
      expect(res.status).toBe(409)
      const json = await res.json()
      expect(json.error).toContain("ventas o solicitudes")
      expect(json.error).toContain("Desactívalo")
      // La tx se revirtió completa; no queda rastro de un delete a medias.
      expect(mocks.auditCreate).not.toHaveBeenCalled()
    }
  )

  it("un error que no es de FK sigue siendo 500", async () => {
    mocks.productDelete.mockRejectedValue(new Error("connection lost"))
    const res = await del()
    expect(res.status).toBe(500)
  })
})
