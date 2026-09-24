import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * GET /api/activity — feed unificado de actividad del staff (solo ADMIN).
 *
 * Prisma y la sesión se mockean como en security/employee-permissions.test.ts:
 * se ejercita el handler real con Request/Response y se inspeccionan los
 * `where` que llegan a cada findMany para verificar aislamiento por tenant,
 * filtros y paginación por cursor.
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
    // AuditEvent aún no existe en el cliente generado: la ruta lo lee con un
    // cast laxo `(prisma as …).auditEvent`, así que basta exponerlo en el mock.
    auditEvent: { findMany: mocks.auditFindMany },
    user: { findMany: mocks.userFindMany },
    systemSettings: { findMany: mocks.settingsFindMany },
  },
}))

import { GET as activity } from "@/app/api/activity/route"

const session = (id: string, role = "ADMIN", status = "APPROVED") => ({
  user: { id, role, status, businessId: "biz-test" },
})
const get = (query = "") => activity(new Request(`https://app.invalid/api/activity${query}`))

const staff = [
  { id: "admin-1", name: "Dueña", role: "ADMIN" },
  { id: "emp-1", name: "Empleado", role: "EMPLOYEE" },
]

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

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.operationFindMany.mockResolvedValue([])
  mocks.repairEventFindMany.mockResolvedValue([])
  mocks.auditFindMany.mockResolvedValue([])
  mocks.userFindMany.mockResolvedValue(staff)
  mocks.settingsFindMany.mockResolvedValue([])
})

describe("GET /api/activity — acceso", () => {
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

  it("admin recibe 200 con Cache-Control privado", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    const body = await res.json()
    expect(body).toMatchObject({ items: [], nextCursor: null })
    expect(body.actors).toEqual(staff)
  })
})

describe("merge de fuentes", () => {
  it("ordena las tres fuentes por createdAt desc y traduce etiquetas", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.operationFindMany.mockResolvedValue([
      op({ id: "op-old", createdAt: new Date("2025-06-10T18:00:00Z"), response: { sale: { number: 7 }, total: 500 } }),
    ])
    mocks.repairEventFindMany.mockResolvedValue([repair()])
    mocks.auditFindMany.mockResolvedValue([audit()])

    const body = await (await get()).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["au-1", "ev-1", "op-old"])
    expect(body.items.map((i: { source: string }) => i.source)).toEqual(["audit", "repair", "operation"])

    const [a, r, o] = body.items
    expect(a.label).toBe("Cambio de precio") // PRODUCT_UPDATE con change de precio
    expect(a.changes).toEqual([{ field: "retailPrice", before: 500, after: 450 }])
    expect(a.entityLabel).toBe("Pantalla iPhone 11")
    expect(r.label).toBe("Estado de orden")
    expect(r.summary).toBe("Recibido → En reparación.")
    expect(r.entityLabel).toBe("OT-000042")
    expect(o.label).toBe("Venta")
    expect(o.action).toBe("SALE")
    expect(o.summary).toBe("V-7 · $500.00")
    expect(o.actorName).toBe("Empleado")
  })

  it("actorId de la página que no es staff se agrega a `actors`", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.operationFindMany.mockResolvedValue([
      op({ id: "op-cust", actorId: "cust-9", actor: { id: "cust-9", name: "Cliente", role: "CUSTOMER" } }),
    ])
    mocks.userFindMany.mockImplementation((args: { where?: { id?: unknown } }) =>
      Promise.resolve(args?.where?.id ? [{ id: "cust-9", name: "Cliente", role: "CUSTOMER" }] : staff))

    const body = await (await get()).json()
    expect(body.actors).toContainEqual({ id: "cust-9", name: "Cliente", role: "CUSTOMER" })
    expect(mocks.userFindMany).toHaveBeenCalledTimes(2)
  })
})

describe("filtros", () => {
  it("actorId y rango de fechas llegan al where de cada fuente", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    await get("?actorId=emp-1&from=2025-06-01&to=2025-06-30")
    for (const spy of [mocks.operationFindMany, mocks.repairEventFindMany, mocks.auditFindMany]) {
      const where = spy.mock.calls[0][0].where
      expect(where.actorId).toBe("emp-1")
      expect(where.createdAt.gte).toEqual(new Date("2025-06-01T00:00:00.000"))
      expect(where.createdAt.lte).toEqual(new Date("2025-06-30T23:59:59.999"))
    }
  })

  it("source=repair solo consulta RepairEvent", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.repairEventFindMany.mockResolvedValue([repair()])
    const body = await (await get("?source=repair")).json()
    expect(mocks.repairEventFindMany).toHaveBeenCalledTimes(1)
    expect(mocks.operationFindMany).not.toHaveBeenCalled()
    expect(mocks.auditFindMany).not.toHaveBeenCalled()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].source).toBe("repair")
  })

  it("q filtra sobre el texto construido (insensible a mayúsculas)", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.operationFindMany.mockResolvedValue([
      op({ id: "op-a", response: { sale: { number: 7 }, total: 500 } }),
      op({ id: "op-b", kind: "CASH_OUT", response: { amount: 200, description: "Retiro para gastos" } }),
    ])
    const body = await (await get("?q=v-7")).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["op-a"])
    const byLabel = await (await get("?q=efectivo")).json()
    expect(byLabel.items.map((i: { id: string }) => i.id)).toEqual(["op-b"])
  })
})

describe("paginación por cursor", () => {
  it("devuelve nextCursor solo cuando la página queda llena y no repite filas", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    mocks.operationFindMany.mockResolvedValue([
      op({ id: "op-3", createdAt: new Date("2025-06-10T18:03:00Z") }),
      op({ id: "op-2", createdAt: new Date("2025-06-10T18:02:00Z") }),
      op({ id: "op-1", createdAt: new Date("2025-06-10T18:01:00Z") }),
    ])
    const page1 = await (await get("?take=2")).json()
    expect(page1.items.map((i: { id: string }) => i.id)).toEqual(["op-3", "op-2"])
    expect(page1.nextCursor).toBe("2025-06-10T18:02:00.000Z~op-2")

    // Segunda página: el where lleva la condición (createdAt, id) < cursor.
    mocks.operationFindMany.mockResolvedValue([op({ id: "op-1", createdAt: new Date("2025-06-10T18:01:00Z") })])
    const page2 = await (await get(`?take=2&cursor=${encodeURIComponent(page1.nextCursor)}`)).json()
    const where = mocks.operationFindMany.mock.calls[1][0].where
    expect(where.OR).toEqual([
      { createdAt: { lt: new Date("2025-06-10T18:02:00Z") } },
      { createdAt: new Date("2025-06-10T18:02:00Z"), id: { lt: "op-2" } },
    ])
    expect(page2.items.map((i: { id: string }) => i.id)).toEqual(["op-1"])
    expect(page2.nextCursor).toBeNull()
    // Sin traslape entre páginas.
    expect(page1.items.map((i: { id: string }) => i.id)).not.toContain("op-1")
  })
})

describe("aislamiento por tenant", () => {
  it("todos los findMany filtran businessId del negocio de la sesión", async () => {
    mocks.auth.mockResolvedValue(session("admin-1"))
    await get()
    for (const spy of [mocks.operationFindMany, mocks.repairEventFindMany, mocks.auditFindMany]) {
      expect(spy.mock.calls[0][0].where.businessId).toBe("biz-test")
    }
    expect(mocks.userFindMany.mock.calls[0][0].where.businessId).toBe("biz-test")
  })
})
