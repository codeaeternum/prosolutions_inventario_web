import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/activity/export — la bitácora unificada como CSV descargable
 * (solo ADMIN). Mismo setup de mocks que activity.test.ts: se ejercita el
 * handler real con Request/Response verificando cabeceras, escape CSV,
 * aislamiento por tenant, filtros compartidos y el tope de 2000 filas.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  operationFindMany: vi.fn(),
  repairEventFindMany: vi.fn(),
  auditFindMany: vi.fn(),
  userFindMany: vi.fn(),
  settingsFindMany: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessOperation: { findMany: mocks.operationFindMany },
    repairEvent: { findMany: mocks.repairEventFindMany },
    auditEvent: { findMany: mocks.auditFindMany },
    user: { findMany: mocks.userFindMany },
    systemSettings: { findMany: mocks.settingsFindMany },
  },
}))

import { GET as exportCsv } from "@/app/api/activity/export/route"

const session = (id: string, role = "ADMIN", status = "APPROVED") => ({
  user: { id, role, status, businessId: "biz-test" },
})
const get = (query = "") => exportCsv(new Request(`https://app.invalid/api/activity/export${query}`))

const op = (over: Record<string, unknown> = {}) => ({
  id: "op-1",
  businessId: "biz-test",
  actorId: "emp-1",
  kind: "SALE",
  response: {},
  createdAt: new Date("2025-06-10T18:00:00Z"),
  actor: { id: "emp-1", name: "Empleado", role: "EMPLOYEE" },
  ...over,
})
const repair = (over: Record<string, unknown> = {}) => ({
  id: "ev-1",
  businessId: "biz-test",
  orderId: "o-1",
  actorId: "emp-1",
  type: "STATUS",
  detail: "Recibido → En reparación.",
  isPublic: true,
  createdAt: new Date("2025-06-10T19:00:00Z"),
  actor: { id: "emp-1", name: "Empleado", role: "EMPLOYEE" },
  order: { number: 42 },
  ...over,
})
const audit = (over: Record<string, unknown> = {}) => ({
  id: "au-1",
  businessId: "biz-test",
  actorId: "admin-1",
  action: "PRODUCT_UPDATE",
  entity: "product",
  entityId: "p-1",
  entityName: "Pantalla iPhone 11",
  summary: null,
  changes: [{ field: "retailPrice", before: 500, after: 450 }],
  createdAt: new Date("2025-06-10T20:00:00Z"),
  actor: { id: "admin-1", name: "Dueña", role: "ADMIN" },
  ...over,
})

const csvText = async (res: Response) => (await res.text()).replace(/^﻿/, "") // quita el BOM \uFEFF

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.operationFindMany.mockResolvedValue([])
  mocks.repairEventFindMany.mockResolvedValue([])
  mocks.auditFindMany.mockResolvedValue([])
  mocks.userFindMany.mockResolvedValue([])
  mocks.settingsFindMany.mockResolvedValue([])
})

describe("GET /api/activity/export — acceso", () => {
  it("rechaza a quien no es ADMIN (401/403) y no consulta nada", async () => {
    for (const s of [null, session("e", "EMPLOYEE"), session("c", "CUSTOMER"), session("p", "ADMIN", "PENDING")]) {
      mocks.auth.mockResolvedValue(s)
      const res = await get()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.operationFindMany).not.toHaveBeenCalled()
    expect(mocks.repairEventFindMany).not.toHaveBeenCalled()
    expect(mocks.auditFindMany).not.toHaveBeenCalled()
  })
})

