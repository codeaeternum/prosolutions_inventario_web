import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * PATCH /api/perfil — edición self-service de contacto (name/email/phone).
 *
 * Contrato de seguridad que se ejercita aquí:
 * - Sin sesión → 401; sesión no aprobada → 403; nunca se opera sobre un id
 *   que venga en el body (siempre session.user.id).
 * - Campos privilegiados (role, status, customerType, businessId,
 *   creditLimit, isSuperAdmin…) se ignoran: el schema los descarta antes de
 *   armar el update.
 * - Cambiar email/phone invalida la verificación previa y dispara un código
 *   nuevo (correo vía Resend mockeado; teléfono vía deep-link de Telegram);
 *   sin cambios reales no se toca verifiedAt ni se emite nada.
 * - Unicidad global de email/phone → 409.
 *
 * Se mockean @/lib/auth (sesión), @/lib/prisma (user + verificationCode) y
 * los canales de entrega (mailer/telegram); issueVerificationCode corre real
 * sobre el prisma falso.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userUpdate: vi.fn(),
  codeUpdateMany: vi.fn(),
  codeCreate: vi.fn(),
  sendVerificationEmail: vi.fn(),
  buildTelegramVerifyUrl: vi.fn(),
  sendTelegramMessage: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findMany: mocks.userFindMany,
      update: mocks.userUpdate,
    },
    verificationCode: {
      updateMany: mocks.codeUpdateMany,
      create: mocks.codeCreate,
    },
  },
}))
vi.mock("@/lib/mailer", () => ({ sendVerificationEmail: mocks.sendVerificationEmail }))
vi.mock("@/lib/telegram", () => ({
  buildTelegramVerifyUrl: mocks.buildTelegramVerifyUrl,
  sendTelegramMessage: mocks.sendTelegramMessage,
}))

import { PATCH } from "@/app/api/perfil/route"

const session = (id: string, status = "APPROVED") => ({
  user: { id, role: "CUSTOMER", status, businessId: "biz-1" },
})

const dbUser = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  businessId: "biz-1",
  name: "Ana Prueba",
  email: "ana@example.com",
  phone: "8112345678",
  telegramId: null,
  emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  phoneVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  business: { name: "Refacciones Prueba" },
  ...over,
})

const patchReq = (body: unknown) =>
  new Request("https://app.invalid/api/perfil", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFindMany.mockResolvedValue([])
  mocks.userUpdate.mockImplementation((args: { where: { id: string }; data: Record<string, unknown> }) =>
    Promise.resolve({ id: args.where.id, ...args.data })
  )
  mocks.codeUpdateMany.mockResolvedValue({ count: 0 })
  mocks.codeCreate.mockResolvedValue({ id: "vc-1" })
  mocks.sendVerificationEmail.mockResolvedValue({ sent: true })
  mocks.buildTelegramVerifyUrl.mockResolvedValue("https://t.me/reficiobot?start=verify_123456")
  mocks.sendTelegramMessage.mockResolvedValue(true)
})

