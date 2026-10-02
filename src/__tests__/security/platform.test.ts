import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Contrato de la consola de plataforma: solo el superadmin (operador Reficio)
 * puede listar/consultar empresas o suspenderlas — y nunca se toca la base de
 * datos sin pasar antes por requireSuperAdmin.
 */
const mocks = vi.hoisted(() => {
  const findBusinesses = vi.fn()
  const findBusiness = vi.fn()
  const updateBusiness = vi.fn()
  const saleGroup = vi.fn()
  const orderGroup = vi.fn()
  const findUsers = vi.fn()
  const findOrders = vi.fn()
  const findOrderFirst = vi.fn()
  const findSales = vi.fn()
  const findSaleFirst = vi.fn()
  const saleAggregate = vi.fn()

  // Gate del DELETE: un count por modelo "operativo"; todos por defecto en 0.
  const blocking = [
    "category", "brand", "model", "deviceModel", "product", "productModel",
    "priceHistory", "branchStock", "inventoryMovement", "inventoryCount",
    "inventoryCountItem", "sale", "saleItem", "payment", "reservation",
    "creditMovement", "cashRegister", "cashMovement", "cashRequest",
    "repairOrder", "repairPart", "repairEvent", "repairPhoto",
    "marketplaceRequest", "encargo", "supplier", "purchase", "purchaseItem",
    "supplierPayment", "shoppingItem", "directoryEvent",
  ]
  const count = Object.fromEntries(blocking.map((a) => [a, vi.fn().mockResolvedValue(0)]))
  const del = Object.fromEntries(
    ["businessOperation", "auditEvent", "pushSubscription", "settings",
      "systemSettings", "workshopService", "user", "branch"]
      .map((a) => [a, vi.fn().mockResolvedValue({ count: 1 })])
  )
  const businessDelete = vi.fn().mockResolvedValue({})
  const platformEventCreate = vi.fn().mockResolvedValue({})
  const prisma: Record<string, unknown> = {
    business: { findMany: findBusinesses, findUnique: findBusiness, update: updateBusiness, delete: businessDelete },
    platformEvent: { create: platformEventCreate, findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: findUsers, deleteMany: del.user },
    businessOperation: { deleteMany: del.businessOperation },
    auditEvent: { deleteMany: del.auditEvent },
    pushSubscription: { deleteMany: del.pushSubscription },
    settings: { deleteMany: del.settings },
    systemSettings: { deleteMany: del.systemSettings },
    workshopService: { deleteMany: del.workshopService },
    branch: { deleteMany: del.branch },
    ...Object.fromEntries(blocking.map((a) => [a, { count: count[a] }])),
  }
  ;(prisma.sale as Record<string, unknown>).groupBy = saleGroup
  ;(prisma.sale as Record<string, unknown>).aggregate = saleAggregate
  ;(prisma.sale as Record<string, unknown>).findMany = findSales
  ;(prisma.sale as Record<string, unknown>).findFirst = findSaleFirst
  ;(prisma.repairOrder as Record<string, unknown>).groupBy = orderGroup
  ;(prisma.repairOrder as Record<string, unknown>).findMany = findOrders
  ;(prisma.repairOrder as Record<string, unknown>).findFirst = findOrderFirst
  // $transaction soporta ambas formas: array de promesas (PATCH) y callback (DELETE).
  prisma.$transaction = vi.fn((arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(prisma))

  return {
    auth: vi.fn(), findBusinesses, findBusiness, updateBusiness, saleGroup,
    orderGroup, findUsers, findOrders, findOrderFirst, findSales, findSaleFirst,
    saleAggregate, count, del, businessDelete, platformEventCreate, prisma,
  }
})
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET as listBusinesses } from "@/app/api/platform/businesses/route"
import { GET as businessDetail, PATCH as patchBusiness, DELETE as deleteBusiness } from "@/app/api/platform/businesses/[id]/route"

const superAdmin = { user: { id: "op", role: "ADMIN", status: "APPROVED", customerType: "NORMAL", businessId: "biz-reficio", isSuperAdmin: true } }
const tenantAdmin = { user: { id: "t1", role: "ADMIN", status: "APPROVED", customerType: "NORMAL", businessId: "biz-tenant", isSuperAdmin: false } }