describe("formato CSV", () => {
  it("devuelve text/csv con Content-Disposition actividad-YYYYMMDD.csv y cabeceras", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="actividad-\d{8}\.csv"$/)
    expect(res.headers.get("cache-control")).toBe("private, no-store")

    const text = await csvText(res)
    const lines = text.trim().split("\r\n")
    expect(lines[0]).toBe('"fecha","empleado","rol","fuente","accion","resumen","entidad","cambios"')
    expect(lines).toHaveLength(1) // sin filas de datos
  })

  it("vuelca las filas con etiquetas en español y la entidad derivada", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.operationFindMany.mockResolvedValue([
      op({ response: { sale: { number: 7 }, total: 500 }, createdAt: new Date("2025-06-10T18:00:00Z") }),
    ])
    mocks.repairEventFindMany.mockResolvedValue([repair()])
    mocks.auditFindMany.mockResolvedValue([audit()])

    const text = await csvText(await get())
    const lines = text.trim().split("\r\n")
    expect(lines).toHaveLength(4) // header + 3 filas

    const [auditRow, repairRow, opRow] = lines.slice(1)
    expect(auditRow).toContain('"2025-06-10T20:00:00.000Z"')
    expect(auditRow).toContain('"Dueña"')
    expect(auditRow).toContain('"Administrador"')
    expect(auditRow).toContain('"Edición"')
    expect(auditRow).toContain('"Cambio de precio"')
    expect(auditRow).toContain('"product"')
    // Cambios como JSON compacto con comillas escapadas.
    expect(auditRow).toContain('""retailPrice""')
    expect(auditRow).toContain('""before"":500')
    expect(repairRow).toContain('"Taller"')
    expect(repairRow).toContain('"Recibido → En reparación."')
    expect(repairRow).toContain('"repair"')
    expect(repairRow).toContain('""') // columna cambios vacía
    expect(opRow).toContain('"Operación"')
    expect(opRow).toContain('"Venta"')
    expect(opRow).toContain('"V-7 · $500.00"')
    expect(opRow).toContain('"sale"')
    expect(opRow).toContain('"Empleado"')
  })

  it("neutraliza CSV-injection prefijando ' a celdas que empiezan con = + - @", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.repairEventFindMany.mockResolvedValue([
      repair({ id: "ev-a", detail: "=SUM(1,2)" }),
      repair({ id: "ev-b", detail: "+cmd", createdAt: new Date("2025-06-10T19:01:00Z") }),
      repair({ id: "ev-c", detail: "-2*3", createdAt: new Date("2025-06-10T19:02:00Z") }),
      repair({ id: "ev-d", detail: "@import", createdAt: new Date("2025-06-10T19:03:00Z") }),
    ])
    const text = await csvText(await get())
    expect(text).toContain('"\'=SUM(1,2)"')
    expect(text).toContain('"\'+cmd"')
    expect(text).toContain('"\'-2*3"')
    expect(text).toContain('"\'@import"')
    expect(text).not.toContain('"=SUM')
  })

  it("escapa comas, comillas y saltos de línea dentro de las celdas", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.repairEventFindMany.mockResolvedValue([
      repair({ id: "ev-x", detail: 'Nota con, coma y "comillas"' }),
    ])
    const text = await csvText(await get())
    expect(text).toContain('"Nota con, coma y ""comillas"""')
  })
})

describe("filtros compartidos con el feed", () => {
  it("todos los findMany filtran businessId del negocio de la sesión", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    await get()
    for (const spy of [mocks.operationFindMany, mocks.repairEventFindMany, mocks.auditFindMany]) {
      expect(spy.mock.calls[0][0].where.businessId).toBe("biz-test")
    }
    // Sin resolución de actores para el export (cada fila ya trae nombre/rol).
    expect(mocks.userFindMany).not.toHaveBeenCalled()
  })

  it("actorId y rango de fechas llegan al where; lee el tope por fuente", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    await get("?actorId=emp-1&from=2025-06-01&to=2025-06-30")
    for (const spy of [mocks.operationFindMany, mocks.repairEventFindMany, mocks.auditFindMany]) {
      const args = spy.mock.calls[0][0]
      expect(args.where.actorId).toBe("emp-1")
      // Día completo en America/Mexico_City (UTC−6): 00:00 local = 06:00 UTC.
      expect(args.where.createdAt.gte).toEqual(new Date("2025-06-01T06:00:00.000Z"))
      expect(args.where.createdAt.lte).toEqual(new Date("2025-07-01T05:59:59.999Z"))
      expect(args.take).toBe(2000)
    }
  })

  it("source=repair solo consulta RepairEvent y entity=cash solo exporta caja", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.repairEventFindMany.mockResolvedValue([repair()])
    const bySource = await csvText(await get("?source=repair"))
    expect(mocks.repairEventFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.operationFindMany).not.toHaveBeenCalled()
    expect(mocks.auditFindMany).not.toHaveBeenCalled()
    expect(bySource.trim().split("\r\n")).toHaveLength(2)

    mocks.repairEventFindMany.mockResolvedValue([])
    mocks.operationFindMany.mockResolvedValue([
      op({ id: "op-s", kind: "SALE" }),
      op({ id: "op-c", kind: "CASH_OUT", response: { amount: 200, description: "Retiro" }, createdAt: new Date("2025-06-10T17:00:00Z") }),
    ])
    const byEntity = await csvText(await get("?entity=cash"))
    const lines = byEntity.trim().split("\r\n")
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"cash"')
    expect(lines[1]).not.toContain('"sale"')
  })
})

describe("tope de filas", () => {
  it("exporta como máximo 2000 filas (las más recientes del merge)", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.operationFindMany.mockResolvedValue(
      Array.from({ length: 2100 }, (_, i) =>
        op({ id: `op-${String(i).padStart(4, "0")}`, createdAt: new Date(Date.UTC(2025, 5, 10, 18) - i * 1000) }))
    )
    const text = await csvText(await get())
    const lines = text.trim().split("\r\n")
    expect(lines).toHaveLength(2001) // header + 2000 filas
    // Las más recientes primero: la fila de t0 entra y la de t2099 (la más
    // vieja) queda fuera del archivo.
    expect(lines[1]).toContain('"2025-06-10T18:00:00.000Z"')
    expect(text).not.toContain(new Date(Date.UTC(2025, 5, 10, 18) - 2099 * 1000).toISOString())
  })
})