describe("PATCH /api/perfil", () => {
  it("rechaza sin sesión antes de tocar la base (401)", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await PATCH(patchReq({ name: "X" }))
    expect(res.status).toBe(401)
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("rechaza sesión no aprobada (403) sin escribir", async () => {
    mocks.auth.mockResolvedValue(session("u-pend", "PENDING"))
    expect((await PATCH(patchReq({ name: "X" }))).status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("cambio de correo: normaliza, invalida emailVerifiedAt y dispara código al nuevo correo", async () => {
    mocks.auth.mockResolvedValue(session("u-mail"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-mail"))

    const res = await PATCH(patchReq({ email: "NUEVA@correo.com" }))
    expect(res.status).toBe(200)

    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-mail" },
        data: { email: "nueva@correo.com", emailVerifiedAt: null },
      })
    )
    // Fire-and-forget: el código sale por Resend sin bloquear la respuesta.
    await vi.waitFor(() =>
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith(
        "nueva@correo.com",
        expect.any(String),
        "Refacciones Prueba"
      )
    )
    expect(mocks.codeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identifier: "nueva@correo.com",
          channel: "EMAIL",
          userId: "u-mail",
        }),
      })
    )
    const json = await res.json()
    expect(json.verification).toEqual({ emailDispatched: true, phoneIssued: false })
    // Jamás se devuelven credenciales.
    expect(json.user).not.toHaveProperty("password")
    expect(json.user).not.toHaveProperty("quickPin")
  })

  it("cambio de teléfono: normaliza, invalida phoneVerifiedAt y emite código vía Telegram", async () => {
    mocks.auth.mockResolvedValue(session("u-tel"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-tel", { telegramId: "tg-99" }))

    const res = await PATCH(patchReq({ phone: "+52 55 9999 8888" }))
    expect(res.status).toBe(200)

    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { phone: "5599998888", phoneVerifiedAt: null },
      })
    )
    await vi.waitFor(() =>
      expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(
        "tg-99",
        expect.stringContaining("https://t.me/")
      )
    )
    expect(mocks.codeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identifier: "5599998888",
          channel: "TELEGRAM",
          userId: "u-tel",
        }),
      })
    )
  })

  it("correo ya registrado en otra cuenta → 409 sin escribir", async () => {
    mocks.auth.mockResolvedValue(session("u-dupe"))
    // Primer findUnique trae al usuario actual; el segundo (por email) al dueño del correo.
    mocks.userFindUnique.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve("email" in args.where ? { id: "u-otro" } : dbUser("u-dupe"))
    )

    const res = await PATCH(patchReq({ email: "ocupado@correo.com" }))
    expect(res.status).toBe(409)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.codeCreate).not.toHaveBeenCalled()
  })

  it("teléfono ya registrado en otra cuenta → 409 sin escribir", async () => {
    mocks.auth.mockResolvedValue(session("u-dupe2"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-dupe2"))
    mocks.userFindMany.mockResolvedValue([
      { id: "u-otro", phone: "+52 55 0000 1111" }, // legacy con formato crudo
    ])

    const res = await PATCH(patchReq({ phone: "55 0000 1111" }))
    expect(res.status).toBe(409)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("ignora campos privilegiados y opera siempre sobre session.user.id", async () => {
    mocks.auth.mockResolvedValue(session("u-priv"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-priv"))

    const res = await PATCH(
      patchReq({
        id: "u-victima",
        userId: "u-victima",
        name: "Nombre Nuevo",
        role: "ADMIN",
        status: "APPROVED",
        customerType: "STORE",
        businessId: "otra-empresa",
        isSuperAdmin: true,
        creditLimit: 99999,
        emailVerifiedAt: "2030-01-01T00:00:00Z",
      })
    )
    expect(res.status).toBe(200)

    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
    const call = mocks.userUpdate.mock.calls[0][0] as {
      where: { id: string }
      data: Record<string, unknown>
    }
    expect(call.where).toEqual({ id: "u-priv" }) // jamás el id del body
    expect(call.data).toEqual({ name: "Nombre Nuevo" }) // solo el campo permitido
  })

  it("sin cambios reales: ok sin tocar verifiedAt ni emitir códigos", async () => {
    mocks.auth.mockResolvedValue(session("u-same"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-same"))

    // Mismo nombre/correo; el teléfono con formato se normaliza al guardado.
    const res = await PATCH(
      patchReq({ name: "Ana Prueba", email: "ana@example.com", phone: "+52 811 234 5678" })
    )
    expect(res.status).toBe(200)
    expect((await res.json()).unchanged).toBe(true)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
    expect(mocks.codeCreate).not.toHaveBeenCalled()
    expect(mocks.sendVerificationEmail).not.toHaveBeenCalled()
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled()
  })

  it("valida formato de correo y teléfono sin dígitos (400, sin escrituras)", async () => {
    mocks.auth.mockResolvedValue(session("u-bad"))
    expect((await PATCH(patchReq({ email: "no-es-correo" }))).status).toBe(400)

    mocks.userFindUnique.mockResolvedValue(dbUser("u-bad"))
    expect((await PATCH(patchReq({ phone: "abc---" }))).status).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("no permite dejar la cuenta sin correo ni teléfono (400)", async () => {
    mocks.auth.mockResolvedValue(session("u-none"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-none"))

    const res = await PATCH(patchReq({ email: "", phone: "" }))
    expect(res.status).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("limita la frecuencia de cambios por usuario (429 al sexto en 15 min)", async () => {
    mocks.auth.mockResolvedValue(session("u-ratelimit"))
    mocks.userFindUnique.mockResolvedValue(dbUser("u-ratelimit"))

    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      statuses.push((await PATCH(patchReq({ name: `Nombre ${i}` }))).status)
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
    expect(statuses[5]).toBe(429)
  })
})
