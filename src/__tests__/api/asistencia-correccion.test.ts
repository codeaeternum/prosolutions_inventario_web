import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Edición admin de jornadas — correcciones del dueño sobre el checador con
 * rastro en AuditEvent.
 *
 * PATCH /api/asistencia/[eventId]: mover la hora de una marca o anotarla.
 * Cubre gate de admin, 404 cross-tenant, 409 al invertir el orden IN→OUT
 * pareado, rechazo de horas futuras, no-op sin bitácora y el diff hora
 * anterior → nueva que queda en `changes`.
 *
 * POST /api/asistencia/cerrar: crea el OUT que faltó. Cubre staff del
 * tenant (404 si no), selección del IN sin pareja más antiguo COMPATIBLE
 * (un evento intermedio a ≤ outAt descarta al candidato viejo), 409 sin
 * jornada abierta, outAt futuro y no-store.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  clockFindFirst: vi.fn(),
  clockFindMany: vi.fn(),
  clockCreate: vi.fn(),
  clockUpdate: vi.fn(),
  userFindFirst: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clockEvent: {
      findFirst: mocks.clockFindFirst,
      findMany: mocks.clockFindMany,
      create: mocks.clockCreate,
      update: mocks.clockUpdate,
    },
    user: { findFirst: mocks.userFindFirst },
    auditEvent: { create: mocks.auditCreate },
  },
}))

import { PATCH } from "@/app/api/asistencia/[eventId]/route"
import { POST as cerrarPOST } from "@/app/api/asistencia/cerrar/route"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, name: "X", role, status: "APPROVED", businessId: "biz-1", ...extra },
})
const admin = session("u-admin", "ADMIN")
const empleado = session("u-emp", "EMPLOYEE")

