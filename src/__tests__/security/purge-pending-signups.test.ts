import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Cron /api/cron/purge-pending-signups: purga tenants cuyo único equipo son
 * owners ADMIN+PENDING (altas que nunca verificaron correo/teléfono). Solo se
 * ejecuta con CRON_SECRET válido; el borrado replica el orden FK-seguro del
 * DELETE de plataforma y respeta el cinturón "sin datos operativos".
 */
const DAY_MS = 24 * 60 * 60 * 1000

const mocks = vi.hoisted(() => {
  type FixtureUser = { role: string; status: string }
  type Fixture = {
    id: string
    slug: string
    name: string
    createdAt: Date
    users: FixtureUser[] // solo alimenta el filtro falso de la "BD"
    _count: { products: number; sales: number; repairOrders: number; users: number }
  }

  const fixtures: Fixture[] = []
  const findBusinesses = vi.fn()
  const del: Record<string, ReturnType<typeof vi.fn>> = Object.fromEntries(
    ["businessOperation", "auditEvent", "pushSubscription", "settings",
      "systemSettings", "workshopService", "user", "branch"]
      .map((a) => [a, vi.fn().mockResolvedValue({ count: 0 })])
  )
  const businessDelete = vi.fn().mockResolvedValue({})
  const platformEventCreate = vi.fn().mockResolvedValue({})
  const prisma: Record<string, unknown> = {
    business: { findMany: findBusinesses, delete: businessDelete },
    platformEvent: { create: platformEventCreate },
    ...Object.fromEntries(Object.entries(del).map(([a, fn]) => [a, { deleteMany: fn }])),
  }
  prisma.$transaction = vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(prisma))

  // La "BD" aplica el where: createdAt < cutoff, al menos un user y TODOS
  // los users ADMIN+PENDING — lo que Postgres haría con el filtro real.
  findBusinesses.mockImplementation(
    ({ where }: { where: { createdAt: { lt: Date }; users: { every: FixtureUser } } }) =>
      Promise.resolve(
        fixtures.filter(
          (t) =>
            t.createdAt < where.createdAt.lt &&
            t.users.length >= 1 &&
            t.users.every(
              (u) => u.role === where.users.every.role && u.status === where.users.every.status
            )
        )
      )
  )

  return { fixtures, findBusinesses, del, businessDelete, platformEventCreate, prisma }
})
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "@/app/api/cron/purge-pending-signups/route"

const get = (
  query = "",
  headers: Record<string, string> = { authorization: "Bearer test-secret" }
) => GET(new Request(`https://app.invalid/api/cron/purge-pending-signups${query}`, { headers }))

const tenant = (over: Partial<(typeof mocks.fixtures)[number]> = {}) => ({
  id: "b1",
  slug: "alta-basura",
  name: "Alta Basura",
  createdAt: new Date(Date.now() - 30 * DAY_MS),
  users: [{ role: "ADMIN", status: "PENDING" }],
  _count: { products: 0, sales: 0, repairOrders: 0, users: 1 },
  ...over,
})

