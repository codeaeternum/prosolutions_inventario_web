import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /api/asistencia — checador real (ClockEvent IN/OUT) + integración con
 * nómina (el reloj prefiere sobre la reconstrucción por actividad).
 *
 * Cubre: gate de sesión, validaciones 409 (OUT sin jornada abierta, doble
 * IN, IN/OUT tras jornada abandonada), dedup <60 s, permisos del GET
 * (propio siempre; ajeno o vista de negocio solo ADMIN), rango from/to,
 * derivación de jornadas (pares, abierta, >16 h openEnded) y que la nómina
 * use minutos de reloj cuando existen.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  clockFindFirst: vi.fn(),
  clockFindMany: vi.fn(),
  clockCreate: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  saleFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  opFindMany: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clockEvent: {
      findFirst: mocks.clockFindFirst,
      findMany: mocks.clockFindMany,
      create: mocks.clockCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      findMany: mocks.userFindMany,
    },
    sale: { findMany: mocks.saleFindMany },
    auditEvent: { findMany: mocks.auditFindMany },
    businessOperation: { findMany: mocks.opFindMany },
  },
}))

import { POST, GET } from "@/app/api/asistencia/route"
import { GET as NominaGET } from "@/app/api/actividad/nomina/route"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, name: "X", role, status: "APPROVED", businessId: "biz-1", ...extra },
})
const admin = session("u-admin", "ADMIN")
const empleado = session("u-emp", "EMPLOYEE")

const post = (body: unknown) =>
  POST(
    new Request("https://app.invalid/api/asistencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  )
const get = (qs = "") => GET(new Request(`https://app.invalid/api/asistencia${qs}`) as never)

const clockEvent = (over: Record<string, unknown>) => ({
  id: "ck-1",
  businessId: "biz-1",
  userId: "u-emp",
  branchId: null,
  type: "IN",
  at: new Date(),
  note: null,
  createdAt: new Date(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(empleado)
  mocks.clockFindFirst.mockResolvedValue(null)
  mocks.clockFindMany.mockResolvedValue([])
  mocks.userFindUnique.mockResolvedValue({ homeBranchId: "b1" })
  mocks.userFindFirst.mockResolvedValue({ id: "u-emp", name: "Kevin" })
  mocks.userFindMany.mockResolvedValue([])
  mocks.saleFindMany.mockResolvedValue([])
  mocks.auditFindMany.mockResolvedValue([])
  mocks.opFindMany.mockResolvedValue([])
  mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    clockEvent({ ...data, at: new Date(), createdAt: new Date() })
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe("POST /api/asistencia — sesión y body", () => {
  it("sin sesión responde 401 sin tocar la BD", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await post({ type: "IN" })
    expect(res.status).toBe(401)
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("cuenta no APPROVED recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { status: "PENDING" }))
    const res = await post({ type: "IN" })
    expect(res.status).toBe(403)
  })

  it("type fuera de catálogo → 400", async () => {
    const res = await post({ type: "PAUSA" })
    expect(res.status).toBe(400)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/asistencia — reglas de jornada", () => {
  it("IN feliz crea el evento con la sucursal base y abre jornada", async () => {
    const res = await post({ type: "IN", note: "turno mañana" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz-1",
        userId: "u-emp",
        branchId: "b1", // homeBranchId del usuario (la sesión no carga sucursal)
        type: "IN",
        note: "turno mañana",
      }),
    })
    const body = await res.json()
    expect(body.event.type).toBe("IN")
    expect(body.openShift.since).toBeTruthy()
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("OUT sin IN previo → 409", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "OUT", at: new Date(Date.now() - 3600e3) }))
    const res = await post({ type: "OUT" })
    expect(res.status).toBe(409)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("OUT sin ningún evento → 409", async () => {
    const res = await post({ type: "OUT" })
    expect(res.status).toBe(409)
  })

  it("doble IN con jornada abierta → 409", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 2 * 3600e3) }))
    const res = await post({ type: "IN" })
    expect(res.status).toBe(409)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("OUT con jornada abierta cierra (openShift null)", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 8 * 3600e3) }))
    mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      clockEvent({ ...data, type: "OUT", at: new Date() })
    )
    const res = await post({ type: "OUT" })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.openShift).toBeNull()
  })

  it("jornada abandonada (>16 h): IN nuevo se acepta, OUT se rechaza", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 20 * 3600e3) }))
    const out = await post({ type: "OUT" })
    expect(out.status).toBe(409) // ya no hay jornada ABIERTA que cerrar
    const inn = await post({ type: "IN" })
    expect(inn.status).toBe(201) // la vieja queda openEnded al derivarse
  })

  it("dedup: mismo tipo a <60 s devuelve el existente sin crear", async () => {
    const existing = clockEvent({ type: "IN", at: new Date(Date.now() - 30e3) })
    mocks.clockFindFirst.mockResolvedValue(existing)
    const res = await post({ type: "IN" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.event.id).toBe("ck-1")
    expect(body.deduplicated).toBe(true)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("dedup no aplica pasados 60 s (IN viejo pero abierto → 409)", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 90e3) }))
    const res = await post({ type: "IN" })
    expect(res.status).toBe(409)
  })
})

