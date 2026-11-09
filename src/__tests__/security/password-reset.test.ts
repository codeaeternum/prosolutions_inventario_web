import { beforeEach, describe, expect, it, vi } from "vitest"
import bcrypt from "bcryptjs"
import { VerificationError } from "@/lib/verification"
import { getAuthRedirect } from "@/lib/auth.config"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  recordAudit: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  userUpdate: vi.fn(),
  issueVerificationCode: vi.fn(),
  consumeVerificationCode: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendTelegramMessage: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
  handlers: { GET: vi.fn(), POST: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      findMany: mocks.userFindMany,
      update: mocks.userUpdate,
    },
  },
}))

vi.mock("@/lib/verification", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/verification")>()
  return {
    ...actual,
    issueVerificationCode: mocks.issueVerificationCode,
    consumeVerificationCode: mocks.consumeVerificationCode,
  }
})

vi.mock("@/lib/mailer", () => ({
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}))

vi.mock("@/lib/telegram", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/telegram")>()
  return {
    ...actual,
    sendTelegramMessage: mocks.sendTelegramMessage,
  }
})

vi.mock("@/lib/audit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/audit")>()
  return {
    ...actual,
    recordAudit: mocks.recordAudit,
  }
})

import { POST as requestReset } from "@/app/api/auth/password-reset/request/route"
import { POST as confirmReset } from "@/app/api/auth/password-reset/confirm/route"
import { PATCH as patchUser } from "@/app/api/users/[id]/route"

vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const nextIp = () => `10.77.${Math.floor(++ipCounter / 200)}.${(ipCounter % 200) + 1}`

const reqPost = (url: string, body: unknown, ip = nextIp()) =>
  new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": ip,
    },
    body: JSON.stringify(body),
  })

const patchReq = (body: unknown) =>
  new Request("https://app.invalid/api/users/u-2", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const BIZ = "biz-test"
const adminSession = () => ({
  user: { id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ, customerType: "NORMAL" },
})
const employeeWithUsersModule = () => ({
  user: {
    id: "emp-1",
    role: "EMPLOYEE",
    status: "APPROVED",
    businessId: BIZ,
    customerType: "NORMAL",
    allowedModules: ["usuarios"],
  },
})

const existingTarget = (over: Record<string, unknown> = {}) => ({
  id: "u-2",
  name: "Empleado Dos",
  status: "APPROVED",
  customerType: "NORMAL",
  role: "EMPLOYEE",
  isSuperAdmin: false,
  homeBranchId: null,
  jobTitle: null,
  publicSlug: null,
  allowedModules: ["ventas"],
  allowedBranchIds: [],
  payType: "NONE",
  payRateCents: null,
  commissionPct: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.userFindMany.mockResolvedValue([])
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.userFindUnique.mockResolvedValue(existingTarget())
  mocks.userUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...existingTarget(),
    email: "dos@test.mx",
    ...data,
  }))
  mocks.issueVerificationCode.mockResolvedValue({
    code: "654321",
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  })
  mocks.sendPasswordResetEmail.mockResolvedValue({ sent: true })
  mocks.sendTelegramMessage.mockResolvedValue(true)
})

