import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * PATCH /api/marketplace/requests/:id — decisión del proveedor:
 *
 * - requireModule("mercado") es el gate base pero aprobar/rechazar/surtir es
 *   decisión de ADMIN: un EMPLOYEE con el módulo recibe 403 antes de leer.
 * - FULFILL de un solicitante WORKSHOP de OTRO tenant exige una cuenta local
 *   (su userId no existe como cliente en este negocio — actor() lo tumbaría
 *   y la solicitud quedaba wedge en APPROVED).
 * - Precio de taller nulo/cero y surtido repetido tienen respuestas claras.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findRequest: vi.fn(),
  findOrThrow: vi.fn(),
  updateMany: vi.fn(),
  branchFind: vi.fn(),
  sell: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketplaceRequest: {
      findUnique: mocks.findRequest,
      findUniqueOrThrow: mocks.findOrThrow,
      updateMany: mocks.updateMany,
    },
    branch: { findFirst: mocks.branchFind },
  },
}))
vi.mock("@/lib/domain/sales", () => ({ sell: mocks.sell }))

import { PATCH } from "@/app/api/marketplace/requests/[id]/route"

const BIZ = "biz-proveedor"
const admin = { user: { id: "u-admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, allowedModules: [] } }
const employee = { user: { id: "u-emp", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, allowedModules: ["mercado"] } }

const patchReq = (body: unknown) =>
  new Request("https://app.invalid/api/marketplace/requests/mr-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
const params = { params: Promise.resolve({ id: "mr-1" }) }

const approvedRequest = (over: Record<string, unknown> = {}) => ({
  id: "mr-1", businessId: BIZ, productId: "p1", qty: 2, status: "APPROVED", saleId: null,
  product: { wholesalePrice: 800 },
  requestedBy: null,
  sale: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin)
  mocks.findRequest.mockResolvedValue(approvedRequest())
  mocks.findOrThrow.mockResolvedValue({ id: "mr-1", status: "FULFILLED" })
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.branchFind.mockResolvedValue({ id: "b1" })
  mocks.sell.mockResolvedValue({ sale: { id: "sale-1", number: 42 } })
})

describe("rol: solo ADMIN decide", () => {
  it("un EMPLOYEE con módulo mercado recibe 403 sin leer la solicitud", async () => {
    mocks.auth.mockResolvedValue(employee)
    const res = await PATCH(patchReq({ action: "APPROVE" }), params)
    expect(res.status).toBe(403)
    expect(mocks.findRequest).not.toHaveBeenCalled()
  })

  it("ADMIN aprueba una PENDING y queda decidedBy ligado", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({ status: "PENDING" }))
    const res = await PATCH(patchReq({ action: "APPROVE", decisionNote: "Sin problema" }), params)
    expect(res.status).toBe(200)
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ status: "PENDING" }]),
      }),
      data: expect.objectContaining({ status: "APPROVED", decidedById: "u-admin" }),
    }))
  })
})

describe("REJECT desde APPROVED", () => {
  it("una aprobada sin venta ligada puede rechazarse (saleId null)", async () => {
    const res = await PATCH(patchReq({ action: "REJECT", decisionNote: "Ya no hay" }), params)
    expect(res.status).toBe(200)
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ["PENDING", "APPROVED"] },
        OR: expect.arrayContaining([{ saleId: null }, { sale: { is: { status: "VOIDED" } } }]),
      }),
      data: expect.objectContaining({ status: "REJECTED", decisionNote: "Ya no hay" }),
    }))
  })
})

