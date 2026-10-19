import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/cash-requests/[id] — decisión sobre una solicitud de gasto.
 *
 * Aprobar asienta un CashMovement OUT real: la decisión es solo ADMIN, no
 * cualquier empleado con el módulo caja. La auto-aprobación sigue bloqueada
 * dentro de decide() aunque el actor sea admin.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  cashRequestFindUnique: vi.fn(),
  cashRequestFindUniqueOrThrow: vi.fn(),
  cashRequestUpdateMany: vi.fn(),
  cashMovementCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}))

import { POST } from "@/app/api/cash-requests/[id]/route"

const tx = {
  cashRequest: {
    findUnique: mocks.cashRequestFindUnique,
    findUniqueOrThrow: mocks.cashRequestFindUniqueOrThrow,
    updateMany: mocks.cashRequestUpdateMany,
  },
  cashMovement: { create: mocks.cashMovementCreate },
}

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const post = (body: unknown, id = "cr-1") =>
  POST(
    new Request(`https://app.invalid/api/cash-requests/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session("u-admin", "ADMIN"))
  mocks.transaction.mockImplementation((work: (t: unknown) => unknown) => work(tx))
  mocks.cashRequestFindUnique.mockResolvedValue(null)
  mocks.cashRequestUpdateMany.mockResolvedValue({ count: 1 })
  mocks.cashRequestFindUniqueOrThrow.mockResolvedValue({ id: "cr-1", status: "REJECTED" })
})

describe("permisos", () => {
  it("un empleado CON el módulo caja NO puede decidir (403, sin tocar la BD)", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["caja"] }))
    const res = await post({ decision: "APPROVE" })
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.cashRequestFindUnique).not.toHaveBeenCalled()
  })

  it("un CUSTOMER recibe 403", async () => {
    mocks.auth.mockResolvedValue(session("u-cust", "CUSTOMER"))
    const res = await post({ decision: "REJECT" })
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("sin sesión responde 401", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await post({ decision: "APPROVE" })
    expect(res.status).toBe(401)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("un ADMIN sí llega a la decisión (404 sobre solicitud inexistente)", async () => {
    const res = await post({ decision: "REJECT" })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain("Solicitud no encontrada")
    expect(mocks.cashRequestFindUnique).toHaveBeenCalled()
  })
})

describe("decisión", () => {
  it("el admin puede rechazar la solicitud de otro (200, sin CashMovement)", async () => {
    mocks.cashRequestFindUnique.mockResolvedValue({
      id: "cr-1",
      businessId: "biz-1",
      requestedById: "u-emp",
      status: "PENDING",
    })
    const res = await post({ decision: "REJECT", note: "No procede" })
    expect(res.status).toBe(200)
    expect(mocks.cashRequestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REJECTED" }) })
    )
    expect(mocks.cashMovementCreate).not.toHaveBeenCalled()
  })

  it("la auto-aprobación sigue bloqueada aunque el actor sea ADMIN (403)", async () => {
    mocks.cashRequestFindUnique.mockResolvedValue({
      id: "cr-1",
      businessId: "biz-1",
      requestedById: "u-admin",
      status: "PENDING",
    })
    const res = await post({ decision: "APPROVE" })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain("propio gasto")
    expect(mocks.cashRequestUpdateMany).not.toHaveBeenCalled()
    expect(mocks.cashMovementCreate).not.toHaveBeenCalled()
  })
})