const patch = (eventId: string, body: unknown) =>
  PATCH(
    new Request(`https://app.invalid/api/asistencia/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ eventId }) }
  )
const cerrar = (body: unknown) =>
  cerrarPOST(
    new Request("https://app.invalid/api/asistencia/cerrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  )

const clockEvent = (over: Record<string, unknown>) => ({
  id: "ck-1",
  businessId: "biz-1",
  userId: "u-emp",
  branchId: null,
  type: "IN",
  at: new Date("2026-06-10T15:00:00Z"),
  note: null,
  createdAt: new Date("2026-06-10T15:00:00Z"),
  user: { name: "Kevin" },
  ...over,
})

const auditCall = () => mocks.auditCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin)
  mocks.clockFindFirst.mockResolvedValue(null)
  mocks.clockFindMany.mockResolvedValue([])
  mocks.userFindFirst.mockResolvedValue({ id: "u-emp", name: "Kevin", role: "EMPLOYEE" })
  mocks.auditCreate.mockResolvedValue({})
  mocks.clockUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    clockEvent({ ...data, at: data.at ?? new Date("2026-06-10T15:00:00Z") })
  )
  mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    clockEvent({ id: "ck-new", ...data })
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe("PATCH /api/asistencia/[eventId] — acceso y body", () => {
  it("sin sesión responde 401 sin tocar la BD", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await patch("ck-1", { at: "2026-06-10T16:00:00Z" })
    expect(res.status).toBe(401)
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("un EMPLOYEE no corrige marcas → 403", async () => {
    mocks.auth.mockResolvedValue(empleado)
    const res = await patch("ck-1", { at: "2026-06-10T16:00:00Z" })
    expect(res.status).toBe(403)
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("evento de otro tenant o inexistente → 404", async () => {
    mocks.clockFindFirst.mockResolvedValue(null)
    const res = await patch("ck-ajeno", { at: "2026-06-10T16:00:00Z" })
    expect(res.status).toBe(404)
    expect(mocks.clockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "ck-ajeno", businessId: "biz-1" }) })
    )
    expect(mocks.clockUpdate).not.toHaveBeenCalled()
  })

  it("body vacío (ni at ni note) → 400", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({}))
    const res = await patch("ck-1", {})
    expect(res.status).toBe(400)
    expect(mocks.clockUpdate).not.toHaveBeenCalled()
  })

  it("at con formato inválido → 400", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({}))
    const res = await patch("ck-1", { at: "no-es-fecha" })
    expect(res.status).toBe(400)
  })

  it("at en el futuro → 400", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-10T20:00:00Z"))
    mocks.clockFindFirst.mockResolvedValue(clockEvent({}))
    const res = await patch("ck-1", { at: "2026-06-10T21:00:00Z" })
    expect(res.status).toBe(400)
    const { error } = await res.json()
    expect(error).toMatch(/futuro/)
    expect(mocks.clockUpdate).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/asistencia/[eventId] — corrección y orden IN/OUT", () => {
  it("mover un IN dentro de su pareja: 200, update y bitácora con antes → después", async () => {
    const entrada = clockEvent({ id: "ck-in", at: new Date("2026-06-10T15:00:00Z") })
    const salida = clockEvent({ id: "ck-out", type: "OUT", at: new Date("2026-06-10T23:00:00Z"), user: undefined })
    mocks.clockFindFirst.mockResolvedValue(entrada)
    mocks.clockFindMany.mockResolvedValue([entrada, salida])
    const res = await patch("ck-in", { at: "2026-06-10T16:30:00Z" })
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(mocks.clockUpdate).toHaveBeenCalledWith({
      where: { id: "ck-in" },
      data: { at: new Date("2026-06-10T16:30:00Z") },
    })
    const audit = auditCall()?.data
    expect(audit).toMatchObject({ action: "ASISTENCIA_UPDATE", entity: "asistencia", entityId: "ck-in", entityName: "Kevin" })
    expect(audit?.changes).toMatchObject({
      hora: { before: "2026-06-10T15:00:00.000Z", after: "2026-06-10T16:30:00.000Z" },
    })
  })

  it("IN movido DESPUÉS de su OUT pareado → 409 sin escribir", async () => {
    const entrada = clockEvent({ id: "ck-in", at: new Date("2026-06-10T15:00:00Z") })
    const salida = clockEvent({ id: "ck-out", type: "OUT", at: new Date("2026-06-10T23:00:00Z") })
    mocks.clockFindFirst.mockResolvedValue(entrada)
    mocks.clockFindMany.mockResolvedValue([entrada, salida])
    const res = await patch("ck-in", { at: "2026-06-11T01:00:00Z" })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/entrada no puede quedar después/i)
    expect(mocks.clockUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("OUT movido ANTES de su IN pareado → 409 sin escribir", async () => {
    const entrada = clockEvent({ id: "ck-in", at: new Date("2026-06-10T15:00:00Z") })
    const salida = clockEvent({ id: "ck-out", type: "OUT", at: new Date("2026-06-10T23:00:00Z") })
    mocks.clockFindFirst.mockResolvedValue(salida)
    mocks.clockFindMany.mockResolvedValue([entrada, salida])
    const res = await patch("ck-out", { at: "2026-06-10T14:00:00Z" })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/salida no puede quedar antes/i)
    expect(mocks.clockUpdate).not.toHaveBeenCalled()
  })

  it("OUT sin pareja (huérfano) sí puede moverse: no hay IN que invertir", async () => {
    // OUT1, IN2: OUT1 es huérfano (su previo no es IN); moverlo atrás pero
    // después de nada conflictivo solo re-pareja de forma determinista.
    const salida = clockEvent({ id: "ck-out", type: "OUT", at: new Date("2026-06-10T23:00:00Z") })
    mocks.clockFindFirst.mockResolvedValue(salida)
    mocks.clockFindMany.mockResolvedValue([salida])
    const res = await patch("ck-out", { at: "2026-06-10T20:00:00Z" })
    expect(res.status).toBe(200)
  })

  it("solo nota: actualiza sin consultar la secuencia ni validar orden", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({}))
    const res = await patch("ck-1", { note: "Checó tarde por el tráfico" })
    expect(res.status).toBe(200)
    expect(mocks.clockFindMany).not.toHaveBeenCalled()
    expect(mocks.clockUpdate).toHaveBeenCalledWith({
      where: { id: "ck-1" },
      data: { note: "Checó tarde por el tráfico" },
    })
    expect(auditCall()?.data.changes).toMatchObject({
      nota: { before: null, after: "Checó tarde por el tráfico" },
    })
  })

  it("mismos valores (no-op): 200 sin tocar la bitácora", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ note: "vieja" }))
    const res = await patch("ck-1", { note: "vieja" })
    expect(res.status).toBe(200)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})

describe("POST /api/asistencia/cerrar — acceso y validaciones", () => {
  it("un EMPLOYEE no puede cerrar jornadas → 403", async () => {
    mocks.auth.mockResolvedValue(empleado)
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-10T20:00:00Z" })
    expect(res.status).toBe(403)
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
  })

  it("userId de otro tenant o inexistente → 404", async () => {
    mocks.userFindFirst.mockResolvedValue(null)
    const res = await cerrar({ userId: "u-fantasma", outAt: "2026-06-10T20:00:00Z" })
    expect(res.status).toBe(404)
    expect(mocks.clockFindMany).not.toHaveBeenCalled()
  })

  it("un CUSTOMER no es staff del tenant → 404 igual que inexistente", async () => {
    mocks.userFindFirst.mockResolvedValue({ id: "c-1", name: "Cliente", role: "CUSTOMER" })
    const res = await cerrar({ userId: "c-1", outAt: "2026-06-10T20:00:00Z" })
    expect(res.status).toBe(404)
  })

  it("outAt en el futuro → 400", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-10T20:00:00Z"))
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-10T21:00:00Z" })
    expect(res.status).toBe(400)
    const { error } = await res.json()
    expect(error).toMatch(/futuro/)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("outAt inválido → 400", async () => {
    const res = await cerrar({ userId: "u-emp", outAt: "ayer a las ocho" })
    expect(res.status).toBe(400)
  })
})

describe("POST /api/asistencia/cerrar — candidato y creación", () => {
  it("jornada abierta: crea el OUT heredando la sucursal del IN + bitácora", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-10T22:00:00Z"))
    const entrada = clockEvent({ id: "ck-in", branchId: "b1", at: new Date("2026-06-10T15:00:00Z") })
    mocks.clockFindMany.mockResolvedValue([entrada])
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-10T21:30:00Z", note: "Olvidó checar" })
    expect(res.status).toBe(201)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    expect(mocks.clockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz-1",
        userId: "u-emp",
        branchId: "b1",
        type: "OUT",
        at: new Date("2026-06-10T21:30:00Z"),
        note: "Olvidó checar",
      }),
    })
    const { event } = await res.json()
    expect(event.type).toBe("OUT")
    const audit = auditCall()?.data
    expect(audit).toMatchObject({ action: "ASISTENCIA_CIERRE", entity: "asistencia", entityName: "Kevin" })
    expect(audit?.changes).toMatchObject({
      salida: { before: null, after: "2026-06-10T21:30:00.000Z" },
      entradaEvento: { before: null, after: "ck-in" },
    })
  })

  it("jornada abandonada (>16 h): también se cierra con la hora elegida", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-12T18:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "ck-in", at: new Date("2026-06-10T15:00:00Z") }),
    ])
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-10T23:00:00Z" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ at: new Date("2026-06-10T23:00:00Z") }),
    })
  })

  it("sin jornada abierta (todo IN ya tiene OUT) → 409", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-11T18:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "ck-in", at: new Date("2026-06-10T15:00:00Z") }),
      clockEvent({ id: "ck-out", type: "OUT", at: new Date("2026-06-10T23:00:00Z") }),
    ])
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-11T17:00:00Z" })
    expect(res.status).toBe(409)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it("outAt anterior a la entrada abierta → 409", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-10T22:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "ck-in", at: new Date("2026-06-10T18:00:00Z") }),
    ])
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-10T17:00:00Z" })
    expect(res.status).toBe(409)
  })

  it("con dos IN sin pareja el OUT se asigna al más antiguo COMPATIBLE", async () => {
    // IN1 09:00 (abandonado por IN2) + IN2 18:00 abierto, outAt 19:00:
    // IN1 no es compatible (IN2 se interpone antes de outAt) — el cierre
    // corresponde a IN2 y hereda SU sucursal.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-11T02:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "ck-in1", branchId: "b-vieja", at: new Date("2026-06-10T15:00:00Z") }),
      clockEvent({ id: "ck-in2", branchId: "b-nueva", at: new Date("2026-06-10T23:00:00Z") }),
    ])
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-11T01:00:00Z" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ branchId: "b-nueva", type: "OUT" }),
    })
    expect(auditCall()?.data.changes).toMatchObject({
      entradaEvento: { before: null, after: "ck-in2" },
    })
  })

  it("outAt entre los dos IN sí cierra la jornada más vieja", async () => {
    // Mismo escenario pero outAt 17:00 (< IN2): ahora IN1 sí es compatible.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-10T22:00:00Z"))
    mocks.clockFindMany.mockResolvedValue([
      clockEvent({ id: "ck-in1", branchId: "b-vieja", at: new Date("2026-06-10T15:00:00Z") }),
      clockEvent({ id: "ck-in2", branchId: "b-nueva", at: new Date("2026-06-10T23:00:00Z") }),
    ])
    const res = await cerrar({ userId: "u-emp", outAt: "2026-06-10T22:00:00Z" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ branchId: "b-vieja", type: "OUT" }),
    })
    expect(auditCall()?.data.changes).toMatchObject({
      entradaEvento: { before: null, after: "ck-in1" },
    })
  })
})
