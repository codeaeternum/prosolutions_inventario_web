import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/marketplace/sugerencias — búsqueda B2B en catálogo de OTROS
 * negocios. El retailPrice es precio interno/mostrador del proveedor: ni la
 * proyección Prisma ni la respuesta pueden exponerlo al comprador externo.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindMany: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findMany: mocks.productFindMany } },
}))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: vi.fn(() => true),
  getClientIp: vi.fn(() => "test-ip"),
}))

import { GET } from "@/app/api/marketplace/sugerencias/route"

const adminSession = {
  user: { id: "u-admin", role: "ADMIN", status: "APPROVED", businessId: "biz-comprador", allowedModules: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(adminSession)
  mocks.productFindMany.mockResolvedValue([
    {
      id: "p-ext",
      name: "Pantalla A32",
      // El mock simula una fila completa de BD: aunque exista en el origen,
      // el contrato externo debe omitirla.
      retailPrice: 2500,
      wholesalePrice: 1800,
      stock: 3,
      marketVisibility: "ALLIES",
      business: { id: "biz-proveedor", name: "Refacciones Norte", slug: "norte" },
      stocks: [{ branch: { name: "Centro", isActive: true } }],
    },
  ])
})

describe("proyección externa", () => {
  it("no consulta ni devuelve retailPrice del proveedor", async () => {
    const res = await GET(new Request("https://app.invalid/api/marketplace/sugerencias?q=pantalla"))
    expect(res.status).toBe(200)

    const select = mocks.productFindMany.mock.calls[0][0].select
    expect(select).not.toHaveProperty("retailPrice")
    expect(select).toHaveProperty("wholesalePrice")

    const body = await res.json()
    expect(body.suggestions).toHaveLength(1)
    expect(body.suggestions[0]).toMatchObject({
      id: "p-ext",
      wholesalePrice: 1800,
      branchNames: ["Centro"],
      available: true,
    })
    expect(body.suggestions[0]).not.toHaveProperty("retailPrice")
  })
})
