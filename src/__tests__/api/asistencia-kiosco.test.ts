import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /api/asistencia/kiosco — checador compartido de mostrador.
 *
 * La tableta queda con la sesión del operador (staff ADMIN/EMPLOYEE) y cada
 * persona checa con SU PIN rápido sin cambiar de cuenta. Cubre: gate de
 * sesión/rol, anti-enumeración (usuario inexistente, PIN sin formato y PIN
 * incorrecto comparten mensaje y corren bcrypt siempre), PIN_NOT_SET, rate
 * limit por IP+usuario y por sesión, type automático (OUT si hay jornada
 * abierta), reglas 409 replicadas del checador personal, dedup <60 s, y que
 * el ClockEvent se crea para el TARGET con su homeBranchId — nunca con la
 * sucursal del operador ni con un businessId del cliente.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  clockFindFirst: vi.fn(),
  clockCreate: vi.fn(),
  userFindFirst: vi.fn(),
  bcryptCompare: vi.fn(),
  checkAndRecord: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clockEvent: {
      findFirst: mocks.clockFindFirst,
      create: mocks.clockCreate,
    },
    user: { findFirst: mocks.userFindFirst },
    $transaction: mocks.transaction,
  },
}))
vi.mock("bcryptjs", () => ({ default: { compare: mocks.bcryptCompare } }))
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecord: mocks.checkAndRecord,
  getClientIp: () => "ip-test",
}))

import { POST } from "@/app/api/asistencia/kiosco/route"
import { prisma } from "@/lib/prisma"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, name: "Operador", role, status: "APPROVED", businessId: "biz-1", ...extra },
})
const operador = session("op-1", "EMPLOYEE")

// El target: staff del MISMO negocio con PIN configurado y sucursal base
// distinta a cualquier dato de la sesión del operador.
const ana = {
  id: "u-ana",
  name: "Ana",
  role: "EMPLOYEE",
  quickPin: "hash-pin-ana",
  homeBranchId: "br-ana",
}

const post = (body: unknown) =>
  POST(
    new Request("https://app.invalid/api/asistencia/kiosco", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never
  )

const clockEvent = (over: Record<string, unknown>) => ({
  id: "ck-1",
  businessId: "biz-1",
  userId: "u-ana",
  branchId: "br-ana",
  type: "IN",
  at: new Date(),
  note: null,
  createdAt: new Date(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(operador)
  // El tx es el prisma mockeado: el check+create del dominio corre sobre
  // los mismos mocks del prisma global.
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) => work(prisma))
  mocks.checkAndRecord.mockReturnValue(true)
  mocks.userFindFirst.mockResolvedValue(ana)
  mocks.bcryptCompare.mockResolvedValue(true)
  mocks.clockFindFirst.mockResolvedValue(null)
  mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    clockEvent({ id: "ck-new", ...data, at: new Date(), createdAt: new Date() })
  )
})

describe("POST /api/asistencia/kiosco — sesión y rate limit", () => {
  it("sin sesión responde 401 sin tocar la BD", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(401)
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("rol que no es staff (CUSTOMER) recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("cli-1", "CUSTOMER"))
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(403)
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
  })

  it("rate limit por IP+usuario responde 429", async () => {
    mocks.checkAndRecord.mockReturnValueOnce(false)
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(429)
    expect(mocks.checkAndRecord).toHaveBeenCalledWith("asistencia-kiosco", "ip-test:u-ana", 60_000, 8)
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
  })

  it("rate limit por sesión de mostrador responde 429", async () => {
    mocks.checkAndRecord.mockReturnValueOnce(true).mockReturnValueOnce(false)
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(429)
    expect(mocks.checkAndRecord).toHaveBeenCalledWith("asistencia-kiosco-s", "op-1", 60_000, 30)
  })
})

