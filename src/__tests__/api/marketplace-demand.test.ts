import { beforeEach, describe, expect, it, vi } from "vitest"
import { businessDayKey, zonedTimeToUtc } from "@/lib/business-time"

/**
 * /api/reports/marketplace-demand — la tendencia agrupa por semana de
 * calendario lunes→domingo en el HORARIO DEL NEGOCIO (America/Mexico_City).
 * Antes usaba la zona del servidor: en un host UTC una solicitud del domingo
 * 11 p. m. MX (que en UTC ya es lunes) caía en la semana siguiente.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requestFind: vi.fn(),
  productFind: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketplaceRequest: { findMany: mocks.requestFind },
    product: { findMany: mocks.productFind },
  },
}))

import { GET } from "@/app/api/reports/marketplace-demand/route"

const adminSession = { user: { id: "u-admin", name: "Dueño", role: "ADMIN", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } }

/** Fecha MX ("YYYY-MM-DD") del lunes de la semana a la que pertenece `d`. */
const mondayKeyOf = (d: Date): string => {
  const [y, m, day] = businessDayKey(d).split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay()
  return new Date(Date.UTC(y, m - 1, day) - ((dow + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(adminSession)
  mocks.requestFind.mockResolvedValue([])
  mocks.productFind.mockResolvedValue([])
})

describe("tendencia semanal en horario del negocio", () => {
  it("una solicitud del domingo por la noche MX cae en SU semana, no en la siguiente", async () => {
    // Domingo 23:30 hora MX de la semana en curso: en UTC ese instante ya es
    // lunes — exactamente el caso que desplazaba el reporte con getDay().
    const monday = mondayKeyOf(new Date())
    const [sy, sm, sd] = new Date(Date.parse(`${monday}T00:00:00.000Z`) + 6 * 86_400_000)
      .toISOString().slice(0, 10).split("-").map(Number)
    const sundayNightUtc = zonedTimeToUtc(sy, sm, sd, 23, 30)
    mocks.requestFind.mockResolvedValue([
      { productId: "p1", qty: 2, status: "PENDING", tallerName: "Taller X", createdAt: sundayNightUtc, sale: null },
    ])

    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    const week = body.weekly.find((w: { weekStart: string }) => w.weekStart === monday)
    expect(week).toMatchObject({ requests: 1, qty: 2 })
    // Y no hay un bucket fantasma en la semana siguiente (no existe en la
    // ventana de 8 semanas) ni doble conteo.
    expect(body.weekly).toHaveLength(8)
    expect(body.weekly.reduce((n: number, w: { requests: number }) => n + w.requests, 0)).toBe(1)
  })

  it("las 8 semanas terminan en la semana MX actual, ascendente", async () => {
    const body = await (await GET()).json()
    const keys = body.weekly.map((w: { weekStart: string }) => w.weekStart)
    expect(keys.at(-1)).toBe(mondayKeyOf(new Date()))
    // Cada lunes está exactamente 7 días antes del siguiente.
    for (let i = 1; i < keys.length; i++) {
      expect(Date.parse(`${keys[i]}T00:00:00.000Z`) - Date.parse(`${keys[i - 1]}T00:00:00.000Z`)).toBe(7 * 86_400_000)
    }
  })
})
