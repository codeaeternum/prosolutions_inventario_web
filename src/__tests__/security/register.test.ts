import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/auth/register — colisiones de unicidad GLOBAL y teléfono.
 * User.email y User.phone son únicos a nivel plataforma (no por tenant):
 * un correo/tomado en OTRO negocio llega hasta el create y lanza P2002,
 * que debe responder 409 con mensaje claro — no un 500 genérico.
 * El teléfono se normaliza a 10 dígitos antes de comparar/guardar para que
 * "+52 811 234 5678" y "811 234 5678" choquen en el unique.
 */
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUserByEmail: vi.fn(),
  listUsersWithPhone: vi.fn(),
  createUser: vi.fn(),
  findBusiness: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUserByEmail,
      findMany: mocks.listUsersWithPhone,
      create: mocks.createUser,
    },
    business: { findFirst: mocks.findBusiness },
  },
}))

import { POST as register } from "@/app/api/auth/register/route"

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
  mocks.listUsersWithPhone.mockResolvedValue([])
  mocks.createUser.mockResolvedValue({ id: "u-new" })
})

describe("POST /api/auth/register", () => {
  it("normaliza el teléfono antes de buscar duplicados y de guardar", async () => {
    const res = await register(postReq(validBody))
    expect(res.status).toBe(200)
    // La búsqueda recorre los teléfonos del tenant y compara normalizado:
    // una fila legacy con "+52 811 234 5678" también cuenta como duplicado.
    expect(mocks.listUsersWithPhone).toHaveBeenCalledWith({
      where: { businessId: "biz-default", phone: { not: null } },
      select: { id: true, phone: true },
    })
    // Y lo que se persiste también queda normalizado — "+52 811…" no evade el unique.
    expect(mocks.createUser).toHaveBeenCalledWith({
      data: expect.objectContaining({ phone: "8112345678", businessId: "biz-default" }),
    })
  })

  it("detecta duplicado aunque la fila existente tenga otro formato", async () => {
    mocks.listUsersWithPhone.mockResolvedValue([{ id: "u-legacy", phone: "+52 1 (811) 234-5678" }])
    const res = await register(postReq(validBody))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("Este teléfono ya está registrado")
    expect(mocks.createUser).not.toHaveBeenCalled()
  })

  it("un correo que existe en OTRO tenant (P2002) responde 409, no 500", async () => {
    mocks.createUser.mockRejectedValue({ code: "P2002", meta: { target: ["email"] } })
    const res = await register(postReq({ ...validBody, email: "taken@otro-tenant.mx" }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("Este correo ya está registrado")
  })

  it("un teléfono que existe en OTRO tenant (P2002) responde 409 con mensaje de teléfono", async () => {
    mocks.createUser.mockRejectedValue({ code: "P2002", meta: { target: ["phone"] } })
    const res = await register(postReq(validBody))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("Este teléfono ya está registrado")
  })

  it("un error de base de datos que no es P2002 sigue siendo 500", async () => {
    mocks.createUser.mockRejectedValue(new Error("connection lost"))
    const res = await register(postReq(validBody))
    expect(res.status).toBe(500)
  })

  it("duplicado dentro del mismo tenant sigue siendo 400 sin llegar al create", async () => {
    mocks.listUsersWithPhone.mockResolvedValue([{ id: "u-existing", phone: "8112345678" }])
    const res = await register(postReq(validBody))
    expect(res.status).toBe(400)
    expect(mocks.createUser).not.toHaveBeenCalled()
  })
})
