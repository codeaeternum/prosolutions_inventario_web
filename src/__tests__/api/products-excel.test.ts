import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NextRequest } from "next/server"

/**
 * POST /api/products/excel — importación masiva de productos.
 *
 * Se mockean auth() (sesión ADMIN), prisma (prefetch en lote de categorías y
 * productos), lib/domain/operations (transaction corre el trabajo sobre un tx
 * stub; releaseStock/takeStock devuelven una sucursal), low-stock, audit y el
 * módulo xlsx (sheet_to_json devuelve las filas del archivo "subido").
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  categoryFindMany: vi.fn(),
  productFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  txProductUpdate: vi.fn(),
  txProductCreate: vi.fn(),
  txFindUniqueOrThrow: vi.fn(),
  txMovementCreate: vi.fn(),
  transaction: vi.fn(),
  releaseStock: vi.fn(),
  takeStock: vi.fn(),
  syncLowStock: vi.fn(),
  recordAudit: vi.fn(),
  sheetToJson: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    category: { findMany: mocks.categoryFindMany },
    product: { findMany: mocks.productFindMany },
    user: { findUnique: mocks.userFindUnique },
  },
}))
vi.mock("@/lib/domain/operations", () => ({
  BusinessError: class BusinessError extends Error {},
  transaction: mocks.transaction,
  releaseStock: mocks.releaseStock,
  takeStock: mocks.takeStock,
}))
vi.mock("@/lib/low-stock", () => ({ syncLowStockAlerts: mocks.syncLowStock }))
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }))
vi.mock("xlsx", () => ({
  read: vi.fn(() => ({ SheetNames: ["Hoja1"], Sheets: { Hoja1: {} } })),
  utils: {
    sheet_to_json: mocks.sheetToJson,
    json_to_sheet: vi.fn(),
    book_new: vi.fn(),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn(),
}))

import { POST } from "@/app/api/products/excel/route"

const tx = {
  product: {
    update: mocks.txProductUpdate,
    create: mocks.txProductCreate,
    findUniqueOrThrow: mocks.txFindUniqueOrThrow,
  },
  inventoryMovement: { create: mocks.txMovementCreate },
}

const session = () => ({ user: { id: "u-admin", role: "ADMIN", status: "APPROVED", businessId: "biz-1" } })

const post = (rows: Record<string, unknown>[], fileSize = 128) => {
  mocks.sheetToJson.mockReturnValue(rows)
  const file = { name: "productos.xlsx", size: fileSize, arrayBuffer: async () => new ArrayBuffer(8) }
  const formData = { get: (key: string) => (key === "file" ? file : null) }
  return POST({ formData: async () => formData } as unknown as NextRequest)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session())
  mocks.userFindUnique.mockResolvedValue({ homeBranchId: null })
  mocks.categoryFindMany.mockResolvedValue([
    { id: "c-default", name: "Accesorios" },
    { id: "c-pantallas", name: "Pantallas" },
  ])
  mocks.productFindMany.mockResolvedValue([])
  mocks.transaction.mockImplementation((_db: unknown, work: (t: unknown) => unknown) => work(tx))
  mocks.txProductCreate.mockResolvedValue({ id: "p-new" })
  mocks.txProductUpdate.mockResolvedValue({})
  mocks.txFindUniqueOrThrow.mockResolvedValue({ stock: 0 })
  mocks.releaseStock.mockResolvedValue({ id: "branch-1" })
  mocks.takeStock.mockResolvedValue({ product: {}, branch: { id: "branch-1" } })
  mocks.syncLowStock.mockResolvedValue(undefined)
  mocks.recordAudit.mockResolvedValue(undefined)
})

describe("límites del archivo", () => {
  it("400 si el archivo supera 10 MB", async () => {
    const res = await post([{ Nombre: "X" }], 11 * 1024 * 1024)
    expect(res.status).toBe(400)
    expect(mocks.txProductCreate).not.toHaveBeenCalled()
  })

  it("400 si trae más de 5,000 filas", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({ Nombre: `P${i}` }))
    const res = await post(rows)
    expect(res.status).toBe(400)
    expect(mocks.txProductCreate).not.toHaveBeenCalled()
  })

  it("400 sin archivo", async () => {
    const formData = { get: () => null }
    const res = await POST({ formData: async () => formData } as unknown as NextRequest)
    expect(res.status).toBe(400)
  })
})

describe("validación por fila (sin coerción silenciosa)", () => {
  it.each([
    ["precio negativo", { Nombre: "A", "Precio Menudeo": -5 }],
    ["precio no numérico", { Nombre: "A", "Precio Menudeo": "abc" }],
    ["precio infinito", { Nombre: "A", "Precio Menudeo": "Infinity" }],
    ["mayoreo negativo", { Nombre: "A", "Precio Mayoreo": -1 }],
    ["stock negativo", { Nombre: "A", Stock: -2 }],
    ["stock no entero", { Nombre: "A", Stock: 2.5 }],
    ["stock no numérico", { Nombre: "A", Stock: "mucho" }],
    ["mínimo negativo", { Nombre: "A", "Stock Mínimo": -1 }],
  ])("rechaza la fila con %s (no crea ni actualiza)", async (_label, row) => {
    const res = await post([row])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.created).toBe(0)
    expect(body.updated).toBe(0)
    expect(body.totalErrors).toBe(1)
    expect(body.errors[0]).toContain("Fila 2")
    expect(mocks.txProductCreate).not.toHaveBeenCalled()
    expect(mocks.txProductUpdate).not.toHaveBeenCalled()
  })

  it("celdas vacías en creación caen a los defaults (precio 0, mínimo 5, activo)", async () => {
    const res = await post([{ Nombre: "Nuevo" }])
    const body = await res.json()
    expect(body.created).toBe(1)
    const data = mocks.txProductCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ retailPrice: 0, wholesalePrice: 0, minStock: 5, isActive: true, isUniversal: false })
  })
})

describe("categoría por coincidencia exacta", () => {
  it("un substring NO liga la categoría: cae a la default del negocio", async () => {
    await post([{ Nombre: "Funda", "Categoría": "pan" }]) // "pan" ⊂ "Pantallas" pero no es match
    expect(mocks.txProductCreate.mock.calls[0][0].data.categoryId).toBe("c-default")
  })

  it("el match exacto insensible a mayúsculas sí liga", async () => {
    await post([{ Nombre: "Funda", "Categoría": "pantallas" }])
    expect(mocks.txProductCreate.mock.calls[0][0].data.categoryId).toBe("c-pantallas")
  })
})

describe("actualización conserva lo ausente", () => {
  const existing = { id: "p-1", barcode: "111", stock: 3, isActive: false }

  it("columna Activo en blanco NO reactiva un producto apagado", async () => {
    mocks.productFindMany.mockResolvedValue([existing])
    const res = await post([{ ID: "p-1", Nombre: "Renombrado" }])
    expect((await res.json()).updated).toBe(1)
    const data = mocks.txProductUpdate.mock.calls[0][0].data
    expect(data).not.toHaveProperty("isActive")
    expect(data).not.toHaveProperty("retailPrice")
    expect(data.name).toBe("Renombrado")
  })

  it('Activo "Sí" sí reactiva explícitamente', async () => {
    mocks.productFindMany.mockResolvedValue([existing])
    await post([{ ID: "p-1", Nombre: "X", Activo: "Sí" }])
    expect(mocks.txProductUpdate.mock.calls[0][0].data.isActive).toBe(true)
  })

  it("Stock en blanco no mueve inventario; un número ajusta por diferencia", async () => {
    mocks.productFindMany.mockResolvedValue([existing])
    await post([{ ID: "p-1", Nombre: "X" }])
    expect(mocks.releaseStock).not.toHaveBeenCalled()
    expect(mocks.takeStock).not.toHaveBeenCalled()

    await post([{ ID: "p-1", Nombre: "X", Stock: 10 }])
    expect(mocks.releaseStock).toHaveBeenCalledWith(tx, expect.objectContaining({ productId: "p-1", quantity: 7 }))
    expect(mocks.txMovementCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "ADJUSTMENT", quantity: 7 }) })
  })
})

describe("prefetch en lote", () => {
  it("consulta productos una sola vez por IDs y códigos del archivo", async () => {
    await post([
      { ID: "p-1", Nombre: "A" },
      { ID: "p-2", Nombre: "B" },
      { Nombre: "C", "Código de Barras": "999" },
      { Nombre: "D" }, // sin ID ni código: no entra al prefetch
    ])
    expect(mocks.productFindMany).toHaveBeenCalledTimes(1)
    const where = mocks.productFindMany.mock.calls[0][0].where
    expect(where.businessId).toBe("biz-1")
    expect(where.OR).toEqual([{ id: { in: ["p-1", "p-2"] } }, { barcode: { in: ["999"] } }])
    // Y las categorías también salen en una sola consulta del tenant.
    expect(mocks.categoryFindMany).toHaveBeenCalledTimes(1)
  })
})

describe("errores de fila", () => {
  it("un P2002 se reporta como duplicado sin filtrar internals de Prisma", async () => {
    const prismaErr = Object.assign(new Error("Unique constraint failed on the fields: (`barcode`)"), { code: "P2002" })
    mocks.txProductCreate.mockRejectedValue(prismaErr)
    const res = await post([{ Nombre: "Duplicado" }])
    const body = await res.json()
    expect(body.totalErrors).toBe(1)
    expect(body.errors[0]).toContain("dato duplicado")
    expect(body.errors[0]).not.toContain("constraint")
    expect(body.errors[0]).not.toContain("barcode`")
  })

  it("una fila mala no aborta el resto del archivo", async () => {
    const res = await post([
      { Nombre: "Buena" },
      { Nombre: "Mala", "Precio Menudeo": -9 },
      { Nombre: "Otra buena" },
    ])
    const body = await res.json()
    expect(body.created).toBe(2)
    expect(body.totalErrors).toBe(1)
    expect(mocks.txProductCreate).toHaveBeenCalledTimes(2)
  })
})
