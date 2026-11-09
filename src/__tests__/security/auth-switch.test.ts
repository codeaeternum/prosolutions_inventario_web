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
  businessFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  platformEventCreate: vi.fn(),
  encode: vi.fn(),
  decode: vi.fn(),
  bcryptCompare: vi.fn(),
  checkAndRecord: vi.fn(),
  alertAudit: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    business: { findUnique: mocks.businessFindUnique },
    auditEvent: { create: mocks.auditCreate },
    platformEvent: { create: mocks.platformEventCreate },
  },
}))
// recordAudit es real; solo se sustituye el grito Telegram/alerta para que el
// test pueda verificar que la acción denegada TAMBIÉN avisa al dueño.
vi.mock("@/lib/audit-alerts", () => ({
  ALERTED_ACTIONS: new Set(["AUTH_SWITCH_DENIED"]),
  alertSensitiveAudit: mocks.alertAudit,
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
const adminTarget = {
  id: "admin-2", name: "La Admin", email: null, phone: "556", role: "ADMIN", status: "APPROVED",
  customerType: "NORMAL", password: "h", jobTitle: null, businessId: "biz", isSuperAdmin: false,
  quickPin: "hash-admin", allowedModules: [], allowedBranchIds: [],
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
  mocks.platformEventCreate.mockResolvedValue({})
  mocks.businessFindUnique.mockResolvedValue({ name: "Taller Amigo", slug: "taller-amigo" })
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

describe("escalación por PIN a cuentas admin", () => {
  const empleado = { id: "emp-9", name: "Otro", role: "EMPLOYEE", status: "APPROVED", businessId: "biz", customerType: "NORMAL" }

  it("EMPLOYEE → ADMIN queda bloqueado aunque el PIN sea correcto, y queda auditado", async () => {
    mocks.auth.mockResolvedValue({ user: empleado })
    mocks.findUnique.mockResolvedValue(adminTarget)
    mocks.bcryptCompare.mockResolvedValue(true) // aunque adivinó el PIN
    const res = await POST(req({ userId: "admin-2", pin: "1234" }))
    expect(res.status).toBe(403)
    expect(mocks.encode).not.toHaveBeenCalled()
    // El intento se audita: actor empleado, cuenta objetivo admin.
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: "biz",
        actorId: "emp-9",
        action: "AUTH_SWITCH_DENIED",
        entity: "user",
        entityId: "admin-2",
        entityName: "La Admin",
      }),
    }))
    // La bitácora nunca contiene el PIN ni su hash.
    const raw = JSON.stringify(mocks.auditCreate.mock.calls[0][0].data)
    expect(raw).not.toContain("1234")
    expect(raw).not.toContain("hash-admin")
    // Además de persistir, la acción denegada avisa al dueño (alerta).
    expect(mocks.alertAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "AUTH_SWITCH_DENIED",
      actorId: "emp-9",
    }))
  })

  it("el bloqueo ocurre antes de verificar el PIN: fallar también audita", async () => {
    mocks.auth.mockResolvedValue({ user: empleado })
    mocks.findUnique.mockResolvedValue(adminTarget)
    const res = await POST(req({ userId: "admin-2", pin: "0000" }))
    expect(res.status).toBe(403)
    // Ni siquiera corrió bcrypt: escalación bloqueada por política.
    expect(mocks.bcryptCompare).not.toHaveBeenCalled()
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AUTH_SWITCH_DENIED", actorId: "emp-9", entityId: "admin-2" }),
    }))
  })

  it("un target superadmin de plataforma también queda fuera del alcance del PIN", async () => {
    mocks.auth.mockResolvedValue({ user: { ...empleado, businessId: "biz" } })
    mocks.findUnique.mockResolvedValue({ ...adminTarget, role: "EMPLOYEE", isSuperAdmin: true })
    const res = await POST(req({ userId: "admin-2", pin: "1234" }))
    expect(res.status).toBe(403)
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AUTH_SWITCH_DENIED" }),
    }))
  })

  it("EMPLOYEE → EMPLOYEE con PIN correcto sigue funcionando", async () => {
    mocks.auth.mockResolvedValue({ user: empleado })
    mocks.bcryptCompare.mockResolvedValue(true)
    const res = await POST(req({ userId: "emp-2", pin: "1234" }))
    expect(res.status).toBe(200)
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.objectContaining({ id: "emp-2", impersonator: "emp-9" }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AUTH_SWITCH", entityId: "emp-2" }),
    }))
  })

  it("ADMIN sí entra a otra cuenta ADMIN sin PIN, como antes", async () => {
    mocks.auth.mockResolvedValue({ user: owner })
    mocks.findUnique.mockResolvedValue(adminTarget)
    const res = await POST(req({ userId: "admin-2" }))
    expect(res.status).toBe(200)
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.objectContaining({ id: "admin-2", impersonator: "admin-1" }),
    }))
  })

  it("restore a la cuenta ADMIN original no pasa por el bloqueo de PIN", async () => {
    // La sesión del empleado venía impersonada por admin-1: restaurar vuelve.
    mocks.auth.mockResolvedValue({ user: { id: "emp-2", name: "Kevin", role: "EMPLOYEE", status: "APPROVED", businessId: "biz", customerType: "NORMAL" } })
    mocks.decode.mockResolvedValue({ id: "emp-2", impersonator: "admin-1" })
    mocks.findUnique.mockResolvedValue({ ...owner, email: null, phone: null, password: "h", jobTitle: null })
    const res = await POST(req({ restore: true }))
    expect(res.status).toBe(200)
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "AUTH_SWITCH_RESTORE", entityId: "admin-1" }),
    }))
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

  it("un superadmin de plataforma puede entrar en modo soporte a un negocio distinto y restaurar su cuenta", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "op-1", name: "Operador Reficio", email: "op@reficio.app", role: "ADMIN", status: "APPROVED", businessId: "biz-reficio-hq", isSuperAdmin: true, customerType: "NORMAL" },
    })
    mocks.findUnique.mockResolvedValue({
      ...cashier,
      email: "kevin@amigo.mx",
      businessId: "biz-amigo",
      isSuperAdmin: false,
      business: { name: "Taller Amigo", slug: "taller-amigo" },
    })
    const enterRes = await POST(req({ userId: "emp-2" }))
    expect(enterRes.status).toBe(200)
    expect(mocks.encode).toHaveBeenCalledWith(expect.objectContaining({
      token: expect.objectContaining({ id: "emp-2", businessId: "biz-amigo", impersonator: "op-1" }),
    }))
    expect(mocks.platformEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "SUPPORT_ENTERED",
        businessId: "biz-amigo",
        businessSlug: "taller-amigo",
        businessName: "Taller Amigo",
        actorId: "op-1",
        actorEmail: "op@reficio.app",
        detail: { targetUserId: "emp-2", targetEmail: "kevin@amigo.mx" },
      }),
    })

    // Y al restaurar desde la sesión del negocio del amigo, vuelve a su cuenta superadmin en biz-reficio-hq
    mocks.auth.mockResolvedValue({
      user: { id: "emp-2", name: "Kevin", email: "kevin@amigo.mx", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-amigo", isSuperAdmin: false, customerType: "NORMAL" },
    })
    mocks.decode.mockResolvedValue({ id: "emp-2", impersonator: "op-1" })
    mocks.findUnique.mockResolvedValue({
      id: "op-1", name: "Operador Reficio", email: "op@reficio.app", phone: null,
      role: "ADMIN", status: "APPROVED", customerType: "NORMAL", password: "h",
      jobTitle: null, businessId: "biz-reficio-hq", isSuperAdmin: true,
    })
    const restoreRes = await POST(req({ restore: true }))
    expect(restoreRes.status).toBe(200)
    const restoreJson = await restoreRes.json()
    expect(restoreJson.user.isSuperAdmin).toBe(true)
    expect(mocks.platformEventCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        kind: "SUPPORT_EXITED",
        businessId: "biz-amigo",
        actorId: "op-1",
        actorEmail: "op@reficio.app",
        detail: { targetUserId: "emp-2", targetEmail: "kevin@amigo.mx" },
      }),
    })
  })
})
