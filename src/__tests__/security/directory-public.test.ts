import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findProducts: vi.fn(),
  findCategories: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findMany: mocks.findProducts },
    category: { findMany: mocks.findCategories },
  },
}))
import { GET as listProducts } from "@/app/api/directory/products/route"
import { GET as listCategories } from "@/app/api/directory/categories/route"

const dbRow = {
  id: "p1",
  name: "Pantalla iPhone 15",
  retailPrice: 2500,
  stock: 3,
  images: ["/uploads/p1.png"],
  category: { name: "Pantallas" },
  business: { name: "Taller Uno", slug: "taller-uno" },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findProducts.mockResolvedValue([dbRow])
  mocks.findCategories.mockResolvedValue([])
})

describe("public directory endpoints", () => {
  it("categories returns only public name+count of categories present in visible products", async () => {
    mocks.findCategories.mockResolvedValue([
      { name: "Pantallas", _count: { products: 4 } },
      { name: "Baterias", _count: { products: 9 } },
    ])
    const res = await listCategories(new Request("https://app.invalid/api/directory/categories"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.categories).toEqual([
      { name: "Baterias", count: 9 },
      { name: "Pantallas", count: 4 },
    ])
    expect(res.headers.get("cache-control")).toContain("s-maxage=60")
    // Solo categorías con productos visibles de negocios listados.
    expect(mocks.findCategories).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business: { isActive: true, showInDirectory: true },
        }),
      }),
    )
  })

  it("products browses a category with cat alone (no q required)", async () => {
    const res = await listProducts(new Request("https://app.invalid/api/directory/products?cat=Pantallas"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(mocks.findProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          marketVisibility: "PUBLIC",
          business: { isActive: true, showInDirectory: true },
          category: { name: { equals: "Pantallas", mode: "insensitive" } },
        }),
      }),
    )
    // Solo campos públicos: disponibilidad binaria, nunca stock exacto.
    expect(json.products[0]).toEqual({
      id: "p1",
      name: "Pantalla iPhone 15",
      retailPrice: 2500,
      image: "/uploads/p1.png",
      inStock: true,
      category: "Pantallas",
      business: { name: "Taller Uno", slug: "taller-uno" },
    })
  })

  it("products with q+cat filters the text inside the category", async () => {
    const res = await listProducts(
      new Request("https://app.invalid/api/directory/products?q=iphone&cat=Pantallas"),
    )
    expect(res.status).toBe(200)
    const where = mocks.findProducts.mock.calls[0][0].where
    expect(where.category).toEqual({ name: { equals: "Pantallas", mode: "insensitive" } })
    expect(where.OR).toHaveLength(3)
    expect(where.OR[0]).toEqual({ name: { contains: "iphone", mode: "insensitive" } })
  })

  it("short q without cat never reaches the database", async () => {
    const res = await listProducts(new Request("https://app.invalid/api/directory/products?q=a"))
    const json = await res.json()
    expect(json.products).toEqual([])
    expect(json.minChars).toBe(2)
    expect(mocks.findProducts).not.toHaveBeenCalled()
  })

  it("products from businesses without a valid public slug stay out", async () => {
    mocks.findProducts.mockResolvedValue([
      { ...dbRow, business: { name: "Oculto", slug: "admin" } },
    ])
    const res = await listProducts(new Request("https://app.invalid/api/directory/products?cat=Pantallas"))
    const json = await res.json()
    expect(json.products).toEqual([])
  })
})
