import { beforeEach, describe, expect, it, vi } from "vitest"
import { businessDayKey, BUSINESS_TIME_ZONE } from "@/lib/business-time"

/**
 * Series de /api/reports?series=1: las ventas cuentan lo COBRADO de verdad
 * (Sale.total de catálogo − discountCents autorizado) y los cobros de taller
 * suman CONFIRMED menos REFUNDED — antes la serie inflaba el ingreso con
 * devoluciones que ya salieron de caja.
 *
 * Las agregaciones por día/mes se hacen en SQL ($queryRaw): aquí el mock
 * devuelve filas ya agregadas y se verifica que la consulta lleve la fórmula
 * correcta, el filtro intacto y el bucket en horario del negocio
 * (America/Mexico_City), igual que en producción.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  queryRaw: vi.fn(),
  orderGroup: vi.fn(),
  partGroup: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    repairOrder: { groupBy: mocks.orderGroup },
    repairPart: { groupBy: mocks.partGroup },
  },
}))

import { GET } from "@/app/api/reports/route"

const adminSession = { user: { id: "u-admin", name: "Dueño", role: "ADMIN", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } }
const getSeries = () => GET(new Request("http://localhost/api/reports?series=1") as never)

// Filas que el raw devuelve por tabla; la consulta se identifica por el FROM.
let rawRows: Record<string, unknown[]> = {}
const TABLE_MARK = /FROM "(\w+)"/
const rawImpl = (strings: TemplateStringsArray) => {
  const table = TABLE_MARK.exec(strings.join(" "))?.[1] ?? ""
  return Promise.resolve(rawRows[table] ?? [])
}
// Texto SQL y parámetros de una llamada (los fragmentos Prisma.sql anidados
// exponen sus values para poder inspeccionar el IN(...) de sucursales).
const rawCall = (table: string) => {
  const call = mocks.queryRaw.mock.calls.find(([strings]) =>
    (strings as TemplateStringsArray).join(" ").includes(`FROM "${table}"`))
  if (!call) return null
  const params: unknown[] = []
  for (const v of (call as unknown[]).slice(1)) {
    if (v && typeof v === "object" && "values" in v) params.push(...(v as { values: unknown[] }).values)
    else params.push(v)
  }
  return { sql: (call[0] as TemplateStringsArray).join(" "), params }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(adminSession)
  rawRows = {}
  mocks.queryRaw.mockImplementation(rawImpl)
  mocks.orderGroup.mockResolvedValue([])
  mocks.partGroup.mockResolvedValue([])
})

describe("ventas por día", () => {
  it("suma lo cobrado neto: catálogo menos el descuento autorizado", async () => {
    const now = new Date()
    // La BD ya agregó: $500−$50 y $200 del día → 65 000 centavos, 2 ventas.
    rawRows.Sale = [{ day: businessDayKey(now), salesCents: 65000, count: 2 }]
    const res = await getSeries()
    expect(res.status).toBe(200)
    const body = await res.json()
    const today = body.salesByDay.find((d: { day: string }) => d.day === businessDayKey(now))
    // 45 000 + 20 000 centavos — NO los $700 de catálogo.
    expect(today).toMatchObject({ salesCents: 65000, count: 2 })
    // La fórmula va en el SQL: neto = total*100 redondeado − discountCents.
    const q = rawCall("Sale")
    expect(q?.sql).toContain('ROUND("total" * 100) - "discountCents"')
    expect(q?.sql).toContain('"status" = \'COMPLETED\'')
    expect(q?.params).toContain("biz")
  })

  it("las ventas sin descuento quedan igual", async () => {
    const now = new Date()
    rawRows.Sale = [{ day: businessDayKey(now), salesCents: 10000, count: 1 }]
    const body = await (await getSeries()).json()
    const today = body.salesByDay.at(-1)
    expect(today).toMatchObject({ salesCents: 10000, count: 1 })
  })

  it("un bucket fuera del rango se descarta y los días sin datos quedan en cero", async () => {
    rawRows.Sale = [{ day: "2000-01-01", salesCents: 99900, count: 5 }]
    const body = await (await getSeries()).json()
    expect(body.salesByDay).toHaveLength(30)
    expect(body.salesByDay.every((d: { salesCents: number; count: number }) => d.salesCents === 0 && d.count === 0)).toBe(true)
    expect(body.salesByDay.some((d: { day: string }) => d.day === "2000-01-01")).toBe(false)
  })
})

describe("buckets en horario del negocio", () => {
  it("cada consulta agrega por el día/mes de America/Mexico_City, no por UTC", async () => {
    await getSeries()
    // Cuatro consultas raw: Sale, CashMovement, Payment y User (mensual).
    for (const table of ["Sale", "CashMovement", "Payment", "User"]) {
      const q = rawCall(table)
      expect(q, `sin consulta ${table}`).not.toBeNull()
      expect(q!.sql).toContain("AT TIME ZONE")
      // La zona viaja como parámetro ligado (BUSINESS_TIME_ZONE), no fija.
      expect(q!.params).toContain(BUSINESS_TIME_ZONE)
      expect(BUSINESS_TIME_ZONE).toBe("America/Mexico_City")
    }
    // Día con formato YYYY-MM-DD y mes con YYYY-MM.
    expect(rawCall("Sale")!.sql).toContain("YYYY-MM-DD")
    expect(rawCall("User")!.sql).toContain("YYYY-MM")
  })
})

describe("cobros de taller", () => {
  it("suma CONFIRMED y resta REFUNDED (amount ya firmado)", async () => {
    const now = new Date()
    rawRows.Payment = [{ day: businessDayKey(now), paymentsCents: 15000 }]
    const body = await (await getSeries()).json()
    const today = body.repairMoney.find((d: { day: string }) => d.day === businessDayKey(now))
    expect(today).toMatchObject({ paymentsCents: 15000 })
    // El query cubre ambos estados: confirmado suma, refundido resta — y
    // solo pagos ligados a una orden de taller.
    const q = rawCall("Payment")
    expect(q?.sql).toContain('"status" IN (\'CONFIRMED\', \'REFUNDED\')')
    expect(q?.sql).toContain('"repairOrderId" IS NOT NULL')
  })
})

describe("refacciones más usadas", () => {
  it("agrega en BD por (descripción, precio) y fusiona variantes con espacios", async () => {
    // El groupBy devuelve un renglón por par descripción+precio; el merge
    // por etiqueta normalizada suma piezas e ingreso en centavos.
    mocks.partGroup.mockResolvedValue([
      { description: "Pantalla A10", unitPriceCents: 15000, _sum: { qty: 3 } },
      { description: "  Pantalla A10 ", unitPriceCents: 15000, _sum: { qty: 2 } },
      { description: "Batería B2", unitPriceCents: 30000, _sum: { qty: 4 } },
      { description: "   ", unitPriceCents: 100, _sum: { qty: 9 } }, // vacía: se omite
    ])
    const res = await getSeries()
    const body = await res.json()
    const top = body.topParts
    expect(top[0]).toMatchObject({ label: "Pantalla A10", count: 5, revenueCents: 75000 })
    expect(top[1]).toMatchObject({ label: "Batería B2", count: 4, revenueCents: 120000 })
    expect(top).toHaveLength(2)
    // La consulta es groupBy con _sum.qty — no la corrida histórica fila a fila.
    expect(mocks.partGroup).toHaveBeenCalledWith(expect.objectContaining({
      by: ["description", "unitPriceCents"],
      _sum: { qty: true },
      where: expect.objectContaining({ status: "APPROVED" }),
    }))
    // Datos de dinero: la respuesta no es cacheable.
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })
})
