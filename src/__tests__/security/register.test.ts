import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/auth/register — colisiones de unicidad GLOBAL y teléfono.
 * User.email y User.phone son únicos a nivel plataforma (no por tenant):
 * un correo/tomado en OTRO negocio llega hasta el create y lanza P2002.
 * Anti-oráculo: el duplicado local y el cross-tenant responden IGUAL
 * (409 + mensaje genérico) — distinguirlos permitía sondear en qué
 * negocio está registrado un correo/teléfono.
 * El teléfono se normaliza a 10 dígitos antes de comparar/guardar para que
 * "+52 811 234 5678" y "811 234 5678" choquen en el unique.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserByPhone: vi.fn(),
  createUser: vi.fn(),
  findBusiness: vi.fn(),
  issueVerificationCode: vi.fn(),
  sendVerificationEmail: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUserByEmail,
      findFirst: mocks.findUserByPhone,
      create: mocks.createUser,
    },
    business: { findFirst: mocks.findBusiness },
  },
}))
vi.mock("@/lib/verification", () => ({
  issueVerificationCode: mocks.issueVerificationCode,
}))
vi.mock("@/lib/mailer", () => ({
  sendVerificationEmail: mocks.sendVerificationEmail,
}))

import { POST as register } from "@/app/api/auth/register/route"
import { POST as verifyStart } from "@/app/api/verify/start/route"

// IP distinta por test: el limiter en memoria comparte store entre tests.
vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const postReq = (body: unknown) =>
  new Request("https://app.invalid/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": `10.9.9.${++ipCounter}` },
    body: JSON.stringify(body),
  })

const validBody = { name: "Cliente Nuevo", password: "secreto123", phone: "+52 811 234 5678" }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.findBusiness.mockResolvedValue({ id: "biz-default" })
  mocks.findUserByEmail.mockResolvedValue(null)
  mocks.findUserByPhone.mockResolvedValue(null)
  mocks.createUser.mockResolvedValue({ id: "u-new" })
})

describe("POST /api/auth/register", () => {
  it("normaliza el teléfono antes de buscar duplicados y de guardar", async () => {
    const res = await register(postReq(validBody))
    expect(res.status).toBe(200)
    // La búsqueda resuelve por el espejo indexado phoneNormalized dentro
    // del tenant: una fila legacy con "+52 811 234 5678" también cuenta
    // como duplicado (su phoneNormalized también es "8112345678").
    expect(mocks.findUserByPhone).toHaveBeenCalledWith({
      where: { businessId: "biz-default", phoneNormalized: "8112345678" },
      select: { id: true },
    })
    // Y lo que se persiste también queda normalizado — "+52 811…" no evade el unique.
    expect(mocks.createUser).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: "8112345678", phoneNormalized: "8112345678", businessId: "biz-default" }),
    })
  })

  it("detecta duplicado aunque la fila existente tenga otro formato", async () => {
    mocks.findUserByPhone.mockResolvedValue({ id: "u-legacy" })
    const res = await register(postReq(validBody))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("No se pudo completar el registro con esos datos")
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it("un correo que existe en OTRO tenant (P2002) responde el mismo 409 genérico", async () => {
    mocks.createUser.mockRejectedValue({ code: "P2002", meta: { target: ["email"] } })
    const res = await register(postReq({ ...validBody, email: "taken@otro-tenant.mx" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("No se pudo completar el registro con esos datos")
  })

  it("un teléfono que existe en OTRO tenant (P2002) responde el mismo 409 genérico", async () => {
    mocks.createUser.mockRejectedValue({ code: "P2002", meta: { target: ["phone"] } })
    const res = await register(postReq(validBody))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("No se pudo completar el registro con esos datos")
  })

  it("duplicado local y cross-tenant son indistinguibles (anti-oráculo)", async () => {
    // Local: la búsqueda previa por teléfono lo encuentra.
    mocks.findUserByPhone.mockResolvedValue({ id: "u-existing" })
    const local = await register(postReq(validBody))
    const localBody = await local.json()

    mocks.findUserByPhone.mockResolvedValue(null)
    // Global: pasa la búsqueda local y el create choca con el único P2002.
    mocks.createUser.mockRejectedValue({ code: "P2002", meta: { target: ["phone"] } })
    const global = await register(postReq({ ...validBody, phone: "+52 55 0000 0000" }))
    const globalBody = await global.json()

    expect(local.status).toBe(global.status)
    expect(localBody).toEqual(globalBody)
  })

  it("un error de base de datos que no es P2002 sigue siendo 500", async () => {
    mocks.createUser.mockRejectedValue(new Error("connection lost"))
    const res = await register(postReq(validBody))
    expect(res.status).toBe(500)
  })
})

describe("POST /api/verify/start", () => {
  const startReq = (body: unknown) =>
    new Request("https://app.invalid/api/verify/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

  it("permite a un dueño recién registrado (PENDING) pedir reenvío de código de correo", async () => {
    mocks.auth.mockResolvedValue({
      user: { id: "owner-pending-1", role: "ADMIN", status: "PENDING", businessId: "biz-1" },
    })
    mocks.findUserByEmail.mockResolvedValue({
      id: "owner-pending-1",
      status: "PENDING",
      businessId: "biz-1",
      email: "dueno@taller.mx",
      phone: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      business: { name: "Mi Taller", isActive: true },
    })
    mocks.issueVerificationCode.mockResolvedValue({ code: "123456", expiresAt: new Date(Date.now() + 60_000) })
    mocks.sendVerificationEmail.mockResolvedValue({ sent: true })

    const res = await verifyStart(startReq({ channel: "EMAIL" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, emailSent: true })
    expect(mocks.issueVerificationCode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "owner-pending-1", identifier: "dueno@taller.mx", channel: "EMAIL" }),
    )
  })

  it("rechaza 401 sin sesión y 403 si la cuenta es REJECTED o el negocio está inactivo", async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await verifyStart(startReq({ channel: "EMAIL" }))).status).toBe(401)

    mocks.auth.mockResolvedValue({
      user: { id: "u-rejected", role: "ADMIN", status: "REJECTED", businessId: "biz-1" },
    })
    expect((await verifyStart(startReq({ channel: "EMAIL" }))).status).toBe(403)

    mocks.auth.mockResolvedValue({
      user: { id: "u-susp-biz", role: "ADMIN", status: "PENDING", businessId: "biz-susp" },
    })
    mocks.findUserByEmail.mockResolvedValue({
      id: "u-susp-biz",
      status: "PENDING",
      businessId: "biz-susp",
      email: "a@b.mx",
      phone: null,
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      business: { name: "Suspendido", isActive: false },
    })
    expect((await verifyStart(startReq({ channel: "EMAIL" }))).status).toBe(403)
    expect(mocks.issueVerificationCode).not.toHaveBeenCalled()
  })
})
