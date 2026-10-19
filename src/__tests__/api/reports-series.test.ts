import { beforeEach, describe, expect, it, vi } from "vitest"
import { businessDayKey } from "@/lib/business-time"

/**
 * Series de /api/reports?series=1: las ventas cuentan lo COBRADO de verdad
 * (Sale.total de catálogo − discountCents autorizado) y los cobros de taller
 * suman CONFIRMED menos REFUNDED — antes la serie inflaba el ingreso con
 * devoluciones que ya salieron de caja.
 *
 * Auth y prisma van mockeados; las claves de día son del horario del negocio
 * (America/Mexico_City), igual que en producción.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  saleFind: vi.fn(),
  cashFind: vi.fn(),
  paymentFind: vi.fn(),
  orderGroup: vi.fn(),
  partFind: vi.fn(),
  userFind: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { findMany: mocks.saleFind },
    cashMovement: { findMany: mocks.cashFind },
    payment: { findMany: mocks.paymentFind },
    repairOrder: { groupBy: mocks.orderGroup },
    repairPart: { findMany: mocks.partFind },
    user: { findMany: mocks.userFind },
  },
}))

import { GET } from "@/app/api/reports/route"

const adminSession = { user: { id: "u-admin", name: "Dueño", role: "ADMIN", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } }
const getSeries = () => GET(new Request("http://localhost/api/reports?series=1") as never)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(adminSession)
  mocks.saleFind.mockResolvedValue([])
  mocks.cashFind.mockResolvedValue([])
  mocks.paymentFind.mockResolvedValue([])
  mocks.orderGroup.mockResolvedValue([])
  mocks.partFind.mockResolvedValue([])
  mocks.userFind.mockResolvedValue([])
})

describe("ventas por día", () => {
  it("suma lo cobrado neto: catálogo menos el descuento autorizado", async () => {
    const now = new Date()
    mocks.saleFind.mockResolvedValue([
      { createdAt: now, total: 500, discountCents: 5000 },   // $500 − $50 = $450
      { createdAt: now, total: 200, discountCents: 0 },      // $200 sin descuento
    ])
    const res = await getSeries()
    expect(res.status).toBe(200)
    const body = await res.json()
    const today = body.salesByDay.find((d: { day: string }) => d.day === businessDayKey(now))
    // 45 000 + 20 000 centavos — NO los $700 de catálogo.
    expect(today).toMatchObject({ salesCents: 65000, count: 2 })
    // La consulta trae discountCents junto con el total.
    expect(mocks.saleFind).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ discountCents: true, total: true }),
    }))
  })

  it("las ventas sin descuento quedan igual", async () => {
    mocks.saleFind.mockResolvedValue([{ createdAt: new Date(), total: 100, discountCents: 0 }])
    const body = await (await getSeries()).json()
    const today = body.salesByDay.at(-1)
    expect(today).toMatchObject({ salesCents: 10000, count: 1 })
  })
})

describe("cobros de taller", () => {
  it("suma CONFIRMED y resta REFUNDED (amount ya firmado)", async () => {
    const now = new Date()
    mocks.paymentFind.mockResolvedValue([
      { createdAt: now, amount: 200 },
      { createdAt: now, amount: -50 }, // devolución confirmada
    ])
    const body = await (await getSeries()).json()
    const today = body.repairMoney.find((d: { day: string }) => d.day === businessDayKey(now))
    expect(today).toMatchObject({ paymentsCents: 15000 })
    // El query cubre ambos estados: confirmado suma, refundido resta.
    expect(mocks.paymentFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["CONFIRMED", "REFUNDED"] } }),
    }))
  })
})