describe("POST /api/asistencia/kiosco — PIN y anti-enumeración", () => {
  it("usuario inexistente o de otro tenant → 404 con el mismo mensaje que PIN incorrecto", async () => {
    mocks.userFindFirst.mockResolvedValue(null)
    const res = await post({ userId: "u-fantasma", pin: "1234" })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("PIN incorrecto o usuario inválido")
    // El bcrypt dummy corre igual: existencia no se filtra por timing.
    expect(mocks.bcryptCompare).toHaveBeenCalledWith("1234", expect.any(String))
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("PIN incorrecto → 401 con el mismo mensaje que usuario inexistente", async () => {
    mocks.bcryptCompare.mockResolvedValue(false)
    const res = await post({ userId: "u-ana", pin: "9999" })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("PIN incorrecto o usuario inválido")
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("PIN sin formato 4-6 dígitos → 401 genérico", async () => {
    const res = await post({ userId: "u-ana", pin: "12ab" })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("PIN incorrecto o usuario inválido")
  })

  it("usuario sin quickPin → 400 PIN_NOT_SET", async () => {
    mocks.userFindFirst.mockResolvedValue({ ...ana, quickPin: null })
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("PIN_NOT_SET")
    expect(mocks.clockFindFirst).not.toHaveBeenCalled()
  })

  it("la búsqueda del target exige mismo businessId, APPROVED y rol staff", async () => {
    await post({ userId: "u-ana", pin: "1234" })
    expect(mocks.userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-ana", businessId: "biz-1", status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } },
      })
    )
  })
})

describe("POST /api/asistencia/kiosco — checada", () => {
  it("IN feliz crea el ClockEvent del TARGET con su homeBranchId y businessId de sesión", async () => {
    const res = await post({ userId: "u-ana", pin: "1234", businessId: "biz-ajena" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz-1", // de la sesión: nunca del body
        userId: "u-ana", // quien checó, no el operador "op-1"
        branchId: "br-ana", // homeBranchId del target, no del operador
        type: "IN",
      }),
    })
    const body = await res.json()
    expect(body.userName).toBe("Ana")
    expect(body.openShift.since).toBeTruthy()
    expect(body.deduplicated).toBe(false)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("type automático: sin type y jornada abierta registra OUT", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 8 * 3600e3) }))
    mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      clockEvent({ id: "ck-out", ...data, at: new Date() })
    )
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "OUT" }) })
    const body = await res.json()
    expect(body.openShift).toBeNull()
  })

  it("OUT explícito con jornada abierta cierra la jornada", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 4 * 3600e3) }))
    mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      clockEvent({ id: "ck-out", ...data, at: new Date() })
    )
    const res = await post({ userId: "u-ana", pin: "1234", type: "OUT" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "OUT" }) })
  })

  it("IN explícito con jornada abierta → 409", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 2 * 3600e3) }))
    const res = await post({ userId: "u-ana", pin: "1234", type: "IN" })
    expect(res.status).toBe(409)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("OUT sin jornada abierta → 409", async () => {
    const res = await post({ userId: "u-ana", pin: "1234", type: "OUT" })
    expect(res.status).toBe(409)
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("IN abandonado hace >16 h: el automático vuelve a marcar IN (no 409)", async () => {
    mocks.clockFindFirst.mockResolvedValue(clockEvent({ type: "IN", at: new Date(Date.now() - 20 * 3600e3) }))
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(201)
    expect(mocks.clockCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "IN" }) })
  })

  it("dedup: mismo tipo a <60 s devuelve el existente sin crear", async () => {
    const existing = clockEvent({ type: "IN", at: new Date(Date.now() - 30e3) })
    mocks.clockFindFirst.mockResolvedValue(existing)
    const res = await post({ userId: "u-ana", pin: "1234", type: "IN" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.event.id).toBe("ck-1")
    expect(body.deduplicated).toBe(true)
    expect(body.userName).toBe("Ana")
    expect(mocks.clockCreate).not.toHaveBeenCalled()
  })

  it("la respuesta nunca expone quickPin ni el hash del PIN", async () => {
    const res = await post({ userId: "u-ana", pin: "1234" })
    expect(res.status).toBe(201)
    const raw = JSON.stringify(await res.json())
    expect(raw).not.toContain("quickPin")
    expect(raw).not.toContain("hash-pin-ana")
  })
})

describe("POST /api/asistencia/kiosco — atomicidad del check+create", () => {
  it("la lectura del último evento y el insert corren dentro de $transaction Serializable", async () => {
    const order: string[] = []
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) => {
      order.push("tx:begin")
      const r = await work(prisma)
      order.push("tx:commit")
      return r
    })
    mocks.clockFindFirst.mockImplementation(async () => { order.push("read:last"); return null })
    mocks.clockCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      order.push("create")
      return clockEvent({ ...data, at: new Date(), createdAt: new Date() })
    })
    const res = await post({ userId: "u-ana", pin: "1234", type: "IN" })
    expect(res.status).toBe(201)
    expect(order).toEqual(["tx:begin", "read:last", "create", "tx:commit"])
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "Serializable" })
    )
  })

  it("doble checada simultánea (kiosco + app): el perdedor reintenta y deduplica", async () => {
    // El IN ganador commiteó entre el intento 1 y el reintento del perdedor.
    const winner = clockEvent({ id: "ck-win", type: "IN", at: new Date() })
    let attempt = 0
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) => {
      attempt += 1
      if (attempt === 1) {
        // Perdedor: leyó snapshot vacío, insertó y el COMMIT abortó — su
        // insert se rollbackea con la tx.
        await work(prisma)
        throw Object.assign(new Error("could not serialize access"), { code: "P2034" })
      }
      return work(prisma)
    })
    mocks.clockFindFirst
      .mockResolvedValueOnce(null) // intento 1: aún no está el IN ganador
      .mockResolvedValue(winner)   // reintento: estado ya commiteado

    const res = await post({ userId: "u-ana", pin: "1234", type: "IN" })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.event.id).toBe("ck-win")
    expect(body.userName).toBe("Ana")
    expect(body.deduplicated).toBe(true)
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    // El único INSERT fue el del intento abortado; el reintento deduplicó.
    expect(mocks.clockCreate).toHaveBeenCalledTimes(1)
  })

  it("si al reintentar la jornada del ganador no es deduplicable → 409", async () => {
    // El ganador commiteó su IN hace 3 h (>60 s de dedup): el perdedor
    // relee la jornada abierta y recibe 409 — no un segundo IN fantasma.
    const winner = clockEvent({ id: "ck-win", type: "IN", at: new Date(Date.now() - 3 * 3600e3) })
    let attempt = 0
    mocks.transaction.mockImplementation(async (work: (tx: unknown) => unknown) => {
      attempt += 1
      if (attempt === 1) {
        await work(prisma)
        throw Object.assign(new Error("could not serialize access"), { code: "P2034" })
      }
      return work(prisma)
    })
    mocks.clockFindFirst.mockResolvedValueOnce(null).mockResolvedValue(winner)

    const res = await post({ userId: "u-ana", pin: "1234", type: "IN" })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain("jornada abierta")
    expect(mocks.clockCreate).toHaveBeenCalledTimes(1)
  })
})
