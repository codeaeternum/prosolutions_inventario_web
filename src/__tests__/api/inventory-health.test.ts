import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindMany: vi.fn(),
  productUpdate: vi.fn(),
  branchStockGroupBy: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: mocks.productFindMany,
      update: mocks.productUpdate,
    },
    branchStock: {
      groupBy: mocks.branchStockGroupBy,
    },
    auditEvent: {
      create: mocks.auditCreate,
    },
    $transaction: mocks.transaction,
  },
}))

import { GET, POST } from "@/app/api/inventory/health/route"

describe("GET & POST /api/inventory/health — verificación y reconciliación de stock", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({
      user: { id: "u-admin", role: "ADMIN", status: "APPROVED", businessId: "biz-1" },
    })
    mocks.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
    mocks.productUpdate.mockResolvedValue({})
    mocks.auditCreate.mockResolvedValue({})
  })

  it("detecta productos cuyo Product.stock difiere de la suma de BranchStock", async () => {
    mocks.productFindMany.mockResolvedValue([
      { id: "p-ok", name: "Pantalla A54", stock: 10 },
      { id: "p-drift", name: "Batería iPhone 13", stock: 4 },
    ])
    mocks.branchStockGroupBy.mockResolvedValue([
      { productId: "p-ok", _sum: { quantity: 10 } },
      { productId: "p-drift", _sum: { quantity: 7 } },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.driftedCount).toBe(1)
    expect(json.drifted).toEqual([
      {
        productId: "p-drift",
        name: "Batería iPhone 13",
        cachedStock: 4,
        branchesStock: 7,
        diff: 3,
      },
    ])
  })

  it("reconcilia el stock en POST y registra evento en la bitácora", async () => {
    mocks.productFindMany.mockResolvedValue([
      { id: "p-drift", name: "Batería iPhone 13", stock: 4 },
    ])
    mocks.branchStockGroupBy.mockResolvedValue([
      { productId: "p-drift", _sum: { quantity: 7 } },
    ])

    const res = await POST()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.reconciledCount).toBe(1)
    expect(mocks.productUpdate).toHaveBeenCalledWith({
      where: { id: "p-drift" },
      data: { stock: 7 },
    })
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
  })
})
