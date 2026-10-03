import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/products/bulk — ajuste masivo de precios (set absoluto o percent).
 *
 * Se mockean auth() (sesión), prisma (con $transaction ejecutando el callback
 * sobre un tx stub) y se usa la bitácora REAL (lib/audit → auditEvent.create
 * mockeado) para verificar que cada producto actualizado deja su evento
 * PRODUCT_UPDATE con el diff antes/después.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindMany: vi.fn(),
  productUpdate: vi.fn(),
  priceHistoryCreate: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  bizOpFindUnique: vi.fn(),
  bizOpCreate: vi.fn(),
  bizOpUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
// recordAudit real persiste en el auditEvent mockeado; las alertas Telegram
// quedan fuera (importan lib/prisma perezoso y ensucian el teardown).
vi.mock("@/lib/audit-alerts", () => ({
  ALERTED_ACTIONS: new Set(["PRODUCT_UPDATE"]),
  alertSensitiveAudit: vi.fn(async () => {}),
  // operation-alerts (import perezoso de operation()) los enlaza a nivel módulo.
  escapeAlertHtml: (v: string) => v,
  notifyOwner: vi.fn(async () => false),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: mocks.productFindMany, update: mocks.productUpdate },
    priceHistory: { create: mocks.priceHistoryCreate },
    auditEvent: { create: mocks.auditCreate },
    user: { findUnique: mocks.userFindUnique },
    businessOperation: {
      findUnique: mocks.bizOpFindUnique,
      create: mocks.bizOpCreate,
      update: mocks.bizOpUpdate,
    },
    $transaction: mocks.transaction,
  },
}))

import { POST } from "@/app/api/products/bulk/route"

// El tx que la ruta recibe dentro de $transaction/operation().
const tx = {
  product: { update: mocks.productUpdate },
  priceHistory: { create: mocks.priceHistoryCreate },
  user: { findUnique: mocks.userFindUnique },
  businessOperation: {
    findUnique: mocks.bizOpFindUnique,
    create: mocks.bizOpCreate,
    update: mocks.bizOpUpdate,
  },
}

