import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/reservations — rate limit por usuario.
 *
 * Crear una reserva descuenta existencias reales (takeStock), así que la
 * ruta limita a 10 creaciones por hora y usuario ANTES de tocar el dominio.
 * El rate-limit es el real (checkAndRecord en memoria); auth y el dominio
 * van mockeados para aislar el contrato de la ruta.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createReservations: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { reservation: { findMany: vi.fn(), count: vi.fn() } } }))
vi.mock("@/lib/domain/reservations", () => ({
  createReservations: mocks.createReservations,
  ACTIVE_RESERVATIONS: ["PENDING", "CONFIRMED"],
  TERMINAL_RESERVATIONS: ["COMPLETED", "CANCELLED", "EXPIRED"],
}))

import { POST } from "@/app/api/reservations/route"

const customer = (id: string) => ({
  user: { id, role: "CUSTOMER", status: "APPROVED", businessId: "biz-1", customerType: "NORMAL" },
})

const post = () =>
  POST(new Request("https://app.invalid/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: "p1", quantity: 1 }),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createReservations.mockResolvedValue({ reservations: [{ id: "res-1" }], operationId: "op-1" })
})

describe("POST /api/reservations", () => {
  it("permite 10 reservas por hora y la 11ª responde 429 sin tocar el dominio", async () => {
    mocks.auth.mockResolvedValue(customer("u-rate-1"))
    for (let i = 0; i < 10; i++) {
      const res = await post()
      expect(res.status).toBe(201)
    }
    expect(mocks.createReservations).toHaveBeenCalledTimes(10)

    const blocked = await post()
    expect(blocked.status).toBe(429)
    const json = await blocked.json()
    expect(json.error).toContain("Demasiadas reservas")
    // El intento rechazado jamás llega al dominio: no descuenta stock.
    expect(mocks.createReservations).toHaveBeenCalledTimes(10)
  })

  it("el límite es por usuario: otro cliente no hereda el castigo", async () => {
    mocks.auth.mockResolvedValue(customer("u-rate-2"))
    for (let i = 0; i < 10; i++) await post()
    expect((await post()).status).toBe(429)

    mocks.auth.mockResolvedValue(customer("u-rate-3"))
    expect((await post()).status).toBe(201)
  })

  it("sin sesión no consume ni inicia bucket: 401 antes del limiter", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(401)
    expect(mocks.createReservations).not.toHaveBeenCalled()
  })
})