describe("POST /api/auth/password-reset/request", () => {
  it("200 con cuenta existente: emite código con purpose PASSWORD_RESET y envía por email/Telegram", async () => {
    mocks.userFindMany.mockResolvedValue([
      {
        id: "u-1",
        businessId: BIZ,
        email: "usuario@taller.mx",
        phone: "5512345678",
        telegramId: "tg-999",
        status: "APPROVED",
        business: { name: "Taller Central", isActive: true },
      },
    ])

    const res = await requestReset(
      reqPost("https://app.invalid/api/auth/password-reset/request", {
        identifier: "  USUARIO@Taller.mx ",
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(await res.json()).toEqual({
      ok: true,
      message: "Si la cuenta existe, enviamos un código de 6 dígitos.",
    })
    expect(mocks.issueVerificationCode).toHaveBeenCalledWith(expect.anything(), {
      userId: "u-1",
      businessId: BIZ,
      identifier: "usuario@taller.mx",
      channel: "EMAIL",
      purpose: "PASSWORD_RESET",
    })
    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      "usuario@taller.mx",
      "654321",
      "Taller Central",
    )
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
      "tg-999",
      expect.stringContaining("654321"),
    )
  })

  it("200 anti-enumeración cuando la cuenta no existe (misma respuesta, no emite código)", async () => {
    mocks.userFindMany.mockResolvedValue([])

    const res = await requestReset(
      reqPost("https://app.invalid/api/auth/password-reset/request", {
        identifier: "noexiste@taller.mx",
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(await res.json()).toEqual({
      ok: true,
      message: "Si la cuenta existe, enviamos un código de 6 dígitos.",
    })
    expect(mocks.issueVerificationCode).not.toHaveBeenCalled()
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled()
  })

  it("429 rate-limit cuando se excede el límite por identifier o por IP", async () => {
    const fixedIp = nextIp()
    for (let i = 0; i < 5; i++) {
      const okRes = await requestReset(
        reqPost(
          "https://app.invalid/api/auth/password-reset/request",
          { identifier: "flood@taller.mx" },
          fixedIp,
        ),
      )
      expect(okRes.status).toBe(200)
    }

    const blockedById = await requestReset(
      reqPost(
        "https://app.invalid/api/auth/password-reset/request",
        { identifier: "flood@taller.mx" },
        nextIp(),
      ),
    )
    expect(blockedById.status).toBe(429)

    // Límite por IP (10 intentos por IP cada 15 min)
    const ipForFlood = nextIp()
    for (let i = 0; i < 10; i++) {
      const r = await requestReset(
        reqPost(
          "https://app.invalid/api/auth/password-reset/request",
          { identifier: `user-${i}@taller.mx` },
          ipForFlood,
        ),
      )
      expect(r.status).toBe(200)
    }
    const blockedByIp = await requestReset(
      reqPost(
        "https://app.invalid/api/auth/password-reset/request",
        { identifier: "user-extra@taller.mx" },
        ipForFlood,
      ),
    )
    expect(blockedByIp.status).toBe(429)
  })
})

describe("POST /api/auth/password-reset/confirm", () => {
  it("200 cambia password con bcrypt, consume el código PASSWORD_RESET y registra auditoría sin exponer password", async () => {
    mocks.consumeVerificationCode.mockResolvedValue({
      id: "vc-1",
      userId: "u-1",
      businessId: BIZ,
      identifier: "usuario@taller.mx",
      channel: "EMAIL",
      purpose: "PASSWORD_RESET",
      consumedAt: new Date(),
    })
    mocks.userUpdate.mockResolvedValue({
      id: "u-1",
      name: "Usuario Uno",
      businessId: BIZ,
    })

    const plainPassword = "MiNuevaPasswordSegura99!"
    const res = await confirmReset(
      reqPost("https://app.invalid/api/auth/password-reset/confirm", {
        identifier: "Usuario@Taller.mx",
        code: "654321",
        newPassword: plainPassword,
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.consumeVerificationCode).toHaveBeenCalledWith(expect.anything(), {
      identifier: "usuario@taller.mx",
      code: "654321",
      purpose: "PASSWORD_RESET",
    })

    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
    const updateCall = mocks.userUpdate.mock.calls[0][0]
    expect(updateCall.where).toEqual({ id: "u-1" })
    expect(updateCall.data.password).not.toBe(plainPassword)
    expect(await bcrypt.compare(plainPassword, updateCall.data.password)).toBe(true)

    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
    const auditEntry = mocks.recordAudit.mock.calls[0][1]
    expect(auditEntry).toMatchObject({
      businessId: BIZ,
      actorId: "u-1",
      action: "USER_PASSWORD_RESET",
      entity: "user",
      entityId: "u-1",
      summary: "Restableció su contraseña con código de verificación",
    })
    expect(JSON.stringify(auditEntry)).not.toContain(plainPassword)
    expect(JSON.stringify(auditEntry)).not.toContain(updateCall.data.password)
  })

  it("400 cuando el código es inválido o expirado", async () => {
    mocks.consumeVerificationCode.mockRejectedValue(
      new VerificationError("EXPIRED", "El código expiró"),
    )

    const res = await confirmReset(
      reqPost("https://app.invalid/api/auth/password-reset/confirm", {
        identifier: "usuario@taller.mx",
        code: "111111",
        newPassword: "PasswordValida123",
      }),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Código inválido o expirado/i)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it("400 cuando newPassword tiene menos de 8 caracteres", async () => {
    const res = await confirmReset(
      reqPost("https://app.invalid/api/auth/password-reset/confirm", {
        identifier: "usuario@taller.mx",
        code: "123456",
        newPassword: "corta",
      }),
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/8 caracteres/i)
    expect(mocks.consumeVerificationCode).not.toHaveBeenCalled()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/users/[id] con newPassword", () => {
  it("ADMIN puede restablecer la contraseña de un usuario de su tenant y no expone el password en audit", async () => {
    mocks.auth.mockResolvedValue(adminSession())
    const plain = "NuevaClaveEmpleado2026"

    const res = await patchUser(patchReq({ newPassword: plain }), params("u-2"))
    expect(res.status).toBe(200)

    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
    const updateData = mocks.userUpdate.mock.calls[0][0].data
    expect(typeof updateData.password).toBe("string")
    expect(updateData.password).not.toBe(plain)
    expect(await bcrypt.compare(plain, updateData.password)).toBe(true)

    expect(mocks.recordAudit).toHaveBeenCalledTimes(1)
    const auditEntry = mocks.recordAudit.mock.calls[0][1]
    expect(auditEntry.changes).toMatchObject({ contraseñaRestablecida: true })
    expect(JSON.stringify(auditEntry)).not.toContain(plain)
    expect(JSON.stringify(auditEntry)).not.toContain(updateData.password)
  })

  it("EMPLOYEE con módulo usuarios recibe 403 al intentar enviar newPassword", async () => {
    mocks.auth.mockResolvedValue(employeeWithUsersModule())

    const res = await patchUser(
      patchReq({ newPassword: "IntentoTakeover123" }),
      params("u-2"),
    )
    expect(res.status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.recordAudit).not.toHaveBeenCalled()
  })

  it("ADMIN no-superadmin no puede cambiar la contraseña de una cuenta isSuperAdmin", async () => {
    mocks.auth.mockResolvedValue(adminSession())
    mocks.userFindUnique.mockResolvedValue(existingTarget({ isSuperAdmin: true }))

    const res = await patchUser(
      patchReq({ newPassword: "IntentoSuperAdmin123" }),
      params("u-2"),
    )
    expect(res.status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})

describe("getAuthRedirect — /recuperar es ruta pública", () => {
  it("permite acceso sin sesión y con sesión PENDING a /recuperar", () => {
    expect(getAuthRedirect(null, new URL("http://localhost/recuperar"))).toBeNull()
    expect(
      getAuthRedirect(
        { user: { role: "CUSTOMER", status: "PENDING" } },
        new URL("http://localhost/recuperar"),
      ),
    ).toBeNull()
  })
})
