import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/products/photos — anexa fotos /uploads/* a productos en lote.
 *
 * Se mockean auth() (sesión), prisma (con $transaction ejecutando el callback
 * sobre un tx stub) y se usa la bitácora REAL (lib/audit → auditEvent.create
 * mockeado) para verificar que cada producto actualizado deja su evento
 * PRODUCT_UPDATE con el diff de fotos antes/después.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindMany: vi.fn(),
  productUpdate: vi.fn(),
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

import { POST } from "@/app/api/products/photos/route"

// El tx que la ruta recibe dentro de $transaction/operation().
const tx = {
  product: { update: mocks.productUpdate },
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

const img = (name: string) => `/uploads/products/${name}.png`

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Producto ${id}`,
  images: [],
  ...over,
})

const post = (body: unknown) =>
  POST(
    new Request("https://app.invalid/api/products/photos", {
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
      const res = await post({ assignments: [{ productId: "p1", images: [img("a")] }] })
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.productFindMany).not.toHaveBeenCalled()
    expect(mocks.productUpdate).not.toHaveBeenCalled()
  })

  it("empleado con el módulo inventario sí puede anexar fotos", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["inventario"] }))
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ assignments: [{ productId: "p1", images: [img("a")] }] })
    expect(res.status).toBe(200)
  })
})

describe("validación del body", () => {
  it.each([
    ["sin assignments", {}],
    ["assignments vacío", { assignments: [] }],
    ["sin images", { assignments: [{ productId: "p1" }] }],
    ["images vacío", { assignments: [{ productId: "p1", images: [] }] }],
    ["productId vacío", { assignments: [{ productId: "", images: [img("a")] }] }],
    ["productId con caracteres raros", { assignments: [{ productId: "../x y!", images: [img("a")] }] }],
    ["productId no string", { assignments: [{ productId: 42, images: [img("a")] }] }],
    ["imagen vacía", { assignments: [{ productId: "p1", images: [""] }] }],
    ["imagen sin prefijo /uploads/", { assignments: [{ productId: "p1", images: ["/otra/carpeta/x.png"] }] }],
    ["URL absoluta https", { assignments: [{ productId: "p1", images: ["https://evil.invalid/x.png"] }] }],
    ["URL absoluta http", { assignments: [{ productId: "p1", images: ["http://evil.invalid/uploads/x.png"] }] }],
    ["URL protocol-relative", { assignments: [{ productId: "p1", images: ["//evil.invalid/x.png"] }] }],
    ["path traversal", { assignments: [{ productId: "p1", images: ["/uploads/../secret.png"] }] }],
    ["traversal en medio del path", { assignments: [{ productId: "p1", images: ["/uploads/products/../../secret.png"] }] }],
    ["traversal con backslash", { assignments: [{ productId: "p1", images: ["/uploads/products/..\\secret.png"] }] }],
    ["/uploads/ sin archivo", { assignments: [{ productId: "p1", images: ["/uploads/"] }] }],
    ["imagen demasiado larga", { assignments: [{ productId: "p1", images: [`/uploads/${"a".repeat(2000)}.png`] }] }],
    ["idempotencyKey inválida", { assignments: [{ productId: "p1", images: [img("a")] }], idempotencyKey: "x" }],
  ])("400 cuando %s", async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(mocks.productFindMany).not.toHaveBeenCalled()
    expect(mocks.productUpdate).not.toHaveBeenCalled()
  })

  it("400 con más de 100 asignaciones", async () => {
    const res = await post({
      assignments: Array.from({ length: 101 }, (_, i) => ({ productId: `p${i}`, images: [img("a")] })),
    })
    expect(res.status).toBe(400)
  })

  it("400 con más de 8 imágenes en una asignación", async () => {
    const res = await post({
      assignments: [{ productId: "p1", images: Array.from({ length: 9 }, (_, i) => img(`f${i}`)) }],
    })
    expect(res.status).toBe(400)
  })

  it("400 con JSON inválido", async () => {
    const res = await POST(
      new Request("https://app.invalid/api/products/photos", { method: "POST", body: "no-json" })
    )
    expect(res.status).toBe(400)
  })
})

describe("anexar fotos", () => {
  it("agrega al final conservando orden y deduplica contra las existentes y dentro del lote", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1", { images: [img("a"), img("b")] })])
    const res = await post({ assignments: [{ productId: "p1", images: [img("b"), img("c"), img("c"), img("d")] }] })
    expect(await res.json()).toEqual({ updated: 1, skipped: [] })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1)
    const call = mocks.productUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: "p1", businessId: "biz-1" })
    expect(call.data).toEqual({ images: [img("a"), img("b"), img("c"), img("d")] })
  })

  it("reescribe el arreglo completo (scalar list no soporta push)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    await post({ assignments: [{ productId: "p1", images: [img("a")] }] })
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ images: [img("a")] })
  })

  it("procesa varios productos en una sola llamada", async () => {
    mocks.productFindMany.mockResolvedValue([
      product("p1", { images: [img("a")] }),
      product("p2"),
    ])
    const res = await post({
      assignments: [
        { productId: "p1", images: [img("b")] },
        { productId: "p2", images: [img("x"), img("y")] },
      ],
    })
    expect(await res.json()).toEqual({ updated: 2, skipped: [] })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(2)
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ images: [img("a"), img("b")] })
    expect(mocks.productUpdate.mock.calls[1][0].data).toEqual({ images: [img("x"), img("y")] })
  })

  it("todas las fotos ya ligadas no escribe ni audita (cae a skipped)", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1", { images: [img("a")] })])
    const res = await post({ assignments: [{ productId: "p1", images: [img("a")] }] })
    expect(await res.json()).toEqual({ updated: 0, skipped: [{ id: "p1", reason: "sin_cambios" }] })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})

describe("aislamiento por tenant y skipped", () => {
  it("solo consulta productos activos del businessId y devuelve skipped con razón", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({
      assignments: [
        { productId: "p1", images: [img("a")] },
        { productId: "p-foreign", images: [img("b")] },
        { productId: "p-inactive", images: [img("c")] },
      ],
    })
    expect(mocks.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["p1", "p-foreign", "p-inactive"] }, businessId: "biz-1", isActive: true },
      })
    )
    expect(await res.json()).toEqual({
      updated: 1,
      skipped: [
        { id: "p-foreign", reason: "no_encontrado" },
        { id: "p-inactive", reason: "no_encontrado" },
      ],
    })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1)
  })

  it("un productId repetido en el lote corre una sola vez; la copia cae a skipped", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({
      assignments: [
        { productId: "p1", images: [img("a")] },
        { productId: "p1", images: [img("b")] },
      ],
    })
    expect(await res.json()).toEqual({
      updated: 1,
      skipped: [{ id: "p1", reason: "duplicado" }],
    })
    expect(mocks.productUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.productUpdate.mock.calls[0][0].data).toEqual({ images: [img("a")] })
  })
})

describe("tope de 12 fotos por producto", () => {
  it("la asignación que pasaría el tope se omite entera (reason limite)", async () => {
    const existing = Array.from({ length: 12 }, (_, i) => img(`e${i}`))
    mocks.productFindMany.mockResolvedValue([product("p1", { images: existing })])
    const res = await post({ assignments: [{ productId: "p1", images: [img("nueva")] }] })
    expect(await res.json()).toEqual({ updated: 0, skipped: [{ id: "p1", reason: "limite" }] })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("también se omite cuando solo cabe una parte (no guarda lista recortada)", async () => {
    const existing = Array.from({ length: 10 }, (_, i) => img(`e${i}`))
    mocks.productFindMany.mockResolvedValue([product("p1", { images: existing })])
    const res = await post({
      assignments: [{ productId: "p1", images: [img("n1"), img("n2"), img("n3")] }],
    })
    expect(await res.json()).toEqual({ updated: 0, skipped: [{ id: "p1", reason: "limite" }] })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
  })

  it("exactamente 12 sí se aplica (el tope es inclusivo)", async () => {
    const existing = Array.from({ length: 10 }, (_, i) => img(`e${i}`))
    mocks.productFindMany.mockResolvedValue([product("p1", { images: existing })])
    const res = await post({ assignments: [{ productId: "p1", images: [img("n1"), img("n2")] }] })
    expect(await res.json()).toEqual({ updated: 1, skipped: [] })
    expect(mocks.productUpdate.mock.calls[0][0].data.images).toHaveLength(12)
  })

  it("el tope se evalúa tras deduplicar: duplicados no cuentan dos veces", async () => {
    const existing = Array.from({ length: 11 }, (_, i) => img(`e${i}`))
    mocks.productFindMany.mockResolvedValue([product("p1", { images: existing })])
    const res = await post({
      assignments: [{ productId: "p1", images: [img("e0"), img("nueva")] }],
    })
    expect(await res.json()).toEqual({ updated: 1, skipped: [] })
    expect(mocks.productUpdate.mock.calls[0][0].data.images).toHaveLength(12)
  })
})

describe("bitácora", () => {
  it("graba un PRODUCT_UPDATE por producto actualizado con el diff fotos antes→después", async () => {
    mocks.productFindMany.mockResolvedValue([
      product("p1", { images: [img("a")] }),
      product("p2"),
    ])
    await post({
      assignments: [
        { productId: "p1", images: [img("b")] },
        { productId: "p2", images: [img("x")] },
      ],
    })
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
    expect(first.summary).toContain("Agregó 1 foto")
    expect(first.changes).toEqual({
      fotos: { before: [img("a")], after: [img("a"), img("b")] },
    })
    const second = mocks.auditCreate.mock.calls[1][0].data
    expect(second.entityId).toBe("p2")
  })

  it("no audita productos que cayeron a skipped", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    await post({
      assignments: [
        { productId: "p1", images: [img("a")] },
        { productId: "p-foreign", images: [img("b")] },
      ],
    })
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
  })
})

describe("idempotencia", () => {
  const key = "photos-key-123456"
  const body = { assignments: [{ productId: "p1", images: [img("a")] }] }

  it("con idempotencyKey corre dentro de operation() y devuelve operationId", async () => {
    mocks.productFindMany.mockResolvedValue([product("p1")])
    const res = await post({ ...body, idempotencyKey: key })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [], operationId: "op-1" })
    expect(mocks.userFindUnique).toHaveBeenCalled() // actor() validó al staff
    expect(mocks.bizOpCreate).toHaveBeenCalledTimes(1)
    expect(mocks.bizOpCreate.mock.calls[0][0].data).toMatchObject({
      key,
      kind: "PRODUCT_BULK_PHOTOS",
      actorId: "u-admin",
      businessId: "biz-1",
    })
  })

  it("un replay con la misma llave devuelve el recibo sin re-ejecutar", async () => {
    const receipt = {
      actorId: "u-admin",
      kind: "PRODUCT_BULK_PHOTOS",
      businessId: "biz-1",
      requestHash: sha({ assignments: body.assignments }),
      response: { updated: 1, skipped: [], operationId: "op-9" },
    }
    mocks.bizOpFindUnique.mockResolvedValue(receipt)
    const res = await post({ ...body, idempotencyKey: key })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1, skipped: [], operationId: "op-9" })
    expect(mocks.productUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("la misma llave con otro payload falla cerrado (409)", async () => {
    mocks.bizOpFindUnique.mockResolvedValue({
      actorId: "u-admin",
      kind: "PRODUCT_BULK_PHOTOS",
      businessId: "biz-1",
      requestHash: sha({ assignments: [{ productId: "otro", images: [img("z")] }] }),
      response: {},
    })
    const res = await post({ ...body, idempotencyKey: key })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("IDEMPOTENCY_CONFLICT")
  })
})
