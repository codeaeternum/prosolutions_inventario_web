import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/actividad/nomina — estimado de nómina por empleado (solo ADMIN).
 *
 * Cubre: gate de permisos, clamp del periodo a 93 días, el cálculo por
 * esquema (HOURLY sobre tiempo activo, SALARY prorrateado por quincena,
 * COMMISSION sobre ventas COMPLETED netas) y que los campos de pago no se
 * filtren a un EMPLOYEE en GET /api/users ni los acepte en PATCH.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  saleFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  opFindMany: vi.fn(),
  auditRecord: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findMany: mocks.userFindMany,
      count: mocks.userCount,
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
    },
    sale: { findMany: mocks.saleFindMany },
    auditEvent: { findMany: mocks.auditFindMany },
    businessOperation: { findMany: mocks.opFindMany },
  },
}))
// La ruta de usuarios importa la bitácora completa; en el test basta una
// réplica mínima (el diff real se cubre en los tests de audit).
vi.mock("@/lib/audit", () => ({
  recordAudit: mocks.auditRecord,
  diffChanges: (before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]) => {
    const diff: Record<string, { before: unknown; after: unknown }> = {}
    for (const f of fields) {
      if (JSON.stringify(before?.[f]) !== JSON.stringify(after?.[f])) diff[f] = { before: before?.[f], after: after?.[f] }
    }
    return Object.keys(diff).length ? diff : null
  },
  listText: (value: unknown, emptyLabel = "[]") =>
    Array.isArray(value) && value.length > 0 ? `[${value.join(", ")}]` : emptyLabel,
}))

import { GET } from "@/app/api/actividad/nomina/route"
import { GET as UsersGET } from "@/app/api/users/route"
import { PATCH } from "@/app/api/users/[id]/route"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, name: "X", role, status: "APPROVED", businessId: "biz-1", ...extra },
})
const adminSession = session("u-admin", "ADMIN")

const get = (qs = "") => GET(new Request(`https://app.invalid/api/actividad/nomina${qs}`) as never)

const staffUser = (over: Record<string, unknown>) => ({
  id: "emp-1",
  name: "Kevin",
  jobTitle: "Mostrador",
  payType: "NONE",
  payRateCents: null,
  commissionPct: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(adminSession)
  mocks.userFindMany.mockResolvedValue([])
  mocks.userCount.mockResolvedValue(0)
  mocks.saleFindMany.mockResolvedValue([])
  mocks.auditFindMany.mockResolvedValue([])
  mocks.opFindMany.mockResolvedValue([])
  mocks.userFindUnique.mockResolvedValue(null)
  mocks.userUpdate.mockResolvedValue({})
})

describe("GET /api/actividad/nomina — permisos", () => {
  it("sin sesión responde 401 sin tocar la BD", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await get()
    expect(res.status).toBe(401)
    expect(mocks.userFindMany).not.toHaveBeenCalled()
  })

  it("un EMPLOYEE recibe 403 (la nómina es solo del dueño)", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["usuarios"] }))
    const res = await get()
    expect(res.status).toBe(403)
    expect(mocks.userFindMany).not.toHaveBeenCalled()
  })

  it("un CUSTOMER recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("u-cust", "CUSTOMER"))
    const res = await get()
    expect(res.status).toBe(403)
  })
})

