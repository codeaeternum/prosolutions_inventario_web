import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Cambio rápido de usuario (POS con PIN / "Volver a mi cuenta"): el evento
 * es de acceso — quién operó como quién — y queda en la bitácora como
 * AUTH_SWITCH / AUTH_SWITCH_RESTORE con el actor y la cuenta destino. Nunca
 * registra PIN ni tokens: el diff solo lleva ids de cuenta e impersonator.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  auditCreate: vi.fn(),
  encode: vi.fn(),
  decode: vi.fn(),
  bcryptCompare: vi.fn(),
  checkAndRecord: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    auditEvent: { create: mocks.auditCreate },
  },
}))
vi.mock("next-auth/jwt", () => ({ encode: mocks.encode, decode: mocks.decode }))
vi.mock("bcryptjs", () => ({ default: { compare: mocks.bcryptCompare } }))
vi.mock("@/lib/rate-limit", () => ({ checkAndRecord: mocks.checkAndRecord }))

import { POST } from "@/app/api/auth/switch/route"

const owner = { id: "admin-1", name: "Dueño", role: "ADMIN", status: "APPROVED", businessId: "biz", customerType: "NORMAL" }
const cashier = {
  id: "emp-2", name: "Kevin", email: null, phone: "555", role: "EMPLOYEE", status: "APPROVED",
  customerType: "NORMAL", password: null, jobTitle: "Mostrador", businessId: "biz", quickPin: "hash",
}

const req = (body: unknown, cookie = "raw-cookie") =>
  new NextRequest("http://localhost/api/auth/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `authjs.session-token=${cookie}` },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("AUTH_SECRET", "test-secret")
  mocks.checkAndRecord.mockReturnValue(true)
  mocks.encode.mockResolvedValue("signed-token")
  mocks.decode.mockResolvedValue({ id: "admin-1" }) // sesión propia, sin impersonator
  mocks.auditCreate.mockResolvedValue({})
  mocks.findUnique.mockResolvedValue(cashier)
})

describe("cambio de cuenta", () => {
  it("un admin que entra a otra cuenta deja AUTH_SWITCH con actor y destino", async () => {
    mocks.auth.mockResolvedValue({ user: owner })
    const res = await POST(req({ userId: "emp-2" }))
    expect(res.status).toBe(200)
    // La sesión minteada lleva el impersonator.
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.objectContaining({ id: "emp-2", impersonator: "admin-1" }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: "biz", actorId: "admin-1", action: "AUTH_SWITCH",
        entity: "user", entityId: "emp-2", entityName: "Kevin",
        changes: {
          cuenta: { before: "admin-1", after: "emp-2" },
          impersonador: { before: null, after: "admin-1" },
        },
      }),
    }))
    // Defensa: el evento nunca lleva PIN ni el token firmado.
    const data = mocks.auditCreate.mock.calls[0][0].data
    expect(JSON.stringify(data)).not.toContain("signed-token")
    expect(JSON.stringify(data)).not.toContain("quickPin")
  })

  it("un PIN equivocado no cambia de cuenta ni ensucia la bitácora", async () => {
    // Otro empleado intenta entrar a la cuenta de Kevin con un PIN errado.
    mocks.auth.mockResolvedValue({ user: { id: "emp-9", name: "Otro", role: "EMPLOYEE", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } })
    mocks.bcryptCompare.mockResolvedValue(false)
    const res = await POST(req({ userId: "emp-2", pin: "0000" }))
    expect(res.status).toBe(403)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.encode).not.toHaveBeenCalled()
  })

  it("un usuario de OTRO negocio responde 404 sin auditoría", async () => {
    mocks.auth.mockResolvedValue({ user: owner })
    mocks.findUnique.mockResolvedValue({ ...cashier, businessId: "biz-ajena" })
    const res = await POST(req({ userId: "emp-2" }))
    expect(res.status).toBe(404)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })
})

describe("restaurar la cuenta original", () => {
  const backToOwner = { ...owner, email: null, phone: null, password: "h", jobTitle: null, customerType: "NORMAL" }

  it("el restore graba AUTH_SWITCH_RESTORE firmado por la cuenta que vuelve", async () => {
    // La sesión activa es la del empleado impersonado; el token traía
    // impersonator=admin-1.
    mocks.auth.mockResolvedValue({ user: { id: "emp-2", name: "Kevin", role: "EMPLOYEE", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } })
    mocks.decode.mockResolvedValue({ id: "emp-2", impersonator: "admin-1" })
    mocks.findUnique.mockResolvedValue(backToOwner)
    const res = await POST(req({ restore: true }))
    expect(res.status).toBe(200)
    // El token restaurado ya no lleva impersonator.
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.objectContaining({ id: "admin-1", impersonator: null }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "AUTH_SWITCH_RESTORE", entity: "user", entityId: "admin-1",
        actorId: "admin-1",
        changes: {
          cuenta: { before: "emp-2", after: "admin-1" },
          impersonador: { before: "admin-1", after: null },
        },
      }),
    }))
  })

  it("sin impersonator vigente el restore responde 400 y no audita", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "emp-2", name: "Kevin", role: "EMPLOYEE", status: "APPROVED", businessId: "biz" } })
    mocks.decode.mockResolvedValue({ id: "emp-2" }) // sesión propia
    const res = await POST(req({ restore: true }))
    expect(res.status).toBe(400)
    expect(mocks.auditCreate).not.toHaveBeenCalled()
    expect(mocks.encode).not.toHaveBeenCalled()
  })
})
