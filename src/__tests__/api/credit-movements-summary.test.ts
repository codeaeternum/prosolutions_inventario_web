import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/credit/movements?summary=true — aging FIFO de los top-20 deudores.
 *
 * Antes se materializaba TODO el historial de cada deudor para el FIFO.
 * Ahora la ventana detallada se acota a 24 meses y el historial anterior se
 * resume como saldo de apertura por usuario (groupBy); si los abonos viejos
 * no cubren los cargos viejos, esos cargos sí se traen para que la
 * antigüedad siga siendo exacta.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userAggregate: vi.fn(),
  userCount: vi.fn(),
  userFindMany: vi.fn(),
  creditAgg: vi.fn(),
  creditFindMany: vi.fn(),
  creditGroupBy: vi.fn(),
  businessFindUnique: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      aggregate: mocks.userAggregate,
      count: mocks.userCount,
      findMany: mocks.userFindMany,
    },
    creditMovement: {
      aggregate: mocks.creditAgg,
      findMany: mocks.creditFindMany,
      groupBy: mocks.creditGroupBy,
    },
    business: { findUnique: mocks.businessFindUnique },
  },
}))

import { GET } from "@/app/api/credit/movements/route"

const BIZ = "biz-test"
const admin = { user: { id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ } }
const summary = () => GET(new Request("https://app.invalid/api/credit/movements?summary=true") as never)
const debtor = (id: string, balance: number) => ({ id, name: `Cliente ${id}`, phone: null, creditLimit: 0, creditBalance: balance })

// Filas configurables por llamada: la ruta usa creditMovement.findMany para
// (a) los 30 movimientos recientes del panel, (b) la ventana de 24 meses y
// (c) los cargos viejos descubiertos (where.type === "DEBT").
let windowRows: unknown[] = []
let oldDebtRows: unknown[] = []

beforeEach(() => {
  vi.clearAllMocks()
  windowRows = []
  oldDebtRows = []
  mocks.auth.mockResolvedValue(admin)
  mocks.userAggregate.mockResolvedValue({ _sum: { creditBalance: 0 } })
  mocks.userCount.mockResolvedValue(0)
  mocks.creditAgg.mockResolvedValue({ _sum: { amount: 0 } })
  mocks.userFindMany.mockResolvedValue([])
  mocks.businessFindUnique.mockResolvedValue({ name: "Taller" })
  mocks.creditGroupBy.mockResolvedValue([])
  mocks.creditFindMany.mockImplementation((args: { take?: number; where?: { type?: string } }) => {
    if (args.take === 30) return Promise.resolve([]) // recientes del panel
    if (args.where?.type === "DEBT") return Promise.resolve(oldDebtRows)
    return Promise.resolve(windowRows)
  })
})

describe("ventana de 24 meses + saldo de apertura", () => {
  it("las filas detalladas se acotan al cutoff y el pre-periodo se agrega por usuario", async () => {
    mocks.userFindMany.mockResolvedValue([debtor("u1", 100)])
    await summary()

    const windowCall = mocks.creditFindMany.mock.calls
      .map(([a]) => a)
      .find((a) => a.where?.createdAt && !a.take)
    expect(windowCall.where.userId).toEqual({ in: ["u1"] })
    expect(windowCall.where.businessId).toBe(BIZ)
    expect(windowCall.orderBy).toEqual({ createdAt: "asc" })
    // El cutoff es ~24 meses atrás (no el histórico completo).
    const cutoff = windowCall.where.createdAt.gte as Date
    expect(cutoff).toBeInstanceOf(Date)
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(700 * 24 * 60 * 60 * 1000)
    expect(Date.now() - cutoff.getTime()).toBeLessThan(760 * 24 * 60 * 60 * 1000)

    // El saldo de apertura viene del groupBy ANTES del cutoff.
    const pre = mocks.creditGroupBy.mock.calls[0][0]
    expect(pre.by).toEqual(["userId", "type"])
    expect(pre.where.createdAt).toEqual({ lt: cutoff })
    expect(pre.where.userId).toEqual({ in: ["u1"] })
    // Solo cargos positivos + todos los abonos/reversos (mismo filtro que el FIFO).
    expect(pre.where.OR).toEqual([{ type: { not: "DEBT" } }, { amount: { gt: 0 } }])
  })

  it("abonos viejos que cubren los cargos viejos entran como crédito neto (aging exacto)", async () => {
    // u1: antes del cutoff cargó $1000 y abonó $1400 → crédito neto $400.
    // En la ventana cargó $500 hace ~20 días → $100 sin cubrir → "16-30".
    mocks.userFindMany.mockResolvedValue([debtor("u1", 100)])
    mocks.creditGroupBy.mockResolvedValue([
      { userId: "u1", type: "DEBT", _sum: { amount: 1000 } },
      { userId: "u1", type: "PAYMENT", _sum: { amount: 1400 } },
    ])
    const recentDebtAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
    windowRows = [{ userId: "u1", type: "DEBT", amount: 500, createdAt: recentDebtAt }]

    const body = await (await summary()).json()
    const aging = body.debtors[0].aging
    expect(aging.bucket).toBe("16-30")
    expect(aging.oldestDebtAt).toBe(recentDebtAt.toISOString())
    // Al estar cubierto el pre-periodo, NO se traen filas viejas detalladas.
    expect(mocks.creditFindMany.mock.calls.filter(([a]) => a.where?.type === "DEBT")).toHaveLength(0)
  })

  it("cargos viejos NO cubiertos se traen íntegros: la antigüedad real no se pierde", async () => {
    // u1: antes del cutoff cargó $2000 y solo abonó $500 → descubierto.
    mocks.userFindMany.mockResolvedValue([debtor("u1", 1500)])
    mocks.creditGroupBy.mockResolvedValue([
      { userId: "u1", type: "DEBT", _sum: { amount: 2000 } },
      { userId: "u1", type: "PAYMENT", _sum: { amount: 500 } },
    ])
    const oldDebtAt = new Date(Date.now() - 30 * 30.5 * 24 * 60 * 60 * 1000) // ~30 meses
    oldDebtRows = [
      { userId: "u1", type: "DEBT", amount: 1200, createdAt: oldDebtAt },
      { userId: "u1", type: "DEBT", amount: 800, createdAt: new Date(oldDebtAt.getTime() + 86400000) },
    ]

    const body = await (await summary()).json()
    // La consulta de rescate trae solo DEBT positivos pre-cutoff del usuario.
    const rescue = mocks.creditFindMany.mock.calls.map(([a]) => a).find((a) => a.where?.type === "DEBT")
    expect(rescue.where).toMatchObject({ businessId: BIZ, userId: { in: ["u1"] }, amount: { gt: 0 } })
    expect(rescue.where.createdAt).toHaveProperty("lt")

    // El abono viejo ($500) cubre parcialmente el cargo más viejo → la
    // antigüedad es la del cargo de hace ~30 meses, no una de 24 meses.
    const aging = body.debtors[0].aging
    expect(aging.bucket).toBe("30+")
    expect(aging.oldestDebtAt).toBe(oldDebtAt.toISOString())
    expect(aging.daysOverdue).toBeGreaterThan(800)
  })

  it("sin deudores no consulta el historial de movimientos", async () => {
    const body = await (await summary()).json()
    expect(body.debtors).toEqual([])
    // Solo la consulta de recientes del panel (take 30); ni ventana ni groupBy.
    expect(mocks.creditFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.creditGroupBy).not.toHaveBeenCalled()
  })
})
