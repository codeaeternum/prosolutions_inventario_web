import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * /api/credit/users/[id]
 *
 * GET: consulta del expediente de crédito — staff con el módulo "credito".
 * PATCH: mueve creditLimit — SOLO ADMIN (un empleado del módulo podría
 * inflar cuánto puede deber un cliente). El límite es finito, ≥ 0 y con
 * tope razonable ($10,000,000).
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/audit-alerts", () => ({
  ALERTED_ACTIONS: new Set(["CUSTOMER_UPDATE"]),
  alertSensitiveAudit: vi.fn(async () => {}),
  escapeAlertHtml: (v: string) => v,
  notifyOwner: vi.fn(async () => false),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      update: mocks.userUpdate,
    },
    auditEvent: { create: mocks.auditCreate },
  },
}))

import { GET, PATCH } from "@/app/api/credit/users/[id]/route"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const customer = (over: Record<string, unknown> = {}) => ({
  id: "c-1",
  name: "Taller Ruiz",
  creditLimit: 1000,
  creditBalance: 0,
  ...over,
})

const params = { params: Promise.resolve({ id: "c-1" }) }
const patch = (body: string) =>
  PATCH(
    new NextRequest("https://app.invalid/api/credit/users/c-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    params
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session("u-admin", "ADMIN"))
  mocks.userFindUnique.mockResolvedValue({ id: "c-1", name: "Taller Ruiz" })
  mocks.userFindFirst.mockResolvedValue(customer())
  mocks.userUpdate.mockImplementation(async ({ data }: { data: { creditLimit: number | null } }) => ({
    id: "c-1",
    creditLimit: data.creditLimit,
    creditBalance: 0,
  }))
  mocks.auditCreate.mockResolvedValue({})
})

describe("GET", () => {
  it("empleado con el módulo credito sí consulta el expediente", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["credito"] }))
    const res = await GET(new NextRequest("https://app.invalid/api/credit/users/c-1"), params)
    expect(res.status).toBe(200)
    expect(mocks.userFindUnique).toHaveBeenCalled()
  })
})

describe("PATCH — permisos", () => {
  it("un empleado con el módulo credito NO puede mover el límite (403)", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["credito"] }))
    const res = await patch(JSON.stringify({ creditLimit: 5000 }))
    expect(res.status).toBe(403)
    expect(mocks.userFindFirst).not.toHaveBeenCalled()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("sin sesión responde 401", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await patch(JSON.stringify({ creditLimit: 5000 }))
    expect(res.status).toBe(401)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})

describe("PATCH — validación del límite", () => {
  it("rechaza Infinity vía JSON (1e999) con 400", async () => {
    const res = await patch('{"creditLimit": 1e999}')
    expect(res.status).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it.each([-1, 10_000_001, 100_000_000])("rechaza creditLimit=%s (400)", async (value) => {
    const res = await patch(JSON.stringify({ creditLimit: value }))
    expect(res.status).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("un límite por debajo de la deuda viva responde 400", async () => {
    mocks.userFindFirst.mockResolvedValue(customer({ creditBalance: 800 }))
    const res = await patch(JSON.stringify({ creditLimit: 500 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("deuda actual")
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})

describe("PATCH — cambio válido", () => {
  it("el admin sube el límite y queda en bitácora (CUSTOMER_UPDATE)", async () => {
    const res = await patch(JSON.stringify({ creditLimit: 5000 }))
    expect(res.status).toBe(200)
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.userUpdate.mock.calls[0][0].data).toEqual({ creditLimit: 5000 })
    const audit = mocks.auditCreate.mock.calls[0][0].data
    expect(audit).toMatchObject({
      action: "CUSTOMER_UPDATE",
      actorId: "u-admin",
      entityId: "c-1",
    })
    expect(audit.summary).toContain("Límite de crédito")
  })

  it("creditLimit null quita el límite (sin tope) y creditLimit 0 es válido", async () => {
    const res = await patch(JSON.stringify({ creditLimit: null }))
    expect(res.status).toBe(200)
    expect(mocks.userUpdate.mock.calls[0][0].data).toEqual({ creditLimit: null })

    const res2 = await patch(JSON.stringify({ creditLimit: 0 }))
    expect(res2.status).toBe(200)
  })
})
