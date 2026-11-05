import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  saleFindMany: vi.fn(),
  saleCount: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: {
      findMany: mocks.saleFindMany,
      count: mocks.saleCount,
    },
  },
}))

import { GET } from "@/app/api/sales/route"

describe("GET /api/sales — búsqueda server-side (?q=)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({
      user: {
        id: "u-admin",
        role: "ADMIN",
        status: "APPROVED",
        businessId: "biz-1",
      },
    })
    mocks.saleFindMany.mockResolvedValue([])
    mocks.saleCount.mockResolvedValue(0)
  })

  it("interpreta folios V-000042 como búsqueda por número 42 además de texto", async () => {
    const res = await GET(new Request("https://app.invalid/api/sales?q=V-000042"))
    expect(res.status).toBe(200)
    expect(mocks.saleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: "biz-1",
          OR: expect.arrayContaining([{ number: 42 }]),
        }),
      }),
    )
  })

  it("filtra por nombre de cliente o artículo cuando q no es numérico", async () => {
    const res = await GET(new Request("https://app.invalid/api/sales?q=Pantalla"))
    expect(res.status).toBe(200)
    const where = mocks.saleFindMany.mock.calls[0]?.[0]?.where
    expect(where.businessId).toBe("biz-1")
    expect(where.OR).toEqual([
      { customer: { name: { contains: "Pantalla", mode: "insensitive" } } },
      { items: { some: { product: { name: { contains: "Pantalla", mode: "insensitive" } } } } },
      { items: { some: { product: { barcode: { contains: "Pantalla", mode: "insensitive" } } } } },
    ])
  })
})
