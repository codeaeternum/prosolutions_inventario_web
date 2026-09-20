import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/products — alta de producto (usado por la captura rápida):
 *
 * - Idempotencia: misma idempotencyKey devuelve el recibo guardado y NO
 *   vuelve a crear el producto ni el movimiento de stock.
 * - El recibo y la escritura se confirman en la misma $transaction; una
 *   operación que falla (p.ej. barcode duplicado) no deja recibo.
 * - El stock inicial entra a la sucursal destino vía BranchStock +
 *   InventoryMovement en la misma operación.
 * - Permisos: empleado sin el módulo "productos" recibe 403.
 */

const BIZ = "biz-test"
const BRANCH = { id: "b1", name: "Matriz", isActive: true, businessId: BIZ }

const mocks = vi.hoisted(() => {
  // Recibos de BusinessOperation persistidos "en BD"; una operación que
  // aborta (throw dentro de work) no deja fila — se emula omitiendo la fila
  // hasta que update() escribe la respuesta.
  const store = new Map<string, Record<string, unknown>>()
  const prisma = {
    category: { findFirst: vi.fn() },
    model: { count: vi.fn() },
    branch: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    businessOperation: {
      findUnique: vi.fn(async ({ where }: any) => {
        const row = store.get(where.key)
        // Recibo "completo" = con response escrita (el update post-work).
        return row && row.response && Object.keys(row.response as object).length > 0 ? row : null
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `op-${store.size + 1}`, ...data }
        store.set(data.key, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        for (const row of store.values()) if (row.id === where.id) Object.assign(row, data)
        return {}
      }),
    },
    product: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
    },
    branchStock: { upsert: vi.fn<(args: any) => Promise<Record<string, never>>>(async () => ({})) },
    inventoryMovement: { create: vi.fn<(args: any) => Promise<Record<string, never>>>(async () => ({})) },
    $transaction: vi.fn(async (work: any) => work(prisma)),
    $extends: vi.fn(),
  }
  return { auth: vi.fn(), prisma, store }
})

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { POST } from "@/app/api/products/route"

const adminSession = () => ({
  user: { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, customerType: "NORMAL" },
})
const staffRow = { id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: "b1" }

const validBody = (over: Record<string, unknown> = {}) => ({
  name: "Pantalla iPhone 11",
  barcode: "SCR-AP-I11",
  retailPrice: 1200,
  wholesalePrice: 900,
  costPrice: 600,
  stock: 5,
  categoryId: "cat-1",
  isUniversal: true,
  stockBranchId: "b1",
  idempotencyKey: "captura-test-key-1",
  ...over,
})

