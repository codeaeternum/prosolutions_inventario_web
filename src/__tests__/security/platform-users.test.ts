import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  platformEventCreate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
    },
    platformEvent: {
      create: mocks.platformEventCreate,
    },
    $transaction: mocks.transaction,
  },
}))

import { PATCH } from "@/app/api/platform/users/[id]/route"

const superAdminSession = {
  user: {
    id: "op-1",
    email: "admin@reficio.app",
    role: "ADMIN",
    status: "APPROVED",
    businessId: "biz-reficio-hq",
    isSuperAdmin: true,
  },
}

const patchReq = (body: unknown) =>
  new Request("https://app.invalid/api/platform/users/u-target", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

describe("PATCH /api/platform/users/[id] — gestión de permiso isSuperAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(superAdminSession)
    mocks.transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
    mocks.userFindUnique.mockResolvedValue({
      id: "u-target",
      name: "Administrador ProSolutions",
      email: "admin@prosolutions.com",
      role: "ADMIN",
      isSuperAdmin: false,
      business: { id: "biz-default", name: "ProSolutions", slug: "prosolutions" },
    })
    mocks.userUpdate.mockResolvedValue({
      id: "u-target",
      name: "Administrador ProSolutions",
      email: "admin@prosolutions.com",
      isSuperAdmin: true,
    })
    mocks.platformEventCreate.mockResolvedValue({ id: "ev-1" })
  })

  it("bloquea con 403 a un ADMIN de negocio que no es superadmin", async () => {
    mocks.auth.mockResolvedValue({
      user: { ...superAdminSession.user, isSuperAdmin: false },
    })
    const res = await PATCH(patchReq({ isSuperAdmin: true }), {
      params: Promise.resolve({ id: "u-target" }),
    })
    expect(res.status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("impide que el operador activo se revoque isSuperAdmin a sí mismo (400 anti-lockout)", async () => {
    const res = await PATCH(patchReq({ isSuperAdmin: false }), {
      params: Promise.resolve({ id: "op-1" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("No puedes quitarte el permiso")
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("otorga o revoca isSuperAdmin a otro usuario y registra PlatformEvent", async () => {
    const res = await PATCH(patchReq({ isSuperAdmin: true }), {
      params: Promise.resolve({ id: "u-target" }),
    })
    expect(res.status).toBe(200)
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "u-target" },
      data: { isSuperAdmin: true },
      select: { id: true, name: true, email: true, isSuperAdmin: true },
    })
    expect(mocks.platformEventCreate).toHaveBeenCalledWith({
      data: {
        businessId: "biz-default",
        businessSlug: "prosolutions",
        businessName: "ProSolutions",
        kind: "SUPERADMIN_GRANTED",
        actorId: "op-1",
        actorEmail: "admin@reficio.app",
        detail: {
          targetUserId: "u-target",
          targetUserName: "Administrador ProSolutions",
          targetUserEmail: "admin@prosolutions.com",
        },
      },
    })
  })

  it("rechaza otorgar isSuperAdmin a una cuenta que no es ADMIN ni EMPLOYEE (400)", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: "u-customer",
      name: "Cliente Mostrador",
      email: "cliente@correo.mx",
      role: "CUSTOMER",
      isSuperAdmin: false,
      business: { id: "biz-default", name: "ProSolutions", slug: "prosolutions" },
    })
    const res = await PATCH(patchReq({ isSuperAdmin: true }), {
      params: Promise.resolve({ id: "u-customer" }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("administrador o empleado")
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("permite restablecer la contraseña y editar datos de un usuario registrando USER_CREDENTIALS_UPDATED", async () => {
    const res = await PATCH(
      patchReq({ name: "Dueño Actualizado", email: "dueno@taller.mx", newPassword: "NuevaPassword123" }),
      { params: Promise.resolve({ id: "u-target" }) },
    )
    expect(res.status).toBe(200)
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: "u-target" },
      data: expect.objectContaining({
        name: "Dueño Actualizado",
        email: "dueno@taller.mx",
        password: expect.stringMatching(/^\$2[aby]\$/),
      }),
      select: { id: true, name: true, email: true, isSuperAdmin: true },
    })
    expect(mocks.platformEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "USER_CREDENTIALS_UPDATED",
        businessId: "biz-default",
      }),
    })
  })
})
