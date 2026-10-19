import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/clientes — conteo de reparaciones por cliente.
 *
 * Las órdenes de taller se ligan por FK (customerId) y por teléfono
 * normalizado (customerPhone / customerPhoneAlt) para las históricas sin
 * ligar. El route agrupa en SQL por la tripleta (customerId, phone, phoneAlt)
 * — UNA consulta — y deduplica en memoria: una orden alcanzable por los dos
 * caminos cuenta una sola vez.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  repairGroupBy: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany, count: mocks.userCount },
    repairOrder: { groupBy: mocks.repairGroupBy },
  },
}))

import { GET as clientes } from "@/app/api/clientes/route"

const employee = { user: { id: "e1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-1" } }

const userRow = (over: Record<string, unknown>) => ({
  id: "c1",
  name: "Ana",
  email: null,
  phone: "55 1234 5678",
  telegramId: null,
  businessName: null,
  customerType: "NORMAL",
  creditLimit: null,
  creditBalance: 0,
  totalPurchases: 0,
  createdAt: new Date("2025-01-01"),
  _count: { reservations: 0, salesAsCustomer: 0 },
  ...over,
})

const group = (customerId: string | null, customerPhone: string | null, customerPhoneAlt: string | null, n: number) => ({
  customerId,
  customerPhone,
  customerPhoneAlt,
  _count: { _all: n },
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(employee)
  mocks.userFindMany.mockResolvedValue([])
  mocks.userCount.mockResolvedValue(0)
  mocks.repairGroupBy.mockResolvedValue([])
})

describe("agregado de órdenes de taller", () => {
  it("usa UN groupBy por (customerId, phone, phoneAlt) del tenant, sin findMany por fila", async () => {
    await clientes(new Request("https://app.invalid/api/clientes"))
    expect(mocks.repairGroupBy).toHaveBeenCalledTimes(1)
    const args = mocks.repairGroupBy.mock.calls[0][0]
    expect(args.where.businessId).toBe("biz-1")
    expect(args.by).toEqual(["customerId", "customerPhone", "customerPhoneAlt"])
  })

  it("cuenta por FK y por teléfono normalizado sin duplicar la orden ligada por ambos", async () => {
    mocks.userFindMany.mockResolvedValue([
      userRow({ id: "c1", phone: "55 1234 5678" }),
      userRow({ id: "c2", name: "Beto", phone: null }),
    ])
    mocks.repairGroupBy.mockResolvedValue([
      // 3 órdenes ligadas a c1 con un teléfono ajeno: solo cuentan por FK.
      group("c1", "8111111111", null, 3),
      // 2 órdenes sin ligar cuyo teléfono (+52 y el mismo en el campo alt)
      // normaliza al de c1: el grupo cuenta UNA vez aunque el número esté duplicado.
      group(null, "+52 55 1234 5678", "5512345678", 2),
      // 1 orden de c1 cuyo teléfono también es el de c1: llega por los dos
      // caminos (FK y teléfono) y NO debe duplicarse.
      group("c1", "5512345678", null, 1),
      // 5 órdenes de c2, teléfono no relacionado.
      group("c2", "9999999999", null, 5),
    ])

    const res = await clientes(new Request("https://app.invalid/api/clientes"))
    expect(res.status).toBe(200)
    const { clientes: list } = await res.json()
    const ana = list.find((c: { id: string }) => c.id === "c1")
    const beto = list.find((c: { id: string }) => c.id === "c2")
    // c1: |A ∪ B| = 4 (FK) + 3 (teléfono) − 1 (ambos) = 6
    expect(ana.repairsCount).toBe(6)
    // c2: sin teléfono solo suma por FK.
    expect(beto.repairsCount).toBe(5)
  })

  it("cliente sin órdenes ligadas ni por teléfono tiene repairsCount 0", async () => {
    mocks.userFindMany.mockResolvedValue([userRow({ id: "c9" })])
    mocks.repairGroupBy.mockResolvedValue([group("otro", "8111111111", null, 4)])
    const { clientes: list } = await (await clientes(new Request("https://app.invalid/api/clientes"))).json()
    expect(list[0].repairsCount).toBe(0)
  })
})
