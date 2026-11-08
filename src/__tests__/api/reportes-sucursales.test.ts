import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/reports/sucursales — comparador de sucursales.
 *
 * Las ventas son lo COBRADO neto (Sale.total de catálogo − discountCents
 * autorizado), la misma convención que la serie de /api/reports y nómina:
 * antes se sumaba el bruto y el comparador inflaba el vendido respecto a
 * lo que realmente entró a caja.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  branchFind: vi.fn(),
  saleGroup: vi.fn(),
  saleItemFind: vi.fn(),
  movementFind: vi.fn(),
  stockGroup: vi.fn(),
  orderGroup: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    branch: { findMany: mocks.branchFind },
    sale: { groupBy: mocks.saleGroup },
    saleItem: { findMany: mocks.saleItemFind },
    inventoryMovement: { findMany: mocks.movementFind },
    // groupBy se usa dos veces (piezas totales y productos distintos).
    branchStock: { groupBy: mocks.stockGroup },
    repairOrder: { groupBy: mocks.orderGroup },
  },
}))

import type { NextRequest } from "next/server"
import { GET } from "@/app/api/reports/sucursales/route"

const admin = {
  user: {
    id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: "biz-test",
    customerType: "NORMAL", allowedModules: [], allowedBranchIds: [],
  },
}
const nx = (req: Request) => req as unknown as NextRequest
const get = (url = "https://app.invalid/api/reports/sucursales") => GET(nx(new Request(url)))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin)
  mocks.branchFind.mockResolvedValue([{ id: "b1", name: "Matriz" }, { id: "b2", name: "Suc" }])
  mocks.saleGroup.mockResolvedValue([])
  mocks.saleItemFind.mockResolvedValue([])
  mocks.movementFind.mockResolvedValue([])
  mocks.stockGroup.mockResolvedValue([])
  mocks.orderGroup.mockResolvedValue([])
})

describe("ventas por sucursal", () => {
  it("el importe es el cobrado neto: catálogo menos descuento autorizado", async () => {
    mocks.saleGroup.mockResolvedValue([
      { branchId: "b1", _sum: { total: 1000, discountCents: 15000 }, _count: { _all: 4 } },
      { branchId: "b2", _sum: { total: 500, discountCents: 0 }, _count: { _all: 2 } },
    ])
    const res = await get()
    expect(res.status).toBe(200)
    const { branches } = await res.json()
    const b1 = branches.find((b: { id: string }) => b.id === "b1")
    // $1000 − $150 = $850 netos — no los $1000 de catálogo.
    expect(b1.ventas).toBe(850)
    expect(b1.ventasCount).toBe(4)
    // Ticket promedio sobre el neto: 85000c / 4 = $212.50.
    expect(b1.ticketPromedio).toBe(212.5)
    // La consulta pide el descuento junto con el total.
    expect(mocks.saleGroup).toHaveBeenCalledWith(expect.objectContaining({
      _sum: expect.objectContaining({ total: true, discountCents: true }),
    }))
    // Costos y ventas: la respuesta no es cacheable.
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })
})

describe("mermas por sucursal", () => {
  it("la consulta ya viene recortada a las sucursales comparadas (o sin sucursal)", async () => {
    await get()
    const where = mocks.movementFind.mock.calls[0][0].where
    expect(where.OR).toEqual([{ branchId: { in: ["b1", "b2"] } }, { branchId: null }])
  })

  it("una merma sin sucursal se atribuye a la principal comparada", async () => {
    mocks.movementFind.mockResolvedValue([
      { branchId: null, quantity: 3, product: { costPrice: 10 } },
      { branchId: "b2", quantity: 2, product: { costPrice: 5.5 } },
    ])
    const { branches } = await (await get()).json()
    // b1 es la primera activa del negocio → absorbe los movimientos sin sucursal.
    expect(branches.find((b: { id: string }) => b.id === "b1").mermas).toBe(3)
    expect(branches.find((b: { id: string }) => b.id === "b1").mermasCosto).toBe(30)
    expect(branches.find((b: { id: string }) => b.id === "b2").mermasCosto).toBe(11)
  })
})
