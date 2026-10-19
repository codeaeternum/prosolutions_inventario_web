import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /api/actividad/desempeno — la producción por empleado: `ventas` es el
 * importe neto cobrado (total de catálogo − discountCents), igual que la
 * serie de reportes. Antes se atribuía el precio de lista aunque el cobro
 * hubiera salido con descuento autorizado.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFind: vi.fn(),
  saleFind: vi.fn(),
  orderFind: vi.fn(),
  movementGroup: vi.fn(),
  auditGroup: vi.fn(),
  opGroup: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFind },
    sale: { findMany: mocks.saleFind },
    repairOrder: { findMany: mocks.orderFind },
    inventoryMovement: { groupBy: mocks.movementGroup },
    auditEvent: { groupBy: mocks.auditGroup },
    businessOperation: { groupBy: mocks.opGroup },
  },
}))

import { GET } from "@/app/api/actividad/desempeno/route"

const adminSession = { user: { id: "u-admin", name: "Dueño", role: "ADMIN", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(adminSession)
  mocks.userFind.mockResolvedValue([
    { id: "emp-1", name: "Kevin", role: "EMPLOYEE", jobTitle: null },
    { id: "u-admin", name: "Dueño", role: "ADMIN", jobTitle: null },
  ])
  mocks.saleFind.mockResolvedValue([])
  mocks.orderFind.mockResolvedValue([])
  mocks.movementGroup.mockResolvedValue([])
  mocks.auditGroup.mockResolvedValue([])
  mocks.opGroup.mockResolvedValue([])
})

describe("desempeño por empleado", () => {
  it("ventas suma lo cobrado neto y cuenta piezas con devoluciones restadas", async () => {
    mocks.saleFind.mockResolvedValue([
      // $1,000 de catálogo con $250 de descuento → $750 cobrados.
      { sellerId: "emp-1", total: 1000, discountCents: 25000, items: [{ quantity: 3, returnedQuantity: 1 }] },
      { sellerId: "emp-1", total: 100, discountCents: 0, items: [{ quantity: 1, returnedQuantity: 0 }] },
    ])
    const res = await GET(new Request("http://localhost/api/actividad/desempeno?dias=7") as never)
    expect(res.status).toBe(200)
    const { usuarios } = await res.json()
    const kevin = usuarios.find((u: { id: string }) => u.id === "emp-1")
    expect(kevin).toMatchObject({ ventas: 850, ventasCount: 2, piezasVendidas: 3 })
    // El query trae discountCents junto con el total.
    expect(mocks.saleFind).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ discountCents: true, total: true }),
    }))
  })

  it("un empleado sin ventas aparece con ceros", async () => {
    const res = await GET(new Request("http://localhost/api/actividad/desempeno?dias=30") as never)
    const { usuarios } = await res.json()
    const kevin = usuarios.find((u: { id: string }) => u.id === "emp-1")
    expect(kevin).toMatchObject({ ventas: 0, ventasCount: 0 })
  })
})