describe("cron purge-pending-signups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mocks.fixtures.length = 0
    vi.stubEnv("CRON_SECRET", "test-secret")
  })

  it("responds 503 when CRON_SECRET is not configured and never touches the DB", async () => {
    vi.stubEnv("CRON_SECRET", "")
    const res = await get()
    expect(res.status).toBe(503)
    expect(mocks.findBusinesses).not.toHaveBeenCalled()
  })

  it("rejects wrong or missing secrets (401) without touching the DB, and accepts x-cron-secret", async () => {
    const badHeaders: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }, { "x-cron-secret": "wrong" }]
    for (const headers of badHeaders) {
      const res = await get("", headers)
      expect(res.status).toBe(401)
    }
    expect(mocks.findBusinesses).not.toHaveBeenCalled()
    expect(mocks.businessDelete).not.toHaveBeenCalled()

    const ok = await get("", { "x-cron-secret": "test-secret" })
    expect(ok.status).toBe(200)
    expect(mocks.findBusinesses).toHaveBeenCalledTimes(1)
  })

  it("purges an old tenant whose only users are PENDING owners, seeds first, business last", async () => {
    mocks.fixtures.push(tenant())

    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.purged).toBe(1)
    expect(body.tenants).toEqual(["alta-basura"])
    expect(body.skipped).toEqual([])

    // Todos los deleteMany apuntan al tenant y van en orden FK-seguro.
    for (const accessor of ["businessOperation", "auditEvent", "pushSubscription", "settings",
      "systemSettings", "workshopService", "user", "branch"]) {
      expect(mocks.del[accessor]).toHaveBeenCalledWith({ where: { businessId: "b1" } })
    }
    const order = (a: string) => mocks.del[a].mock.invocationCallOrder[0]
    expect(order("businessOperation")).toBeLessThan(order("auditEvent"))
    expect(order("auditEvent")).toBeLessThan(order("pushSubscription"))
    // Restrict sobre actorId: antes que user.
    expect(order("pushSubscription")).toBeLessThan(order("user"))
    expect(order("user")).toBeLessThan(order("branch"))
    expect(mocks.businessDelete).toHaveBeenCalledWith({ where: { id: "b1" } })
    expect(mocks.businessDelete.mock.invocationCallOrder[0]).toBeGreaterThan(order("branch"))
    // Bitácora de plataforma dentro de la tx: la purga deja rastro.
    expect(mocks.platformEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "b1",
        businessSlug: "alta-basura",
        kind: "TENANT_DELETED",
        actorId: "cron:purge-pending-signups",
      }),
    })
  })

  it("filters in the query: all users must be ADMIN+PENDING and the business older than N days", async () => {
    await get()
    const { where } = mocks.findBusinesses.mock.calls[0][0] as {
      where: { createdAt: { lt: Date }; users: { some: object; every: object } }
    }
    expect(where.users.every).toEqual({ role: "ADMIN", status: "PENDING" })
    expect(where.users.some).toEqual({})
    // Default 7 días (tolerancia de segundos de ejecución).
    const ageMs = Date.now() - where.createdAt.lt.getTime()
    expect(ageMs).toBeGreaterThanOrEqual(7 * DAY_MS)
    expect(ageMs).toBeLessThan(7 * DAY_MS + 60_000)
  })

  it("does not touch an old tenant whose owner is APPROVED", async () => {
    mocks.fixtures.push(tenant({ users: [{ role: "ADMIN", status: "APPROVED" }] }))
    const res = await get()
    expect((await res.json()).purged).toBe(0)
    expect(mocks.del.user).not.toHaveBeenCalled()
    expect(mocks.businessDelete).not.toHaveBeenCalled()
  })

  it("does not touch a PENDING tenant newer than N days, and honors SIGNUP_PENDING_PURGE_DAYS", async () => {
    mocks.fixtures.push(tenant({ createdAt: new Date(Date.now() - 2 * DAY_MS) }))
    expect((await get().then((r) => r.json())).purged).toBe(0)
    expect(mocks.businessDelete).not.toHaveBeenCalled()

    // Con SIGNUP_PENDING_PURGE_DAYS=1 el mismo tenant ya es candidato.
    vi.stubEnv("SIGNUP_PENDING_PURGE_DAYS", "1")
    const res = await get()
    expect((await res.json()).purged).toBe(1)
    expect(mocks.businessDelete).toHaveBeenCalledWith({ where: { id: "b1" } })
  })

  it("skips and reports a PENDING tenant that somehow has operational data", async () => {
    mocks.fixtures.push(tenant({ _count: { products: 0, sales: 1, repairOrders: 0, users: 1 } }))
    const res = await get()
    const body = await res.json()
    expect(body.purged).toBe(0)
    expect(body.skipped).toEqual([
      expect.objectContaining({ slug: "alta-basura", reason: expect.stringContaining("sales=1") }),
    ])
    expect(mocks.businessDelete).not.toHaveBeenCalled()
  })

  it("reports (does not abort) when business.delete hits a residual Restrict row", async () => {
    mocks.fixtures.push(tenant())
    mocks.businessDelete.mockRejectedValueOnce({ code: "P2014" })
    const res = await get()
    const body = await res.json()
    expect(body.purged).toBe(0)
    expect(body.skipped[0].slug).toBe("alta-basura")
  })

  it("?dry=1 lists candidates without deleting anything", async () => {
    mocks.fixtures.push(tenant())
    mocks.fixtures.push(
      tenant({ id: "b2", slug: "operada", users: [{ role: "ADMIN", status: "APPROVED" }] })
    )
    const res = await get("?dry=1")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.dry).toBe(true)
    expect(body.candidates).toEqual([
      expect.objectContaining({ id: "b1", slug: "alta-basura", pendingDays: 30 }),
    ])
    for (const fn of Object.values(mocks.del)) expect(fn).not.toHaveBeenCalled()
    expect(mocks.businessDelete).not.toHaveBeenCalled()
  })
})
