import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Contrato del centro de mando /api/platform/overview: solo el superadmin
 * (operador Reficio) puede leer los KPIs globales y la salud por negocio —
 * y nunca se toca la base de datos sin pasar antes por requireSuperAdmin.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  businessCount: vi.fn(),
  businessFindMany: vi.fn(),
  userCount: vi.fn(),
  userGroup: vi.fn(),
  orderCount: vi.fn(),
  orderGroup: vi.fn(),
  saleCount: vi.fn(),
  saleAggregate: vi.fn(),
  saleGroup: vi.fn(),
  productCount: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: { count: mocks.businessCount, findMany: mocks.businessFindMany },
    user: { count: mocks.userCount, groupBy: mocks.userGroup },
    repairOrder: { count: mocks.orderCount, groupBy: mocks.orderGroup },
    sale: { count: mocks.saleCount, aggregate: mocks.saleAggregate, groupBy: mocks.saleGroup },
    product: { count: mocks.productCount },
  },
}))

import { GET as overview } from "@/app/api/platform/overview/route"

const superAdmin = { user: { id: "op", role: "ADMIN", status: "APPROVED", customerType: "NORMAL", businessId: "biz-reficio", isSuperAdmin: true } }
const tenantAdmin = { user: { id: "t1", role: "ADMIN", status: "APPROVED", customerType: "NORMAL", businessId: "biz-tenant", isSuperAdmin: false } }

describe("platform overview API", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("answers 401 without a session and 403 for non-superadmin sessions, without touching the db", async () => {
    for (const [session, expected] of [
      [null, 401],
      [tenantAdmin, 403],
      [{ user: { ...tenantAdmin.user, status: "PENDING" } }, 403],
      [{ user: { ...tenantAdmin.user, role: "EMPLOYEE" } }, 403],
    ] as const) {
      mocks.auth.mockResolvedValue(session)
      expect((await overview()).status).toBe(expected)
    }
    expect(mocks.businessCount).not.toHaveBeenCalled()
    expect(mocks.userCount).not.toHaveBeenCalled()
    expect(mocks.orderCount).not.toHaveBeenCalled()
    expect(mocks.saleCount).not.toHaveBeenCalled()
  })

  it("returns global KPIs and per-business health for the superadmin", async () => {
    mocks.auth.mockResolvedValue(superAdmin)

    // KPIs: los count/aggregate se resuelven en el orden del Promise.all.
    mocks.businessCount
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(7) // active
      .mockResolvedValueOnce(2) // newLast30d
    mocks.userCount
      .mockResolvedValueOnce(25) // total
      .mockResolvedValueOnce(4) // pendingApprovals
    mocks.userGroup
      .mockResolvedValueOnce([ // byRole
        { role: "ADMIN", _count: { _all: 3 } },
        { role: "EMPLOYEE", _count: { _all: 8 } },
        { role: "CUSTOMER", _count: { _all: 14 } },
      ])
      .mockResolvedValueOnce([{ businessId: "b1", _count: { _all: 5 } }]) // health usersCount
      .mockResolvedValueOnce([{ businessId: "b1", _count: { _all: 2 } }]) // health pendingUsers
    mocks.orderCount
      .mockResolvedValueOnce(40) // total
      .mockResolvedValueOnce(12) // openNow
      .mockResolvedValueOnce(5) // last7d
    mocks.saleCount.mockResolvedValueOnce(30)
    mocks.saleAggregate.mockResolvedValue({ _sum: { total: 12345 }, _count: { _all: 9 } })
    mocks.productCount.mockResolvedValue(77)

    // Actividad: b1 más reciente que b2 (orden y venta se combinan).
    mocks.orderGroup
      .mockResolvedValueOnce([ // _max createdAt por negocio
        { businessId: "b1", _max: { createdAt: new Date("2026-02-10T00:00:00Z") } },
        { businessId: "b2", _max: { createdAt: new Date("2026-01-05T00:00:00Z") } },
      ])
      .mockResolvedValueOnce([{ businessId: "b1", _count: { _all: 4 } }]) // health ordersCount
    mocks.saleGroup
      .mockResolvedValueOnce([{ businessId: "b2", _max: { createdAt: new Date("2026-01-20T00:00:00Z") } }])
      .mockResolvedValueOnce([{ businessId: "b1", _count: { _all: 6 } }]) // health salesLast30d

    // Menos de 50 con actividad → rellena con las altas más recientes (b3),
    // luego lee las filas del bloque de salud (devueltas desordenadas:
    // el orden lo marca el ranking de actividad, no el findMany).
    mocks.businessFindMany
      .mockResolvedValueOnce([{ id: "b3" }])
      .mockResolvedValueOnce([
        { id: "b3", name: "Refacciones Nueva", slug: "ref-nueva", category: "parts-store", isActive: true, createdAt: new Date("2026-02-15T00:00:00Z") },
        { id: "b1", name: "Taller Uno", slug: "taller-uno", category: "electronics-repair", isActive: true, createdAt: new Date("2025-12-01T00:00:00Z") },
        { id: "b2", name: "Taller Dos", slug: "taller-dos", category: "electronics-repair", isActive: false, createdAt: new Date("2025-11-01T00:00:00Z") },
      ])

    const res = await overview()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("no-store")

    const body = await res.json()
    expect(body.businesses).toEqual({ total: 10, active: 7, inactive: 3, newLast30d: 2 })
    expect(body.users).toEqual({
      total: 25,
      pendingApprovals: 4,
      byRole: { ADMIN: 3, EMPLOYEE: 8, WORKSHOP: 0, CUSTOMER: 14 },
    })
    expect(body.orders).toEqual({ total: 40, openNow: 12, last7d: 5 })
    expect(body.sales).toEqual({ countTotal: 30, sumLast30d: 12345, countLast30d: 9 })
    expect(body.products).toEqual({ total: 77 })

    // Órdenes abiertas = estados no terminales.
    expect(mocks.orderCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { notIn: ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"] } },
      }),
    )
    // La suma de ventas es solo COMPLETED en la ventana de 30 días.
    expect(mocks.saleAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "COMPLETED" }) }),
    )

    expect(body.health).toHaveLength(3)
    expect(body.health.map((h: { id: string }) => h.id)).toEqual(["b1", "b2", "b3"])
    const b1 = body.health[0]
    expect(b1).toMatchObject({
      name: "Taller Uno",
      slug: "taller-uno",
      category: "electronics-repair",
      isActive: true,
      usersCount: 5,
      ordersCount: 4,
      salesLast30d: 6,
      pendingUsers: 2,
    })
    expect(b1.lastOrderAt).toBe("2026-02-10T00:00:00.000Z")
    // Sin datos sensibles: solo agregados por negocio.
    expect(b1).not.toHaveProperty("users")
    expect(b1).not.toHaveProperty("email")
    expect(b1).not.toHaveProperty("phone")
  })

  it("answers a generic 500 when the database read fails", async () => {
    mocks.auth.mockResolvedValue(superAdmin)
    mocks.businessCount.mockRejectedValue(new Error("db down"))
    const res = await overview()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBeTruthy()
  })
})