const session = (id = "u-admin", role = "ADMIN", extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Producto ${id}`,
  retailPrice: 100,
  wholesalePrice: 50,
  internalPrice: 80,
  costPrice: 30,
  ...over,
})

const post = (body: unknown) =>
  POST(
    new Request("https://app.invalid/api/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )

const sha = (payload: unknown) => createHash("sha256").update(JSON.stringify(payload)).digest("hex")

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.productFindMany.mockResolvedValue([])
  mocks.productUpdate.mockResolvedValue({})
  mocks.priceHistoryCreate.mockResolvedValue({})
  mocks.auditCreate.mockResolvedValue({})
  // actor() de operation() y el chequeo de rol de audit-alerts leen al usuario.
  mocks.userFindUnique.mockResolvedValue({ status: "APPROVED", businessId: "biz-1", role: "ADMIN", name: "Dueña" })
  mocks.bizOpFindUnique.mockResolvedValue(null)
  mocks.bizOpCreate.mockResolvedValue({ id: "op-1" })
  mocks.bizOpUpdate.mockResolvedValue({})
  mocks.transaction.mockImplementation((work: (t: unknown) => unknown) => work(tx))
})

describe("acceso", () => {
  it("rechaza sin sesión, pendientes, clientes y empleados sin el módulo", async () => {
    for (const s of [
      null,
      session("u1", "ADMIN", { status: "PENDING" }),
      session("u2", "CUSTOMER"),
      session("u3", "EMPLOYEE", { allowedModules: ["ventas"] }),
    ]) {
      mocks.auth.mockResolvedValue(s)
      const res = await post({ ids: ["p1"], percent: 10 })
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.productFindMany).not.toHaveBeenCalled()
    expect(mocks.productUpdate).not.toHaveBeenCalled()
  })

  it("empleado con el módulo inventario sí puede ajustar", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["inventario"] }))
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], percent: 10 })
    expect(res.status).toBe(200)
  })
})

describe("validación del body", () => {
  it.each([
    ["sin set ni percent", { ids: ["p1"] }],
    ["ids vacío", { ids: [], percent: 10 }],
    ["sin ids", { percent: 10 }],
    ["set y percent a la vez", { ids: ["p1"], set: { retailPrice: 10 }, percent: 10 }],
    ["set vacío", { ids: ["p1"], set: {} }],
    ["precio negativo", { ids: ["p1"], set: { retailPrice: -5 } }],
    ["internalPrice negativo", { ids: ["p1"], set: { internalPrice: -5 } }],
    ["ids no string", { ids: [1, 2], percent: 10 }],
    ["idempotencyKey inválida", { ids: ["p1"], percent: 10, idempotencyKey: "x" }],
  ])("400 cuando %s", async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(mocks.productFindMany).not.toHaveBeenCalled()
    expect(mocks.productUpdate).not.toHaveBeenCalled()
  })

  it("400 con más de 200 ids", async () => {
    const res = await post({ ids: Array.from({ length: 201 }, (_, i) => `p${i}`), percent: 5 })
    expect(res.status).toBe(400)
  })

  it("400 con JSON inválido", async () => {
    const res = await POST(
      new Request("https://app.invalid/api/products/bulk", { method: "POST", body: "no-json" })
    )
    expect(res.status).toBe(400)
  })
})

describe("modo set", () => {
  it("set parcial actualiza solo el campo presente", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], set: { retailPrice: 150 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [] })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1)
    const call = mocks.productUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: "p1", businessId: "biz-1" })
    expect(call.data).toEqual({ retailPrice: 150 })
    // Historial solo del campo cambiado.
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(1)
    expect(mocks.priceHistoryCreate.mock.calls[0][0].data).toMatchObject({
      productId: "p1",
      field: "retailPrice",
      oldValue: 100,
      newValue: 150,
    })
  })

  it("allyPrice es alias de wholesalePrice", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    await post({ ids: ["p1"], set: { allyPrice: 70 } })
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ wholesalePrice: 70 })
  })

  it("un empleado no puede mover costPrice (misma regla que el PUT)", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE"))
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], set: { retailPrice: 120, costPrice: 10 } })
    expect(res.status).toBe(200)
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ retailPrice: 120 })
    // Solo costPrice → no queda nada que cambiar → 400.
    const res2 = await post({ ids: ["p1"], set: { costPrice: 10 } })
    expect(res2.status).toBe(400)
  })

  it("set con el mismo valor no escribe ni audita (cae a skipped)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1", { retailPrice: 100 })])
    const res = await post({ ids: ["p1"], set: { retailPrice: 100 } })
    expect(await res.json()).toEqual({ updated: 0, skipped: ["p1"] })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("set internalPrice lo fija y deja historial + bitácora (taller propio)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], set: { internalPrice: 95 } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [] })
    const call = mocks.productUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: "p1", businessId: "biz-1" })
    expect(call.data).toEqual({ internalPrice: 95 })
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(1)
    expect(mocks.priceHistoryCreate.mock.calls[0][0].data).toMatchObject({
      productId: "p1",
      field: "internalPrice",
      oldValue: 80,
      newValue: 95,
    })
    // Misma llave y estilo de resumen que PUT /api/products/[id].
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit.changes).toEqual({ tallerPropio: { before: 80, after: 95 } })
    expect(audit.summary).toContain("Taller propio")
  })

  it("set internalPrice: null lo limpia (vuelve a cobrarse al público)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], set: { internalPrice: null } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [] })
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ internalPrice: null })
    // PriceHistory.newValue es Float no-nulo: la limpieza queda como 0.
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(1)
    expect(mocks.priceHistoryCreate.mock.calls[0][0].data).toMatchObject({
      field: "internalPrice",
      oldValue: 80,
      newValue: 0,
    })
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit.changes).toEqual({ tallerPropio: { before: 80, after: null } })
    expect(audit.summary).toContain("Taller propio")
  })

  it("internalPrice ausente en set no lo toca", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    await post({ ids: ["p1"], set: { retailPrice: 150 } })
    const data = mocks.productUpdate.mock.calls[0][0].data
    expect(data).toEqual({ retailPrice: 150 })
    expect(data).not.toHaveProperty("internalPrice")
    // Historial solo del campo cambiado.
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(1)
    expect(mocks.priceHistoryCreate.mock.calls[0][0].data.field).toBe("retailPrice")
  })

  it("limpiar un internalPrice ya null no escribe ni audita (cae a skipped)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1", { internalPrice: null })])
    const res = await post({ ids: ["p1"], set: { internalPrice: null } })
    expect(await res.json()).toEqual({ updated: 0, skipped: ["p1"] })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("un empleado sí puede mover internalPrice (solo costPrice es del dueño)", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE"))
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], set: { internalPrice: 60, costPrice: 10 } })
    expect(res.status).toBe(200)
    // internalPrice entra al patch; costPrice se ignora como siempre.
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ internalPrice: 60 })
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(1)
    expect(mocks.priceHistoryCreate.mock.calls[0][0].data.field).toBe("internalPrice")
  })
})

describe("modo percent", () => {
  it("+10% mueve retailPrice y wholesalePrice redondeando a 2 decimales", async () => {
    mocks.productFindMany.mockResolvedValue([
      product("p1", { retailPrice: 100, wholesalePrice: 50 }),
      product("p2", { retailPrice: 19.99, wholesalePrice: 10 }),
    ])
    const res = await post({ ids: ["p1", "p2"], percent: 10 })
    expect(await res.json()).toEqual({ updated: 2, skipped: [] })
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ retailPrice: 110, wholesalePrice: 55 })
    expect(mocks.productUpdate.mock.calls[1][0].data).toEqual({ retailPrice: 21.99, wholesalePrice: 11 })
  })

  it("salta campos con precio null y productos sin nada que mover caen a skipped", async () => {
    mocks.productFindMany.mockResolvedValue([
      product("p1", { retailPrice: 200, wholesalePrice: null }),
      product("p2", { retailPrice: null, wholesalePrice: null }),
    ])
    const res = await post({ ids: ["p1", "p2"], percent: -20 })
    expect(await res.json()).toEqual({ updated: 1, skipped: ["p2"] })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1)
    const data = mocks.productUpdate.mock.calls[0][0].data
    expect(data).toEqual({ retailPrice: 160 })
    expect(data).not.toHaveProperty("wholesalePrice")
    expect(data).not.toHaveProperty("internalPrice")
    expect(data).not.toHaveProperty("costPrice")
  })

  it("no mueve internalPrice (el taller propio sigue al costo, no al margen)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], percent: 10 })
    expect(res.status).toBe(200)
    const data = mocks.productUpdate.mock.calls[0][0].data
    expect(data).toEqual({ retailPrice: 110, wholesalePrice: 55 })
    expect(data).not.toHaveProperty("internalPrice")
    // Historial: solo los dos campos que sí se movieron.
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(2)
    expect(mocks.priceHistoryCreate.mock.calls.map((c) => c[0].data.field).sort())
      .toEqual(["retailPrice", "wholesalePrice"])
    expect(mocks.auditCreate.mock.calls[0][0].data.changes).not.toHaveProperty("tallerPropio")
  })

  it("nunca deja precios negativos: clamp a 0", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], percent: -150 })
    expect(res.status).toBe(200)
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ retailPrice: 0, wholesalePrice: 0 })
  })
})

describe("aislamiento por tenant y skipped", () => {
  it("solo consulta productos activos del businessId y devuelve skipped", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1", "p1", "p-foreign", "p-inactive"], percent: 10 })
    expect(mocks.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["p1", "p-foreign", "p-inactive"] }, businessId: "biz-1", isActive: true },
      })
    )
    expect(await res.json()).toEqual({ updated: 1, skipped: ["p-foreign", "p-inactive"] })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1) // ids duplicados no duplican updates
  })
})

describe("bitácora", () => {
  it("graba un PRODUCT_UPDATE por producto actualizado con el diff antes→después", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1"), product("p2", { retailPrice: 200 })])
    await post({ ids: ["p1", "p2"], percent: 10 })
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2)
    const first = mocks.auditCreate.mock.calls[0][0].data
    expect(first).toMatchObject({
      businessId: "biz-1",
      actorId: "u-admin",
      action: "PRODUCT_UPDATE",
      entity: "product",
      entityId: "p1",
      entityName: "Producto p1",
    })
    expect(first.summary).toContain("Ajuste masivo +10%")
    expect(first.changes).toEqual({
      precio: { before: 100, after: 110 },
      taller: { before: 50, after: 55 },
    })
    const second = mocks.auditCreate.mock.calls[1][0].data
    expect(second.entityId).toBe("p2")
    // PriceHistory: 2 campos × 2 productos.
    expect(mocks.priceHistoryCreate).toHaveBeenCalledTimes(4)
  })
})

describe("idempotencia", () => {
  const key = "bulk-key-123456"

  it("con idempotencyKey corre dentro de operation() y devuelve operationId", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ids: ["p1"], percent: 10, idempotencyKey: key })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [], operationId: "op-1" })
    expect(mocks.userFindUnique).toHaveBeenCalled() // actor() validó al staff
    expect(mocks.bizOpCreate).toHaveBeenCalledTimes(1)
    expect(mocks.bizOpCreate.mock.calls[0][0].data).toMatchObject({
      key,
      kind: "PRODUCT_BULK_PRICES",
      actorId: "u-admin",
      businessId: "biz-1",
    })
  })

  it("un replay con la misma llave devuelve el recibo sin re-ejecutar", async () => {
    const receipt = {
      actorId: "u-admin",
      kind: "PRODUCT_BULK_PRICES",
      businessId: "biz-1",
      requestHash: sha({ ids: ["p1"], percent: 10 }),
      response: { updated: 1, skipped: [], operationId: "op-9" },
    }
    mocks.bizOpFindUnique.mockResolvedValue(receipt)
    const res = await post({ ids: ["p1"], percent: 10, idempotencyKey: key })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [], operationId: "op-9" })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("la misma llave con otro payload falla cerrado (409)", async () => {
    mocks.bizOpFindUnique.mockResolvedValue({
      actorId: "u-admin",
      kind: "PRODUCT_BULK_PRICES",
      businessId: "biz-1",
      requestHash: sha({ ids: ["otro"], percent: 99 }),
      response: {},
    })
    const res = await post({ ids: ["p1"], percent: 10, idempotencyKey: key })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("IDEMPOTENCY_CONFLICT")
  })
})