const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) })
const patchReq = (id: string, body: string) =>
  new Request(`https://app.invalid/api/platform/businesses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })

describe("platform console API", () => {
  beforeEach(() => { vi.clearAllMocks() })

  it("denies anonymous sessions and tenant admins before any database read", async () => {
    for (const session of [null, tenantAdmin, { user: { ...tenantAdmin.user, status: "PENDING" } }]) {
      mocks.auth.mockResolvedValue(session)
      expect([401, 403]).toContain((await listBusinesses()).status)
      expect([401, 403]).toContain((await businessDetail(new Request("https://app.invalid/api/platform/businesses/b1"), paramsOf("b1"))).status)
      expect([401, 403]).toContain((await patchBusiness(patchReq("b1", JSON.stringify({ isActive: false })), paramsOf("b1"))).status)
    }
    expect(mocks.findBusinesses).not.toHaveBeenCalled()
    expect(mocks.findBusiness).not.toHaveBeenCalled()
    expect(mocks.updateBusiness).not.toHaveBeenCalled()
  })

  it("lists businesses with counts, sales totals and last activity", async () => {
    mocks.auth.mockResolvedValue(superAdmin)
    const createdAt = new Date("2026-01-01T00:00:00Z")
    mocks.findBusinesses.mockResolvedValue([{
      id: "b1", name: "Taller Uno", slug: "taller-uno", category: "electronics-repair",
      isActive: true, createdAt,
      _count: { users: 3, products: 10, repairOrders: 4, sales: 2, branches: 1 },
    }])
    // sale.groupBy se llama dos veces: totales COMPLETED y última actividad.
    mocks.saleGroup
      .mockResolvedValueOnce([{ businessId: "b1", _sum: { total: 5000 } }])
      .mockResolvedValueOnce([{ businessId: "b1", _max: { createdAt: new Date("2026-02-01T00:00:00Z") } }])
    mocks.orderGroup.mockResolvedValue([{ businessId: "b1", _max: { createdAt: new Date("2026-02-10T00:00:00Z") } }])

    const res = await listBusinesses()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("no-store")
    const { businesses } = await res.json()
    expect(businesses).toHaveLength(1)
    expect(businesses[0].counts).toEqual({ users: 3, products: 10, repairOrders: 4, sales: 2, branches: 1 })
    expect(businesses[0].salesTotal).toBe(5000)
    // La última actividad es el máximo entre venta y orden.
    expect(businesses[0].lastActivityAt).toBe("2026-02-10T00:00:00.000Z")
    expect(businesses[0]).not.toHaveProperty("password")
    expect(businesses[0]).not.toHaveProperty("users")
  })

  it("returns 404 detail for an unknown business and full detail when it exists", async () => {
    mocks.auth.mockResolvedValue(superAdmin)
    mocks.findBusiness.mockResolvedValueOnce(null)
    expect((await businessDetail(new Request("https://app.invalid/api/platform/businesses/nope"), paramsOf("nope"))).status).toBe(404)

    const now = new Date("2026-03-01T00:00:00Z")
    mocks.findBusiness.mockResolvedValue({
      id: "b1", name: "Taller Uno", slug: "taller-uno", category: "electronics-repair", isActive: true,
      createdAt: now, updatedAt: now, phone: "555", address: "Calle 1", logoUrl: null,
      _count: { users: 5, products: 1, repairOrders: 1, sales: 1, branches: 1 },
    })
    mocks.findUsers.mockResolvedValue([{ id: "u1", name: "Dueño", email: "d@t.invalid", role: "ADMIN", status: "APPROVED", jobTitle: null, isSuperAdmin: false, createdAt: now }])
    mocks.findOrders.mockResolvedValue([{ id: "o1", number: 7, status: "READY", createdAt: now, quoteCents: 150000, approvedQuoteCents: null }])
    mocks.findSales.mockResolvedValue([{ id: "s1", number: 3, status: "COMPLETED", createdAt: now, total: 999 }])
    mocks.saleAggregate.mockResolvedValue({ _sum: { total: 999 } })
    mocks.findOrderFirst.mockResolvedValue({ createdAt: now })
    mocks.findSaleFirst.mockResolvedValue({ createdAt: now })

    const res = await businessDetail(new Request("https://app.invalid/api/platform/businesses/b1"), paramsOf("b1"))
    expect(res.status).toBe(200)
    const { business } = await res.json()
    expect(business.counts.users).toBe(5)
    expect(business.salesTotal).toBe(999)
    expect(business.recentRepairOrders[0].folio).toBe("OT-000007")
    // Sin cotización aprobada, cae a la propuesta.
    expect(business.recentRepairOrders[0].totalCents).toBe(150000)
    expect(business.recentSales[0].folio).toBe("V-000003")
    expect(business.users[0].email).toBe("d@t.invalid")
    expect(business.users[0]).not.toHaveProperty("password")
  })

  it("PATCH validates the body, 404s unknown ids and toggles isActive", async () => {
    mocks.auth.mockResolvedValue(superAdmin)

    // JSON inválido y body con tipo incorrecto → 400 sin tocar la base.
    expect((await patchBusiness(patchReq("b1", "{bad json"), paramsOf("b1"))).status).toBe(400)
    expect((await patchBusiness(patchReq("b1", JSON.stringify({ isActive: "yes" })), paramsOf("b1"))).status).toBe(400)
    expect(mocks.updateBusiness).not.toHaveBeenCalled()

    mocks.findBusiness.mockResolvedValueOnce(null)
    expect((await patchBusiness(patchReq("missing", JSON.stringify({ isActive: false })), paramsOf("missing"))).status).toBe(404)

    mocks.findBusiness.mockResolvedValueOnce({ id: "b1", name: "Taller Uno", slug: "taller-uno" })
    mocks.updateBusiness.mockResolvedValue({ id: "b1", name: "Taller Uno", slug: "taller-uno", isActive: false, updatedAt: new Date() })
    const res = await patchBusiness(patchReq("b1", JSON.stringify({ isActive: false })), paramsOf("b1"))
    expect(res.status).toBe(200)
    expect(mocks.updateBusiness).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "b1" }, data: { isActive: false } }))
    expect((await res.json()).business.isActive).toBe(false)

    // Bitácora: suspensión queda registrada con snapshot del negocio + actor.
    expect(mocks.platformEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "b1",
        businessSlug: "taller-uno",
        businessName: "Taller Uno",
        kind: "TENANT_SUSPENDED",
        actorId: "op",
      }),
    })
  })

  describe("DELETE (empresa vacía)", () => {
    const del = (id: string) =>
      deleteBusiness(new Request(`https://app.invalid/api/platform/businesses/${id}`, { method: "DELETE" }), paramsOf(id))

    it("denies anonymous sessions and tenant admins before any database read", async () => {
      for (const session of [null, tenantAdmin]) {
        mocks.auth.mockResolvedValue(session)
        expect([401, 403]).toContain((await del("b1")).status)
      }
      expect(mocks.findBusiness).not.toHaveBeenCalled()
      expect(mocks.businessDelete).not.toHaveBeenCalled()
    })

    it("returns 404 for an unknown business", async () => {
      mocks.auth.mockResolvedValue(superAdmin)
      mocks.findBusiness.mockResolvedValueOnce(null)
      expect((await del("missing")).status).toBe(404)
      expect(mocks.businessDelete).not.toHaveBeenCalled()
    })

    it("rejects with 409 when the business has operational data", async () => {
      mocks.auth.mockResolvedValue(superAdmin)
      mocks.findBusiness.mockResolvedValue({ id: "b1", name: "Taller Uno", slug: "taller-uno" })
      mocks.count.sale.mockResolvedValueOnce(3)
      mocks.count.product.mockResolvedValueOnce(2)

      const res = await del("b1")
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain("Suspéndela")
      expect(body.blockers).toMatchObject({ sale: 3, product: 2 })
      // Gate falló antes de la transacción: nada se borró.
      expect(mocks.del.user).not.toHaveBeenCalled()
      expect(mocks.businessDelete).not.toHaveBeenCalled()
    })

    it("deletes an empty business inside a transaction, seed rows first", async () => {
      mocks.auth.mockResolvedValue(superAdmin)
      mocks.findBusiness.mockResolvedValue({ id: "b1", name: "Alta basura", slug: "alta-basura" })

      const res = await del("b1")
      expect(res.status).toBe(200)
      expect((await res.json()).deleted).toBe("alta-basura")

      // Tablas con FK Restrict a user se borran antes que el user.
      for (const accessor of ["businessOperation", "auditEvent", "pushSubscription", "settings", "systemSettings", "workshopService", "user", "branch"]) {
        expect(mocks.del[accessor as keyof typeof mocks.del]).toHaveBeenCalledWith({ where: { businessId: "b1" } })
      }
      expect(mocks.del.businessOperation.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.del.user.mock.invocationCallOrder[0])
      expect(mocks.del.auditEvent.mock.invocationCallOrder[0])
        .toBeLessThan(mocks.del.user.mock.invocationCallOrder[0])
      expect(mocks.businessDelete).toHaveBeenCalledWith({ where: { id: "b1" } })
      // La bitácora se escribe DENTRO de la tx (sobrevive al borrado: sin FK).
      expect(mocks.platformEventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: "TENANT_DELETED", businessSlug: "alta-basura", actorId: "op" }),
      })
    })

    it("maps a residual FK violation inside the transaction to 409", async () => {
      mocks.auth.mockResolvedValue(superAdmin)
      mocks.findBusiness.mockResolvedValue({ id: "b1", name: "Taller Uno", slug: "taller-uno" })
      mocks.businessDelete.mockRejectedValueOnce({ code: "P2014" })

      const res = await del("b1")
      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain("Suspéndela")
    })
  })
})