describe("GET /api/actividad/nomina — periodo", () => {
  it("clampa `from` cuando el rango pedido excede 93 días", async () => {
    const res = await get("?from=2025-01-01&to=2026-06-30")
    expect(res.status).toBe(200)
    const { period } = await res.json()
    expect(period.to).toBe("2026-06-30")
    // 93 días naturales terminando el 2026-06-30 → from efectivo 2026-03-30.
    expect(period.from).toBe("2026-03-30")
  })

  it("rechaza 400 un rango invertido (from > to)", async () => {
    const res = await get("?from=2026-06-15&to=2026-06-01")
    expect(res.status).toBe(400)
    expect(mocks.userFindMany).not.toHaveBeenCalled()
  })

  it("sin parámetros usa los últimos ~14 días y devuelve el periodo efectivo", async () => {
    const res = await get()
    expect(res.status).toBe(200)
    const { period } = await res.json()
    expect(period.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(period.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe("GET /api/actividad/nomina — cálculo por esquema", () => {
  it("HOURLY: minutos activos/60 × tarifa por hora", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser({ payType: "HOURLY", payRateCents: 5000 })])
    // 60 min entre el primer y último movimiento del día → 1 h × $50 = $50.
    mocks.auditFindMany.mockResolvedValue([
      { actorId: "emp-1", createdAt: new Date("2026-06-10T15:00:00Z") },
      { actorId: "emp-1", createdAt: new Date("2026-06-10T16:00:00Z") },
    ])
    const res = await get("?from=2026-06-01&to=2026-06-15")
    const { employees } = await res.json()
    const kevin = employees[0]
    expect(kevin.daysActive).toBe(1)
    expect(kevin.minutesActive).toBe(60)
    expect(kevin.estimatedCents).toBe(5000)
    expect(kevin.breakdown.hourly).toEqual({ hours: 1, rateCents: 5000 })
  })

  it("SALARY: sueldo por quincena prorrateado a los días naturales del rango", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser({ payType: "SALARY", payRateCents: 450000 })])
    const res = await get("?from=2026-06-01&to=2026-06-15")
    let { employees } = await res.json()
    // Quincena completa: 15/15 días → los $4,500 íntegros.
    expect(employees[0].estimatedCents).toBe(450000)
    expect(employees[0].breakdown.salary).toEqual({ rateCents: 450000, daysInPeriod: 15, dailyRateCents: 30000 })

    const res7 = await get("?from=2026-06-01&to=2026-06-07")
    ;({ employees } = await res7.json())
    // 7 días naturales × $300/día → $2,100.
    expect(employees[0].estimatedCents).toBe(210000)
    expect(employees[0].breakdown.salary.daysInPeriod).toBe(7)
  })

  it("COMMISSION: % sobre ventas COMPLETED netas (total − discountCents)", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser({ payType: "COMMISSION", commissionPct: 10 })])
    mocks.saleFindMany.mockResolvedValue([
      // $1,000 de catálogo con $250 de descuento → $750 cobrados; más $100.
      { sellerId: "emp-1", total: 1000, discountCents: 25000 },
      { sellerId: "emp-1", total: 100, discountCents: 0 },
    ])
    const res = await get("?from=2026-06-01&to=2026-06-15")
    const { employees } = await res.json()
    const kevin = employees[0]
    expect(kevin.salesTotalCents).toBe(85000)
    expect(kevin.salesCount).toBe(2)
    expect(kevin.estimatedCents).toBe(8500)
    expect(kevin.breakdown.commission).toEqual({ pct: 10, baseCents: 85000 })
  })

  it("NONE y staff sin esquema quedan con estimado 0 y breakdown vacío", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser({})])
    const res = await get("?from=2026-06-01&to=2026-06-15")
    const { employees } = await res.json()
    expect(employees[0].estimatedCents).toBe(0)
    expect(employees[0].breakdown).toEqual({})
  })

  it("el tiempo activo suma jornadas de bitácora + operaciones por día", async () => {
    mocks.userFindMany.mockResolvedValue([staffUser({ payType: "HOURLY", payRateCents: 6000 })])
    // Día 1: 120 min vía audit; día 2: 30 min vía operación → 2.5 h × $60 = $150.
    mocks.auditFindMany.mockResolvedValue([
      { actorId: "emp-1", createdAt: new Date("2026-06-10T14:00:00Z") },
      { actorId: "emp-1", createdAt: new Date("2026-06-10T16:00:00Z") },
    ])
    mocks.opFindMany.mockResolvedValue([
      { actorId: "emp-1", createdAt: new Date("2026-06-11T16:00:00Z") },
      { actorId: "emp-1", createdAt: new Date("2026-06-11T16:30:00Z") },
    ])
    const res = await get("?from=2026-06-01&to=2026-06-15")
    const { employees } = await res.json()
    expect(employees[0].daysActive).toBe(2)
    expect(employees[0].minutesActive).toBe(150)
    expect(employees[0].estimatedCents).toBe(15000)
  })
})

