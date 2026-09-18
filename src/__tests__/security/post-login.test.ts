import { beforeEach, describe, expect, it, vi } from "vitest"

// /post-login decide el destino real tras el login: sin él todo usuario
// aterrizaba en "/" (la landing) porque el fallback de callbackUrl es "/".
const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))

import { GET as postLogin } from "@/app/post-login/route"

const session = (role: string, status = "APPROVED", isSuperAdmin = false) => ({
  user: { id: "u1", role, status, businessId: "biz-1", isSuperAdmin },
})

const req = (path = "/post-login") => new Request(`https://app.invalid${path}`)

beforeEach(() => vi.clearAllMocks())

describe("GET /post-login", () => {
  it("sin sesión manda a /login", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await postLogin(req())
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://app.invalid/login")
  })

  it("staff (ADMIN/EMPLOYEE) aprobado aterriza en /admin", async () => {
    for (const role of ["ADMIN", "EMPLOYEE"]) {
      mocks.auth.mockResolvedValue(session(role))
      const res = await postLogin(req())
      expect(res.headers.get("location")).toBe("https://app.invalid/admin")
    }
  })

  it("WORKSHOP aprobado aterriza en /admin/mercado (su única vista)", async () => {
    mocks.auth.mockResolvedValue(session("WORKSHOP"))
    const res = await postLogin(req())
    expect(res.headers.get("location")).toBe("https://app.invalid/admin/mercado")
  })

  it("CUSTOMER aprobado va al catálogo; PENDING va a /pending", async () => {
    mocks.auth.mockResolvedValue(session("CUSTOMER"))
    expect((await postLogin(req())).headers.get("location")).toBe(
      "https://app.invalid/catalogo",
    )
    mocks.auth.mockResolvedValue(session("ADMIN", "PENDING"))
    expect((await postLogin(req())).headers.get("location")).toBe(
      "https://app.invalid/pending",
    )
  })

  it("un ?next= explícito y seguro gana sobre el rol", async () => {
    mocks.auth.mockResolvedValue(session("CUSTOMER"))
    const res = await postLogin(req("/post-login?next=%2Fmis-reservas"))
    expect(res.headers.get("location")).toBe("https://app.invalid/mis-reservas")
  })

  it("un ?next= inseguro cae al fallback '/' sin salir del origen", async () => {
    mocks.auth.mockResolvedValue(session("ADMIN"))
    const res = await postLogin(req("/post-login?next=https%3A%2F%2Fevil.example"))
    expect(res.headers.get("location")).toBe("https://app.invalid/")
  })
})