describe("GET /api/asistencia — permisos", () => {
  it("sin sesión responde 401", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await get("?userId=u-emp")
    expect(res.status).toBe(401)
    expect(mocks.clockFindMany).not.toHaveBeenCalled()
  })

  it("un EMPLOYEE consulta SU historial con ?userId= propio", async () => {
    const res = await get("?userId=u-emp")
    expect(res.status).toBe(200)
    const { users } = await res.json()
    expect(users[0].userId).toBe("u-emp")
    expect(mocks.clockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "u-emp", businessId: "biz-1" }) })
    )
  })

  it("EMPLOYEE pidiendo userId ajeno → 403", async () => {
    const res = await get("?userId=u-otro")
    expect(res.status).toBe(403)
    expect(mocks.clockFindMany).not.toHaveBeenCalled()
  })

  it("sin userId la vista cubre el negocio completo: solo ADMIN", async () => {
    const denied = await get()
    expect(denied.status).toBe(403)

    mocks.auth.mockResolvedValue(admin)
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "c1", userId: "u-emp", at: new Date("2026-06-10T14:00:00Z") }),
      clockEvent({ id: "c2", userId: "u-otro", type: "IN", at: new Date("2026-06-10T15:00:00Z") }),
    ])
    mocks.userFindMany.mockResolvedValue([
      { id: "u-emp", name: "Kevin" },
      { id: "u-otro", name: "Ana" },
    ])
    const res = await get()
    expect(res.status).toBe(200)
    const { users } = await res.json()
    expect(users.map((u: { userId: string }) => u.userId).sort()).toEqual(["u-emp", "u-otro"])
  })

  it("ADMIN consulta el historial de cualquier usuario", async () => {
    mocks.auth.mockResolvedValue(admin)
    mocks.userFindFirst.mockResolvedValue({ id: "u-otro", name: "Ana" })
    const res = await get("?userId=u-otro")
    expect(res.status).toBe(200)
    const { users } = await res.json()
    expect(users[0]).toMatchObject({ userId: "u-otro", name: "Ana" })
  })

  it("userId inexistente o de otro tenant → 404", async () => {
    mocks.auth.mockResolvedValue(admin)
    mocks.userFindFirst.mockResolvedValue(null)
    const res = await get("?userId=u-fantasma")
    expect(res.status).toBe(404)
  })
})

describe("GET /api/asistencia — rango y jornadas", () => {
  it("from > to → 400", async () => {
    const res = await get("?userId=u-emp&from=2026-06-15&to=2026-06-01")
    expect(res.status).toBe(400)
    expect(mocks.clockFindMany).not.toHaveBeenCalled()
  })

  it("devuelve periodo efectivo y eventos ordenados", async () => {
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "c1", at: new Date("2026-06-10T14:00:00Z") }),
      clockEvent({ id: "c2", type: "OUT", at: new Date("2026-06-10T23:30:00Z") }),
    ])
    const res = await get("?userId=u-emp&from=2026-06-01&to=2026-06-15")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.period).toEqual({ from: "2026-06-01", to: "2026-06-15" })
    expect(body.users[0].events.map((e: { id: string }) => e.id)).toEqual(["c1", "c2"])
  })

  it("pares IN→OUT derivan jornada con minutos", async () => {
    // 15:00Z→23:30Z = 09:00→17:30 MX: 8.5 h = 510 minutos.
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "c1", at: new Date("2026-06-10T15:00:00Z") }),
      clockEvent({ id: "c2", type: "OUT", at: new Date("2026-06-10T23:30:00Z") }),
    ])
    const res = await get("?userId=u-emp&from=2026-06-01&to=2026-06-15")
    const { users } = await res.json()
    expect(users[0].jornadas).toHaveLength(1)
    expect(users[0].jornadas[0]).toMatchObject({
      inEventId: "c1",
      outEventId: "c2",
      minutos: 510,
      open: false,
      openEnded: false,
    })
  })

  it("jornada abierta: IN sin OUT cuenta minutos hasta ahora", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-12T17:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([clockEvent({ id: "c1", at: new Date("2026-06-12T15:00:00Z") })])
    const res = await get("?userId=u-emp&from=2026-06-01&to=2026-06-15")
    const { users } = await res.json()
    expect(users[0].jornadas[0]).toMatchObject({ open: true, openEnded: false, minutos: 120, outAt: null })
  })

  it("OUT a >16 h del IN → jornada abandonada (openEnded, sin minutos)", async () => {
    // 22 h de diferencia: checada olvidada — el OUT no es un cierre confiable.
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "c1", at: new Date("2026-06-10T14:00:00Z") }),
      clockEvent({ id: "c2", type: "OUT", at: new Date("2026-06-11T12:00:00Z") }),
    ])
    const res = await get("?userId=u-emp&from=2026-06-01&to=2026-06-15")
    const { users } = await res.json()
    expect(users[0].jornadas).toHaveLength(1)
    expect(users[0].jornadas[0]).toMatchObject({
      inEventId: "c1",
      outEventId: null,
      outAt: null,
      minutos: null,
      open: false,
      openEnded: true,
    })
  })

  it("IN huérfano de hace >16 h también queda openEnded", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-12T17:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([clockEvent({ id: "c1", at: new Date("2026-06-10T15:00:00Z") })])
    const res = await get("?userId=u-emp&from=2026-06-01&to=2026-06-15")
    const { users } = await res.json()
    expect(users[0].jornadas[0]).toMatchObject({ openEnded: true, open: false, minutos: null })
  })
})