describe("campos de pago en /api/users", () => {
  const dbUser = {
    id: "emp-1",
    name: "Kevin",
    email: "k@x.com",
    phone: null,
    telegramId: null,
    customerType: "NORMAL",
    status: "APPROVED",
    role: "EMPLOYEE",
    jobTitle: "Mostrador",
    publicSlug: null,
    creditLimit: null,
    creditBalance: 0,
    homeBranchId: null,
    homeBranch: null,
    allowedModules: [],
    allowedBranchIds: [],
    payType: "HOURLY",
    payRateCents: 5000,
    commissionPct: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    _count: { reservations: 0 },
  }

  it("GET users NO pide ni expone campos de pago a un EMPLOYEE con el módulo", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["usuarios"] }))
    // Lo que Prisma devolvería con el select de no-admin: la ficha sin pago.
    const { payType, payRateCents, commissionPct, ...employeeView } = dbUser
    void payType; void payRateCents; void commissionPct
    mocks.userFindMany.mockResolvedValue([employeeView])
    const res = await UsersGET(new Request("https://app.invalid/api/users") as never)
    expect(res.status).toBe(200)
    // La frontera real es el select enviado a Prisma: sin campos de pago.
    const select = mocks.userFindMany.mock.calls[0][0].select
    expect(select).not.toHaveProperty("payType")
    expect(select).not.toHaveProperty("payRateCents")
    expect(select).not.toHaveProperty("commissionPct")
    const { users } = await res.json()
    expect(users[0]).not.toHaveProperty("payType")
    expect(users[0]).not.toHaveProperty("payRateCents")
    expect(users[0]).not.toHaveProperty("commissionPct")
  })

  it("GET users SÍ incluye el esquema de pago para un ADMIN", async () => {
    mocks.userFindMany.mockResolvedValue([{ ...dbUser }])
    const res = await UsersGET(new Request("https://app.invalid/api/users") as never)
    expect(res.status).toBe(200)
    const select = mocks.userFindMany.mock.calls[0][0].select
    expect(select).toMatchObject({ payType: true, payRateCents: true, commissionPct: true })
    const { users } = await res.json()
    expect(users[0]).toMatchObject({ payType: "HOURLY", payRateCents: 5000 })
  })

  const patch = (body: unknown, id = "emp-1") =>
    PATCH(
      new Request(`https://app.invalid/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) }
    )

  const existing = {
    id: "emp-1",
    name: "Kevin",
    status: "APPROVED",
    customerType: "NORMAL",
    role: "EMPLOYEE",
    homeBranchId: null,
    jobTitle: null,
    publicSlug: null,
    allowedModules: [],
    allowedBranchIds: [],
    payType: "NONE",
    payRateCents: null,
    commissionPct: null,
  }

  it("PATCH rechaza 403 el esquema de pago enviado por un EMPLOYEE", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["usuarios"] }))
    mocks.userFindUnique.mockResolvedValue({ ...existing })
    const res = await patch({ payType: "HOURLY", payRateCents: 5000 })
    expect(res.status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("PATCH valida el esquema: tipo fuera de catálogo o tarifa negativa → 400", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...existing })
    const bad1 = await patch({ payType: "WEEKLY" })
    expect(bad1.status).toBe(400)
    const bad2 = await patch({ payRateCents: -5 })
    expect(bad2.status).toBe(400)
    const bad3 = await patch({ commissionPct: 120 })
    expect(bad3.status).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("PATCH de ADMIN persiste payType/payRateCents/commissionPct validados", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...existing })
    mocks.userUpdate.mockResolvedValue({
      id: "emp-1",
      name: "Kevin",
      email: "k@x.com",
      status: "APPROVED",
      customerType: "NORMAL",
      role: "EMPLOYEE",
      jobTitle: null,
      publicSlug: null,
      homeBranchId: null,
      allowedModules: [],
      allowedBranchIds: [],
      payType: "COMMISSION",
      payRateCents: null,
      commissionPct: 5,
    })
    const res = await patch({ payType: "COMMISSION", commissionPct: 5 })
    expect(res.status).toBe(200)
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payType: "COMMISSION", commissionPct: 5 }),
      })
    )
  })
})
