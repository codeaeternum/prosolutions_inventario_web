import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Paginación de staff en getPlatformBusinessDetail: la consola sirve 50 por
 * página con `skip/take` sobre el MISMO where (ADMIN/EMPLOYEE/WORKSHOP) y
 * corrige páginas fuera de rango sirviendo la última válida.
 */
const mocks = vi.hoisted(() => ({
  businessFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  orderFindMany: vi.fn(),
  orderFindFirst: vi.fn(),
  saleFindMany: vi.fn(),
  saleFindFirst: vi.fn(),
  saleAggregate: vi.fn(),
  eventFindMany: vi.fn(),
  folioDigits: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: { findUnique: mocks.businessFindUnique },
    user: { findMany: mocks.userFindMany, count: mocks.userCount },
    repairOrder: { findMany: mocks.orderFindMany, findFirst: mocks.orderFindFirst },
    sale: { findMany: mocks.saleFindMany, aggregate: mocks.saleAggregate, findFirst: mocks.saleFindFirst },
    platformEvent: { findMany: mocks.eventFindMany },
  },
}))
vi.mock("@/lib/settings", () => ({ getOrderFolioDigits: mocks.folioDigits }))

import { getPlatformBusinessDetail } from "@/lib/platform"

const business = {
  id: "biz-1",
  name: "Taller Uno",
  slug: "taller-uno",
  category: "Reparación",
  isActive: true,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
  businessKind: "FULL",
  showInDirectory: true,
  phone: null,
  address: null,
  logoUrl: null,
  _count: { users: 120, products: 0, repairOrders: 0, sales: 0, branches: 1 },
}

function staffUser(n: number) {
  return {
    id: `u${n}`,
    name: `User ${n}`,
    email: `u${n}@x.test`,
    role: "EMPLOYEE",
    status: "APPROVED",
    jobTitle: null,
    isSuperAdmin: false,
    createdAt: new Date("2026-01-01"),
  }
}

describe("getPlatformBusinessDetail staff pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.businessFindUnique.mockResolvedValue(business)
    mocks.orderFindMany.mockResolvedValue([])
    mocks.orderFindFirst.mockResolvedValue(null)
    mocks.saleFindMany.mockResolvedValue([])
    mocks.saleFindFirst.mockResolvedValue(null)
    mocks.saleAggregate.mockResolvedValue({ _sum: { total: 0, discountCents: 0 } })
    mocks.eventFindMany.mockResolvedValue([])
    mocks.folioDigits.mockResolvedValue(6)
  })

  it("serves page 1 by default with take 50 and no skip", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser(1)])
    mocks.userCount.mockResolvedValue(120)
    const detail = await getPlatformBusinessDetail("biz-1")
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 })
    )
    expect(detail?.usersPage).toBe(1)
    expect(detail?.usersPerPage).toBe(50)
    expect(detail?.usersTotal).toBe(120)
  })

  it("offsets by page: page 3 skips 100", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser(101)])
    mocks.userCount.mockResolvedValue(120)
    await getPlatformBusinessDetail("biz-1", 3)
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 100 })
    )
  })

  it("clamps garbage input to page 1", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser(1)])
    mocks.userCount.mockResolvedValue(120)
    for (const bad of [0, -4, Number.NaN]) {
      mocks.userFindMany.mockClear()
      const detail = await getPlatformBusinessDetail("biz-1", bad)
      expect(mocks.userFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 })
      )
      expect(detail?.usersPage).toBe(1)
    }
  })

  it("re-serves the last valid page when the requested page is beyond the end", async () => {
    // Página 9 de 120 usuarios → vacío; debe releer la página 3 (101–120).
    mocks.userFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([staffUser(101)])
    mocks.userCount.mockResolvedValue(120)
    const detail = await getPlatformBusinessDetail("biz-1", 9)
    expect(mocks.userFindMany).toHaveBeenCalledTimes(2)
    expect(mocks.userFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 50, skip: 100 })
    )
    expect(detail?.usersPage).toBe(3)
    expect(detail?.users).toHaveLength(1)
  })

  it("keeps page 1 when staff is legitimately empty (no refetch)", async () => {
    mocks.userFindMany.mockResolvedValue([])
    mocks.userCount.mockResolvedValue(0)
    const detail = await getPlatformBusinessDetail("biz-1", 5)
    expect(mocks.userFindMany).toHaveBeenCalledTimes(1)
    expect(detail?.usersPage).toBe(5)
    expect(detail?.users).toHaveLength(0)
  })

  it("clamps usersPerPage to [1, 100] with default 50", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser(1)])
    mocks.userCount.mockResolvedValue(120)

    // Por encima del máximo permitido → 100.
    let detail = await getPlatformBusinessDetail("biz-1", 1, 500)
    expect(mocks.userFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 100 })
    )
    expect(detail?.usersPerPage).toBe(100)

    // Un tamaño válido se respeta tal cual.
    detail = await getPlatformBusinessDetail("biz-1", 1, 10)
    expect(mocks.userFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 10 })
    )
    expect(detail?.usersPerPage).toBe(10)

    // Cero/negativo → mínimo 1; no numérico → default 50.
    detail = await getPlatformBusinessDetail("biz-1", 1, 0)
    expect(mocks.userFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 1 })
    )
    detail = await getPlatformBusinessDetail("biz-1", 1, Number.NaN)
    expect(mocks.userFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 50 })
    )
    expect(detail?.usersPerPage).toBe(50)
  })

  it("offsets by both params: page 2 with perPage 10 skips 10", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser(11)])
    mocks.userCount.mockResolvedValue(95)
    const detail = await getPlatformBusinessDetail("biz-1", 2, 10)
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 10 })
    )
    expect(detail?.usersPage).toBe(2)
    expect(detail?.users).toHaveLength(1)
  })
})
