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

  it("compras surtidas se acumulan en centavos — sin epsilon residual", async () => {
    // 0.1 + 0.2 = 0.30000000000000004 en Float: la suma en pesos dejaba
    // epsilon en purchasesTotal; con centavos por fila queda exacto.
    mocks.requestFind.mockResolvedValue([
      { productId: "p1", qty: 1, status: "FULFILLED", tallerName: "Taller X", createdAt: new Date(), sale: { total: 0.1, status: "COMPLETED", discountCents: 0 } },
      { productId: "p1", qty: 1, status: "FULFILLED", tallerName: "taller x", createdAt: new Date(), sale: { total: 0.2, status: "COMPLETED", discountCents: 0 } },
    ])
    const res = await GET()
    const { byTaller } = await res.json()
    expect(byTaller[0].purchasesTotal).toBe(0.3)
    expect(byTaller[0].purchasesCount).toBe(2)
  })

  it("una venta anulada ya no es compra y el descuento se resta del surtido", async () => {
    // FULFILLED con venta VOIDED: el stock volvió y el dinero se reembolsó —
    // contarla como compra inflaba el total del taller. La otra venta lleva
    // descuento autorizado: lo surtido es el neto, no el catálogo.
    mocks.requestFind.mockResolvedValue([
      { productId: "p1", qty: 1, status: "FULFILLED", tallerName: "Taller X", createdAt: new Date(), sale: { total: 500, status: "VOIDED", discountCents: 0 } },
      { productId: "p1", qty: 1, status: "FULFILLED", tallerName: "Taller X", createdAt: new Date(), sale: { total: 300, status: "COMPLETED", discountCents: 5000 } },
    ])
    const res = await GET()
    const { byTaller } = await res.json()
    expect(byTaller[0].purchasesCount).toBe(1)
    // $300 − $50 = $250 netos, no $800 de catálogo bruto.
    expect(byTaller[0].purchasesTotal).toBe(250)
    // La consulta trae el estado y el descuento de la venta ligada.
    expect(mocks.requestFind).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        sale: expect.objectContaining({
          select: expect.objectContaining({ status: true, discountCents: true }),
        }),
      }),
    }))
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
