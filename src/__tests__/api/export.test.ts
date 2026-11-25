import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/export — CSV de products/sales/orders (solo ADMIN).
 * Cobertura S5/D11: freno de 10 descargas/hora por usuario y horas en la
 * zona del negocio (America/Mexico_City), no la UTC del contenedor.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  saleFindMany: vi.fn(),
  productFindMany: vi.fn(),
  branchFindMany: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    sale: { findMany: mocks.saleFindMany },
    product: { findMany: mocks.productFindMany },
    branch: { findMany: mocks.branchFindMany },
  },
}))

import { GET as exportCsv } from "@/app/api/export/route"

const session = (id: string, role = "ADMIN", status = "APPROVED") => ({
  user: { id, role, status, businessId: "biz-test" },
})
const get = (query = "type=sales") => exportCsv(new Request(`https://app.invalid/api/export?${query}`))

const sale = (over: Record<string, unknown> = {}) => ({
  number: 7,
  createdAt: new Date("2025-06-10T02:30:00Z"),
  status: "COMPLETED",
  total: 500,
  discountCents: 0,
  discountReason: null,
  branch: { name: "Centro" },
  seller: { name: "Cajera" },
  customer: null,
  items: [{ quantity: 2 }],
  payments: [{ method: "CASH", status: "CONFIRMED" }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.saleFindMany.mockResolvedValue([])
  mocks.productFindMany.mockResolvedValue([])
  mocks.branchFindMany.mockResolvedValue([])
})

afterEach(() => { vi.useRealTimers() })

describe("GET /api/export — acceso y validación", () => {
  it("rechaza a quien no es ADMIN sin consultar nada", async () => {
    for (const s of [null, session("e", "EMPLOYEE"), session("c", "CUSTOMER"), session("p", "ADMIN", "PENDING")]) {
      mocks.auth.mockResolvedValue(s)
      const res = await get()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.saleFindMany).not.toHaveBeenCalled()
  })

  it("tipo inválido es 400", async () => {
    mocks.auth.mockResolvedValue(session("admin-bad"))
    const res = await get("type=clientes")
    expect(res.status).toBe(400)
    expect(mocks.saleFindMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/export — zona horaria del negocio (D11)", () => {
  it("las fechas del CSV salen en America/Mexico_City, no en la UTC del proceso", async () => {
    mocks.auth.mockResolvedValue(session("admin-tz"))
    // 02:30 UTC del 10 de junio = 20:30 del 9 de junio en Mexico City (UTC−6).
    mocks.saleFindMany.mockResolvedValue([sale()])
    const res = await get()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"2025-06-09 20:30"')
    expect(text).not.toContain("2025-06-10")
  })

  it("la fecha del nombre de archivo también es la del negocio", async () => {
    vi.useFakeTimers()
    // 02:30 UTC: en Mexico City todavía es 9 de junio — antes el ISO de la
    // máquina nombraba el archivo con el 10.
    vi.setSystemTime(new Date("2025-06-10T02:30:00Z"))
    mocks.auth.mockResolvedValue(session("admin-tz2"))
    const res = await get()
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sales-2025-06-09.csv"')
  })
})

describe("GET /api/export — freno de 10 descargas/hora por usuario (S5)", () => {
  it("la descarga 11 en la misma hora responde 429 sin tocar la BD", async () => {
    mocks.auth.mockResolvedValue(session("admin-rl"))
    for (let i = 0; i < 10; i++) {
      const res = await get()
      expect(res.status).toBe(200)
    }
    expect(mocks.saleFindMany).toHaveBeenCalledTimes(10)

    const limited = await get()
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("3600")
    // La llamada rechazada no llegó a la base de datos.
    expect(mocks.saleFindMany).toHaveBeenCalledTimes(10)
  })

  it("el bucket es por usuario: otro admin conserva sus descargas", async () => {
    mocks.auth.mockResolvedValue(session("admin-rl2"))
    for (let i = 0; i < 10; i++) await get()
    expect((await get()).status).toBe(429)

    mocks.auth.mockResolvedValue(session("admin-otro"))
    expect((await get()).status).toBe(200)
  })
})
