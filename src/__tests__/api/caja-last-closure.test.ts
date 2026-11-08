import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/caja — además del turno abierto la respuesta expone `lastClosure`,
 * el resumen del cierre más reciente en el mismo alcance de sucursal, para
 * que la UI pueda reimprimir el ticket del corte tras recargar la página.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cashRegisterFindFirst: vi.fn(),
  cashRegisterFindMany: vi.fn(),
  paymentGroupBy: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
// route.ts usa el import default de prisma; se exportan ambos por simetría.
vi.mock("@/lib/prisma", () => ({
  default: {
    cashRegister: { findFirst: mocks.cashRegisterFindFirst, findMany: mocks.cashRegisterFindMany },
    payment: { groupBy: mocks.paymentGroupBy },
  },
  prisma: {
    cashRegister: { findFirst: mocks.cashRegisterFindFirst, findMany: mocks.cashRegisterFindMany },
    payment: { groupBy: mocks.paymentGroupBy },
  },
}))

import { GET } from "@/app/api/caja/route"

const session = (id: string, role = "ADMIN", extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})
const get = (query = "") => GET(new Request(`https://app.invalid/api/caja${query}`))

// Esperado = 500 fondo + 200 IN efectivo − 60 OUT manual − 40 OUT reembolso
// (payment.amount < 0 cuenta como salida de cajón); el IN de tarjeta no suma.
const closedRegister = (over: Record<string, unknown> = {}) => ({
  id: "reg-9",
  businessId: "biz-1",
  status: "CLOSED",
  branchId: "b-1",
  initialAmount: 500,
  finalAmount: 640,
  movements: [
    { type: "IN", amount: 200, payment: { method: "CASH", amount: 200 } },
    { type: "OUT", amount: 60, payment: null },
    { type: "IN", amount: 300, payment: { method: "CARD", amount: 300 } },
    { type: "OUT", amount: 40, payment: { method: "CARD", amount: -40 } },
  ],
  ...over,
})

const openRegister = (over: Record<string, unknown> = {}) => ({
  id: "reg-10",
  businessId: "biz-1",
  status: "OPEN",
  branchId: "b-1",
  initialAmount: 0,
  openedAt: new Date("2025-06-10T15:00:00Z"),
  closedAt: null,
  branch: { id: "b-1", name: "Centro" },
  openedBy: { name: "María" },
  closedBy: null,
  movements: [],
  ...over,
})

let openRow: unknown = null
let closedRow: unknown = null

const closedCall = () =>
  mocks.cashRegisterFindFirst.mock.calls.find(c => (c[0] as { where: { status: string } }).where.status === "CLOSED")?.[0] as
    | { where: Record<string, unknown>; orderBy: Record<string, unknown> }
    | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session("u-admin"))
  openRow = null
  closedRow = null
  mocks.cashRegisterFindFirst.mockImplementation((args: { where: { status: string } }) =>
    Promise.resolve(args.where.status === "OPEN" ? openRow : closedRow))
  mocks.paymentGroupBy.mockResolvedValue([])
  mocks.cashRegisterFindMany.mockResolvedValue([])
})

describe("acceso", () => {
  it("sin sesión responde 401 sin consultar la base", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(401)
    expect(mocks.cashRegisterFindFirst).not.toHaveBeenCalled()
  })

  it("empleado pidiendo sucursal ajena recibe 403 sin consultar cierres", async () => {
    mocks.auth.mockResolvedValue(session("e-1", "EMPLOYEE", { allowedBranchIds: ["b-1"], allowedModules: ["caja"] }))
    const res = await get("?branchId=b-2")
    expect(res.status).toBe(403)
    expect(mocks.cashRegisterFindFirst).not.toHaveBeenCalled()
  })
})

describe("lastClosure", () => {
  it("sin caja abierta devuelve active:false con el resumen del último cierre", async () => {
    closedRow = closedRegister()
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active).toBe(false)
    expect(body.lastClosure).toEqual({
      registerId: "reg-9",
      counted: 640,
      expected: 600,
      difference: 40,
    })
  })

  it("con turno abierto también expone lastClosure (reimprimir con caja en curso)", async () => {
    openRow = openRegister()
    closedRow = closedRegister()
    const res = await get("?branchId=b-1")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active).toBe(true)
    expect(body.register.id).toBe("reg-10")
    expect(body.lastClosure.registerId).toBe("reg-9")
  })

  it("sin cierres en la sucursal devuelve lastClosure null", async () => {
    const body = await (await get()).json()
    expect(body.active).toBe(false)
    expect(body.lastClosure).toBeNull()
  })

  it("el cierre se busca acotado a la sucursal pedida y ordenado por closedAt desc", async () => {
    await get("?branchId=b-2")
    const call = closedCall()
    expect(call?.where).toEqual({ businessId: "biz-1", status: "CLOSED", branchId: "b-2" })
    expect(call?.orderBy).toEqual({ closedAt: "desc" })
  })

  it("empleado sin branchId queda acotado a sus sucursales asignadas", async () => {
    mocks.auth.mockResolvedValue(session("e-1", "EMPLOYEE", { allowedBranchIds: ["b-1", "b-3"], allowedModules: ["caja"] }))
    await get()
    expect(closedCall()?.where.branchId).toEqual({ in: ["b-1", "b-3"] })
  })

  it("la vista de semana no dispara la consulta del último cierre", async () => {
    await get("?view=week")
    // La rama week usa findMany, no findFirst: ninguna consulta de OPEN/CLOSED.
    expect(mocks.cashRegisterFindFirst).not.toHaveBeenCalled()
  })
})
