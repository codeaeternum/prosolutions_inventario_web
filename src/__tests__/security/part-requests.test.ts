import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Solicitudes de refacción del público (/mercado → POST /api/part-requests):
 * endpoint ANÓNIMO que recibe teléfonos — el rate limit por IP es la única
 * barrera contra spam — mientras que GET/PATCH son solo para staff.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createRequest: vi.fn(),
  findRequests: vi.fn(),
  countRequests: vi.fn(),
  findRequest: vi.fn(),
  updateRequest: vi.fn(),
  createEvent: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    partRequest: {
      create: mocks.createRequest,
      findMany: mocks.findRequests,
      count: mocks.countRequests,
      findUnique: mocks.findRequest,
      update: mocks.updateRequest,
    },
    directoryEvent: { create: mocks.createEvent },
  },
}))

import { GET as listRequests, POST as createRequest } from "@/app/api/part-requests/route"
import { PATCH as updateRequest } from "@/app/api/part-requests/[id]/route"

const staff = {
  user: { id: "u1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-1" },
}
const workshop = {
  user: { id: "w1", role: "WORKSHOP", status: "APPROVED", businessId: "biz-1" },
}

// IP distinta por test: el limiter en memoria comparte store entre tests.
vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const nextIp = () => `10.0.0.${++ipCounter}`

const postReq = (body: unknown, ip = nextIp()) =>
  new Request("https://app.invalid/api/part-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  })

const patchReq = (id: string, body: unknown) =>
  new Request(`https://app.invalid/api/part-requests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) })

const dbRow = {
  id: "pr1",
  name: "Pantalla iPhone 13",
  detail: null,
  phone: "8112345678",
  status: "OPEN",
  createdAt: new Date("2026-01-01T00:00:00Z"),
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findRequests.mockResolvedValue([dbRow])
  mocks.countRequests.mockResolvedValue(1)
  mocks.findRequest.mockResolvedValue(dbRow)
  mocks.updateRequest.mockImplementation(({ data }) =>
    Promise.resolve({ ...dbRow, ...data }),
  )
})

describe("POST /api/part-requests (público)", () => {
  it("registra la solicitud en OPEN, normaliza el teléfono y graba el evento", async () => {
    const res = await createRequest(
      postReq({ name: "  Pantalla iPhone 13 ", detail: "Original", phone: "+52 1 811 234 5678" }),
    )
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json).toEqual({ ok: true }) // respuesta genérica anti-enumeración
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(mocks.createRequest).toHaveBeenCalledWith({
      data: { name: "Pantalla iPhone 13", detail: "Original", phone: "8112345678", status: "OPEN" },
    })
    expect(mocks.createEvent).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "request", query: "Pantalla iPhone 13" }),
    })
  })

  it("rechaza teléfonos con menos de 10 dígitos sin tocar la base", async () => {
    const res = await createRequest(postReq({ name: "Batería", phone: "12345" }))
    expect(res.status).toBe(400)
    expect(mocks.createRequest).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it("rechaza payloads inválidos (name corto, sin phone)", async () => {
    for (const body of [
      { name: "x", phone: "8112345678" },
      { name: "Batería NB402" },
      "no-json",
    ]) {
      const res = await createRequest(postReq(body))
      expect(res.status).toBe(400)
    }
    expect(mocks.createRequest).not.toHaveBeenCalled()
  })

  it("aplica rate limit agresivo por IP: la 6.ª solicitud es 429", async () => {
    const ip = nextIp()
    const body = { name: "Flexor de carga", phone: "8112345678" }
    for (let i = 0; i < 5; i++) {
      expect((await createRequest(postReq(body, ip))).status).toBe(201)
    }
    const res = await createRequest(postReq(body, ip))
    expect(res.status).toBe(429)
    expect(mocks.createRequest).toHaveBeenCalledTimes(5)
  })
})

describe("GET /api/part-requests (staff)", () => {
  it("niega anónimos y cuentas WORKSHOP antes de leer la base", async () => {
    for (const session of [null, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await listRequests(new Request("https://app.invalid/api/part-requests"))
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.findRequests).not.toHaveBeenCalled()
  })

  it("lista OPEN primero y devuelve openCount para el badge del panel", async () => {
    mocks.auth.mockResolvedValue(staff)
    mocks.countRequests.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
    const res = await listRequests(new Request("https://app.invalid/api/part-requests"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.openCount).toBe(1)
    expect(mocks.findRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 50,
      }),
    )
  })

  it("valida el query param ?status=", async () => {
    mocks.auth.mockResolvedValue(staff)
    const res = await listRequests(
      new Request("https://app.invalid/api/part-requests?status=BOGUS"),
    )
    expect(res.status).toBe(400)
  })
})

describe("PATCH /api/part-requests/:id (staff)", () => {
  it("niega anónimos y WORKSHOP", async () => {
    for (const session of [null, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await updateRequest(
        patchReq("pr1", { status: "CONTACTED" }),
        paramsOf("pr1"),
      )
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.updateRequest).not.toHaveBeenCalled()
  })

  it("marca la solicitud como CONTACTED", async () => {
    mocks.auth.mockResolvedValue(staff)
    const res = await updateRequest(
      patchReq("pr1", { status: "CONTACTED" }),
      paramsOf("pr1"),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.request.status).toBe("CONTACTED")
    expect(mocks.updateRequest).toHaveBeenCalledWith({
      where: { id: "pr1" },
      data: { status: "CONTACTED" },
    })
  })

  it("404 si la solicitud no existe y 400 con estado inválido", async () => {
    mocks.auth.mockResolvedValue(staff)
    mocks.findRequest.mockResolvedValue(null)
    expect(
      (await updateRequest(patchReq("prX", { status: "CLOSED" }), paramsOf("prX"))).status,
    ).toBe(404)
    expect(
      (await updateRequest(patchReq("pr1", { status: "PENDING" }), paramsOf("pr1"))).status,
    ).toBe(400)
  })
})