describe("FULFILL", () => {
  it("producto sin precio de taller responde 400 claro, sin abrir la venta", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({ product: { wholesalePrice: 0 } }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)
    expect(res.status).toBe(400)
    expect(mocks.sell).not.toHaveBeenCalled()
  })

  it("solicitante WORKSHOP del MISMO tenant carga la venta a su cuenta por defecto", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      requestedBy: { id: "w-local", role: "WORKSHOP", businessId: BIZ },
    }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "CREDITO" }), params)
    expect(res.status).toBe(200)
    expect(mocks.sell).toHaveBeenCalledWith(expect.anything(), "u-admin", BIZ,
      expect.objectContaining({ customerId: "w-local", priceTier: "wholesale", workshopSale: true }),
      expect.objectContaining({ commitHook: expect.any(Function) }))
  })

  it("solicitante WORKSHOP de OTRO tenant exige cuenta local explícita", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      requestedBy: { id: "w-ext", role: "WORKSHOP", businessId: "biz-otro" },
    }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("cuenta local")
    expect(mocks.sell).not.toHaveBeenCalled()
  })

  it("con cuenta local explícita el surtido externo sí procede", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      requestedBy: { id: "w-ext", role: "WORKSHOP", businessId: "biz-otro" },
    }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO", customerId: "w-local" }), params)
    expect(res.status).toBe(200)
    expect(mocks.sell).toHaveBeenCalledWith(expect.anything(), "u-admin", BIZ,
      expect.objectContaining({ customerId: "w-local" }),
      expect.objectContaining({ commitHook: expect.any(Function) }))
  })

  it("la venta del surtido siempre se documenta como venta a taller", async () => {
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)
    expect(res.status).toBe(200)
    expect(mocks.sell).toHaveBeenCalledWith(expect.anything(), "u-admin", BIZ,
      expect.objectContaining({ workshopSale: true }),
      expect.objectContaining({ commitHook: expect.any(Function) }))
  })

  it("la llave de idempotencia es por intento de aprobación: reactivar tras anular no reutiliza la venta VOIDED", async () => {
    const firstApproval = new Date("2026-01-10T15:00:00.000Z")
    const secondApproval = new Date("2026-01-12T15:00:00.000Z")
    mocks.findRequest
      .mockResolvedValueOnce(approvedRequest({ decidedAt: firstApproval }))
      .mockResolvedValueOnce(approvedRequest({ decidedAt: secondApproval }))

    await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)
    await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)

    const keys = mocks.sell.mock.calls.map(call => call[3].idempotencyKey)
    expect(keys).toEqual([
      `mkt-fulfill-mr-1-${firstApproval.getTime()}`,
      `mkt-fulfill-mr-1-${secondApproval.getTime()}`,
    ])
    expect(keys[0]).not.toBe("mkt-fulfill-mr-1")
    expect(keys[1]).not.toBe(keys[0])
  })

  it("el commitHook liga la solicitud dentro de la venta y aborta si ya fue decidida", async () => {
    const decidedAt = new Date("2026-01-10T15:00:00.000Z")
    mocks.findRequest.mockResolvedValue(approvedRequest({ decidedAt }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO", decisionNote: "Entregada" }), params)
    expect(res.status).toBe(200)
    const options = mocks.sell.mock.calls[0][4]

    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    await options.commitHook(
      { marketplaceRequest: { updateMany } },
      { sale: { id: "sale-1", number: 42 } },
    )
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "mr-1",
        status: "APPROVED",
        decidedAt,
        OR: expect.arrayContaining([{ saleId: null }, { sale: { is: { status: "VOIDED" } } }]),
      }),
      data: expect.objectContaining({ status: "FULFILLED", saleId: "sale-1", decisionNote: "Entregada" }),
    }))

    // count 0 significa que un REJECT/APPROVE concurrente ganó la fila: el
    // error sale de la transacción de sell() y revierte la venta completa.
    updateMany.mockResolvedValue({ count: 0 })
    await expect(options.commitHook(
      { marketplaceRequest: { updateMany } },
      { sale: { id: "sale-1", number: 42 } },
    )).rejects.toMatchObject({ status: 409 })
  })

  it("REJECT con una venta vigente ligada responde 409 sin tocar la solicitud", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      status: "APPROVED", saleId: "sale-1",
      sale: { id: "sale-1", number: 42, status: "COMPLETED" },
    }))
    const res = await PATCH(patchReq({ action: "REJECT" }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain("venta vigente")
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it("reintentar una solicitud ya FULFILLED con venta vigente devuelve éxito idempotente", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      status: "FULFILLED", saleId: "sale-1",
      sale: { id: "sale-1", number: 42, status: "COMPLETED" },
    }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.idempotent).toBe(true)
    expect(body.saleNumber).toBe(42)
    expect(mocks.sell).not.toHaveBeenCalled()
  })

  it("FULFILLED con venta VOIDED ya no reintenta como éxito: pide re-aprobar", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      status: "FULFILLED", saleId: "sale-1",
      sale: { id: "sale-1", number: 42, status: "VOIDED" },
    }))
    const res = await PATCH(patchReq({ action: "FULFILL", paymentMethod: "EFECTIVO" }), params)
    expect(res.status).toBe(409)
    expect(mocks.sell).not.toHaveBeenCalled()
  })

  it("APPROVE rescata una FULFILLED cuya venta quedó VOIDED", async () => {
    mocks.findRequest.mockResolvedValue(approvedRequest({
      status: "FULFILLED", saleId: "sale-1",
      sale: { id: "sale-1", number: 42, status: "VOIDED" },
    }))
    const res = await PATCH(patchReq({ action: "APPROVE" }), params)
    expect(res.status).toBe(200)
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { status: "PENDING" },
          { status: "FULFILLED", sale: { is: { status: "VOIDED" } } },
        ]),
      }),
      data: expect.objectContaining({ status: "APPROVED", saleId: null }),
    }))
  })
})