describe("nómina — el checador prefiere sobre la actividad", () => {
  const hourly = {
    id: "emp-1",
    name: "Kevin",
    jobTitle: "Mostrador",
    payType: "HOURLY",
    payRateCents: 6000,
    commissionPct: null,
  }
  const nomina = (qs: string) => NominaGET(new Request(`https://app.invalid/api/actividad/nomina${qs}`) as never)

  it("con ClockEvents en el rango los minutos salen de pares IN→OUT, no de la bitácora", async () => {
    mocks.auth.mockResolvedValue(admin)
    mocks.userFindMany.mockResolvedValue([hourly])
    // Reloj: 15:00Z→17:00Z = 2 h exactas → 2 × $60 = $120.
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "c1", userId: "emp-1", at: new Date("2026-06-10T15:00:00Z") }),
      clockEvent({ id: "c2", userId: "emp-1", type: "OUT", at: new Date("2026-06-10T17:00:00Z") }),
    ])
    // La bitácora diría 10 h de span; con checador NO debe contar.
    mocks.auditFindMany.mockResolvedValue([
      { actorId: "emp-1", createdAt: new Date("2026-06-10T14:00:00Z") },
      { actorId: "emp-1", createdAt: new Date("2026-06-11T00:00:00Z") },
    ])
    const res = await nomina("?from=2026-06-01&to=2026-06-15")
    expect(res.status).toBe(200)
    const { employees } = await res.json()
    expect(employees[0].minutesSource).toBe("clock")
    expect(employees[0].daysActive).toBe(1)
    expect(employees[0].minutesActive).toBe(120)
    expect(employees[0].openEndedDays).toBe(0)
    expect(employees[0].estimatedCents).toBe(12000)
  })

  it("sin checadas conserva el fallback por actividad", async () => {
    mocks.auth.mockResolvedValue(admin)
    mocks.userFindMany.mockResolvedValue([hourly])
    mocks.auditFindMany.mockResolvedValue([
      { actorId: "emp-1", createdAt: new Date("2026-06-10T15:00:00Z") },
      { actorId: "emp-1", createdAt: new Date("2026-06-10T17:00:00Z") },
    ])
    const res = await nomina("?from=2026-06-01&to=2026-06-15")
    const { employees } = await res.json()
    expect(employees[0].minutesSource).toBe("activity")
    expect(employees[0].minutesActive).toBe(120)
    expect(employees[0].estimatedCents).toBe(12000)
  })

  it("jornada abandonada aporta 0 minutos y se marca en openEndedDays", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-12T17:00:00Z"))
    mocks.auth.mockResolvedValue(admin)
    mocks.userFindMany.mockResolvedValue([hourly])
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "c1", userId: "emp-1", at: new Date("2026-06-10T14:00:00Z") }),
      clockEvent({ id: "c2", userId: "emp-1", type: "OUT", at: new Date("2026-06-11T12:00:00Z") }),
    ])
    const res = await nomina("?from=2026-06-01&to=2026-06-15")
    const { employees } = await res.json()
    expect(employees[0].minutesSource).toBe("clock")
    expect(employees[0].minutesActive).toBe(0) // no se inventan minutos
    expect(employees[0].openEndedDays).toBe(1)
    expect(employees[0].estimatedCents).toBe(0)
  })
})
