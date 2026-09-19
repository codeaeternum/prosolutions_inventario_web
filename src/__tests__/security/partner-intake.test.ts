import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Intake de talleres aliados (/api/workshop/partner): un usuario del negocio
 * ALIADO crea la orden en el tenant del taller reparador configurado en su
 * SystemSettings["repair_partner_business_id"]. El actor de la operación es
 * staff del reparador; la captura queda auditada con recordedById/origen.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  settingFindUnique: vi.fn(),
  businessFindUnique: vi.fn(),
  branchFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  orderFindMany: vi.fn(),
  createRepair: vi.fn(),
  getBusinessSetting: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSettings: { findUnique: mocks.settingFindUnique },
    business: { findUnique: mocks.businessFindUnique },
    branch: { findFirst: mocks.branchFindFirst },
    user: { findFirst: mocks.userFindFirst },
    repairOrder: { findMany: mocks.orderFindMany },
  },
}))
vi.mock("@/lib/domain/workshop", () => ({ createRepair: mocks.createRepair }))
vi.mock("@/lib/settings", () => ({ getBusinessSetting: mocks.getBusinessSetting }))

import { GET as partnerOrders, POST as partnerIntake } from "@/app/api/workshop/partner/route"

const session = (role: string, over: Record<string, unknown> = {}) => ({
  user: { id: `u-${role}`, role, status: "APPROVED", businessId: "biz-partner", name: "Marisol Aliado", ...over },
})
const postReq = (body: unknown) =>
  new Request("https://app.invalid/api/workshop/partner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
const validBody = {
  customerName: "Ana López",
  customerPhone: "8112345678",
  equipmentType: "Celular",
  reportedIssue: "No enciende",
  partnerPriceCents: 35000,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settingFindUnique.mockResolvedValue({ value: "biz-repairer" })
  // Partner business primero (name), reparador después (isActive): el orden
  // del Promise.all de la ruta es [partner, repairer, branch, actor] pero
  // business.findUnique se llama dos veces — se distingue por el where.id.
  mocks.businessFindUnique.mockImplementation(({ where }) =>
    Promise.resolve(where.id === "biz-partner" ? { name: "Telcel Centro" } : { isActive: true }))
  mocks.branchFindFirst.mockResolvedValue({ id: "b-repair" })
  mocks.userFindFirst.mockResolvedValue({ id: "u-repairer-staff" })
  mocks.createRepair.mockResolvedValue({ order: { id: "o1", number: 9 } })
  mocks.orderFindMany.mockResolvedValue([])
  mocks.getBusinessSetting.mockResolvedValue("PS")
})

describe("POST /api/workshop/partner", () => {
  it("sin sesión responde 401", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await partnerIntake(postReq(validBody))
    expect(res.status).toBe(401)
    expect(mocks.createRepair).not.toHaveBeenCalled()
  })

  it("rol CUSTOMER no puede capturar órdenes (403)", async () => {
    mocks.auth.mockResolvedValue(session("CUSTOMER"))
    const res = await partnerIntake(postReq(validBody))
    expect(res.status).toBe(403)
    expect(mocks.createRepair).not.toHaveBeenCalled()
  })

  it.each(["ADMIN", "EMPLOYEE", "WORKSHOP"])("rol %s del aliado sí captura", async role => {
    mocks.auth.mockResolvedValue(session(role))
    const res = await partnerIntake(postReq(validBody))
    expect(res.status).toBe(201)
  })

  it("sin taller asociado configurado responde 400 y no crea nada", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    mocks.settingFindUnique.mockResolvedValue(null)
    const res = await partnerIntake(postReq(validBody))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("Este negocio no tiene taller asociado configurado")
    expect(mocks.createRepair).not.toHaveBeenCalled()
  })

  it("crea la orden EN EL TENANT REPARADOR con el aliado como origen", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    const res = await partnerIntake(postReq(validBody))
    expect(res.status).toBe(201)
    expect(mocks.createRepair).toHaveBeenCalledWith(
      expect.anything(),
      "u-repairer-staff",
      "biz-repairer",
      expect.objectContaining({
        customerName: "Ana López",
        intakeBranchId: "b-repair",
        originBusinessId: "biz-partner",
        originBusinessName: "Telcel Centro",
        partnerPriceCents: 35000,
      }),
      expect.objectContaining({ recordedById: "u-WORKSHOP" }),
    )
  })

  it("originContact lleva el nombre del usuario aliado que capturó", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    await partnerIntake(postReq({ ...validBody, originContact: "ext. 42" }))
    const payload = mocks.createRepair.mock.calls[0][3] as { originContact?: string }
    expect(payload.originContact).toBe("Marisol Aliado · ext. 42")
  })

  it("el taller inactivo o sin sucursal/staff rechaza antes de crear", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    mocks.businessFindUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.id === "biz-partner" ? { name: "Telcel Centro" } : { isActive: false }))
    expect((await partnerIntake(postReq(validBody))).status).toBe(400)

    mocks.businessFindUnique.mockImplementation(({ where }) =>
      Promise.resolve(where.id === "biz-partner" ? { name: "Telcel Centro" } : { isActive: true }))
    mocks.branchFindFirst.mockResolvedValue(null)
    expect((await partnerIntake(postReq(validBody))).status).toBe(409)

    mocks.branchFindFirst.mockResolvedValue({ id: "b-repair" })
    mocks.userFindFirst.mockResolvedValue(null)
    expect((await partnerIntake(postReq(validBody))).status).toBe(409)
    expect(mocks.createRepair).not.toHaveBeenCalled()
  })

  it("body inválido responde 400", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    const res = await partnerIntake(postReq({ customerName: "Ana" }))
    expect(res.status).toBe(400)
    expect(mocks.createRepair).not.toHaveBeenCalled()
  })
})

describe("GET /api/workshop/partner", () => {
  it("lista solo las órdenes originadas por el negocio de quien consulta", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    mocks.orderFindMany.mockResolvedValue([
      {
        businessId: "biz-repairer", number: 9, status: "IN_REPAIR",
        customerName: "Ana López", customerPhone: "8112345678",
        equipmentType: "Celular", brand: "Moto", model: "G",
        reportedIssue: "No enciende", createdAt: new Date("2026-02-01"), promisedAt: null,
      },
    ])
    const res = await partnerOrders()
    expect(res.status).toBe(200)
    const where = (mocks.orderFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where).toMatchObject({ originBusinessId: "biz-partner" })
    const json = await res.json()
    expect(json.orders).toHaveLength(1)
    expect(json.orders[0]).toMatchObject({
      number: 9, folio: "PS-000009", status: "IN_REPAIR",
      statusLabel: "En reparación", customerName: "Ana López",
    })
    expect(res.headers.get("cache-control")).toContain("no-store")
  })
})
