import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/workshop/[id]/delegar — delegación saliente al taller asociado.
 *
 * La operación copia PII del cliente a OTRO tenant (la orden espejo),
 * compromete el precio convenio (cuenta por pagar real) y congela la orden
 * local sin reversa: es solo ADMIN — el dominio además lo exige antes de
 * crear la espejo (doble candado, mismo nivel que REFUND).
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  delegate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/domain/delegation", () => ({ delegateRepairToPartner: mocks.delegate }))

import { POST } from "@/app/api/workshop/[id]/delegar/route"

const session = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  user: { id, role, status: "APPROVED", businessId: "biz-1", ...extra },
})

const post = (body: unknown, id = "o1") =>
  POST(
    new Request(`https://app.invalid/api/workshop/${id}/delegar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(session("u-admin", "ADMIN"))
})

describe("permisos", () => {
  it("un empleado CON el módulo taller NO puede delegar (403, sin tocar el dominio)", async () => {
    mocks.auth.mockResolvedValue(session("u-emp", "EMPLOYEE", { allowedModules: ["taller"] }))
    const res = await post({ partnerPriceCents: 35000 })
    expect(res.status).toBe(403)
    expect(mocks.delegate).not.toHaveBeenCalled()
  })

  it("un CUSTOMER recibe 403 en la barrera del módulo", async () => {
    mocks.auth.mockResolvedValue(session("u-cust", "CUSTOMER"))
    const res = await post({})
    expect(res.status).toBe(403)
    expect(mocks.delegate).not.toHaveBeenCalled()
  })

  it("sin sesión responde 401", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await post({})
    expect(res.status).toBe(401)
    expect(mocks.delegate).not.toHaveBeenCalled()
  })

  it("un ADMIN sí delega y recibe el folio de la espejo", async () => {
    mocks.delegate.mockResolvedValue({
      delegated: true, alreadyDelegated: false,
      mirrorOrderId: "m1", mirrorFolio: "OT-000012", mirrorStatus: "RECEIVED",
      partnerName: "Reparador SA",
    })
    const res = await post({ partnerPriceCents: 35000, note: "Cliente con prisa" })
    expect(res.status).toBe(200)
    expect(mocks.delegate).toHaveBeenCalledWith(
      expect.anything(), "u-admin", "biz-1", "o1",
      expect.objectContaining({ partnerPriceCents: 35000, note: "Cliente con prisa" }),
    )
    const json = await res.json()
    expect(json.mirrorFolio).toBe("OT-000012")
    expect(json.partnerName).toBe("Reparador SA")
  })
})