const post = (payload: unknown) =>
  POST(
    new Request("https://app.invalid/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  )

beforeEach(() => {
  mocks.store.clear()
  vi.clearAllMocks()
  // clearAllMocks conserva implementaciones; se repiten las stateful por claridad.
  mocks.prisma.$transaction.mockImplementation(async (work: any) => work(mocks.prisma))
  mocks.prisma.businessOperation.findUnique.mockImplementation(async ({ where }: any) => {
    const row = mocks.store.get(where.key)
    return row && row.response && Object.keys(row.response as object).length > 0 ? row : null
  })
  mocks.prisma.businessOperation.create.mockImplementation(async ({ data }: any) => {
    const row = { id: `op-${mocks.store.size + 1}`, ...data }
    mocks.store.set(data.key, row)
    return row
  })
  mocks.prisma.businessOperation.update.mockImplementation(async ({ where, data }: any) => {
    for (const row of mocks.store.values()) if (row.id === where.id) Object.assign(row, data)
    return {}
  })
  mocks.prisma.product.update.mockImplementation(async () => ({}))
  mocks.prisma.product.findMany.mockImplementation(async () => [])
  mocks.prisma.branchStock.upsert.mockImplementation(async () => ({}))
  mocks.prisma.inventoryMovement.create.mockImplementation(async () => ({}))

  mocks.auth.mockResolvedValue(adminSession())
  mocks.prisma.category.findFirst.mockResolvedValue({ id: "cat-1" })
  mocks.prisma.branch.findFirst.mockResolvedValue(BRANCH)
  mocks.prisma.user.findUnique.mockResolvedValue(staffRow)
  // findFirst por barcode = chequeo de duplicado (null = libre); por id es
  // releaseStock resolviendo el producto recién creado dentro de la misma tx.
  mocks.prisma.product.findFirst.mockImplementation(async ({ where }: any) =>
    where?.id ? { id: where.id, businessId: BIZ, isActive: true } : null
  )
  mocks.prisma.product.create.mockImplementation(async ({ data }: any) => ({ id: "p-new", ...data }))
})

describe("POST /api/products", () => {
  it("crea el producto y registra el stock inicial en la sucursal destino", async () => {
    const res = await post(validBody())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe("p-new")

    expect(mocks.prisma.product.create).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.branchStock.upsert).toHaveBeenCalledTimes(1)
    const upsert = mocks.prisma.branchStock.upsert.mock.calls[0][0]
    expect(upsert.create).toMatchObject({ productId: "p-new", branchId: "b1", quantity: 5 })
    expect(mocks.prisma.inventoryMovement.create).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.inventoryMovement.create.mock.calls[0][0].data).toMatchObject({
      type: "IN",
      quantity: 5,
      reason: "Stock inicial",
      branchId: "b1",
    })
  })

  it("un reintento con la misma idempotencyKey devuelve el mismo producto sin duplicar", async () => {
    const first = await post(validBody())
    const second = await post(validBody())
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const [a, b] = await Promise.all([first.json(), second.json()])
    expect(b.id).toBe(a.id)
    expect(mocks.prisma.product.create).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.inventoryMovement.create).toHaveBeenCalledTimes(1)
  })

  it("la misma llave con otro payload responde 409 (conflicto de idempotencia)", async () => {
    await post(validBody())
    const res = await post(validBody({ name: "Otra pantalla" }))
    expect(res.status).toBe(409)
    expect(mocks.prisma.product.create).toHaveBeenCalledTimes(1)
  })

  it("rechaza barcode duplicado dentro de la operación y no deja recibo", async () => {
    mocks.prisma.product.findFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { id: where.id, businessId: BIZ, isActive: true } : where?.barcode ? { id: "p-old" } : null
    )
    const res = await post(validBody())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("código de barras")
    expect(mocks.prisma.product.create).not.toHaveBeenCalled()
    // El recibo quedó "abortado": un retry con la misma llave puede corregir el código.
    mocks.prisma.product.findFirst.mockImplementation(async ({ where }: any) =>
      where?.id ? { id: where.id, businessId: BIZ, isActive: true } : null
    )
    const retry = await post(validBody({ barcode: "SCR-AP-I11B" }))
    expect(retry.status).toBe(200)
  })

  it("sin stock inicial no toca BranchStock ni crea movimiento", async () => {
    const res = await post(validBody({ stock: 0 }))
    expect(res.status).toBe(200)
    expect(mocks.prisma.branchStock.upsert).not.toHaveBeenCalled()
    expect(mocks.prisma.inventoryMovement.create).not.toHaveBeenCalled()
  })

  it("sin idempotencyKey igual crea (llave desechable del servidor)", async () => {
    const withoutKey: Record<string, unknown> = validBody()
    delete withoutKey.idempotencyKey
    const res = await post(withoutKey)
    expect(res.status).toBe(200)
    expect(mocks.prisma.product.create).toHaveBeenCalledTimes(1)
  })

  it("valida el payload: sin nombre responde 400", async () => {
    const res = await post(validBody({ name: "" }))
    expect(res.status).toBe(400)
    expect(mocks.prisma.product.create).not.toHaveBeenCalled()
  })

  it("empleado sin el módulo productos recibe 403 antes de tocar la BD", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "emp-1", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, allowedModules: ["caja"] },
    })
    const res = await post(validBody())
    expect(res.status).toBe(403)
    expect(mocks.prisma.product.create).not.toHaveBeenCalled()
  })
})
