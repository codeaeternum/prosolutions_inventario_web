import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * POST /api/users/pos — alta rápida de cliente de mostrador.
 *
 * Contrato: nombre requerido (2-80) + teléfono opcional (>= 7 dígitos
 * normalizados); nace CUSTOMER/APPROVED/NORMAL sin correo ni contraseña.
 * User.phone es único GLOBAL: si ya existe en este negocio como cliente
 * aprobado se devuelve ESE (alta idempotente, existing:true); si es de otro
 * usuario del negocio 409; si el create explota con P2002 (otro tenant) 409.
 * Permisos: staff con módulo ventas o clientes — no exige "usuarios".
 */

const BIZ = "biz-test"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: mocks.userFindFirst, create: mocks.userCreate },
    auditEvent: { create: mocks.auditCreate },
  },
}))

import { POST as createPosCustomer } from "@/app/api/users/pos/route"

type SessionUser = {
  id: string
  role: string
  status: string
  businessId: string
  allowedModules?: string[]
}
const sessionWith = (user: SessionUser | null) => (user ? { user, expires: "" } : null)

const cashier = sessionWith({ id: "emp-1", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, allowedModules: ["ventas"] })
const clientesUser = sessionWith({ id: "emp-2", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, allowedModules: ["clientes"] })
const sinModulo = sessionWith({ id: "emp-3", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, allowedModules: ["caja"] })

const postReq = (payload: unknown) =>
  new Request("https://app.invalid/api/users/pos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

const createdRow = {
  id: "c9",
  name: "Ana Ríos",
  customerType: "NORMAL",
  phone: "6671234567",
  creditLimit: null,
  creditBalance: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(cashier)
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.userCreate.mockResolvedValue(createdRow)
  mocks.auditCreate.mockResolvedValue({})
})

describe("POST /api/users/pos", () => {
  it("crea cliente de mostrador: APPROVED/NORMAL, teléfono normalizado y sin contraseña", async () => {
    const res = await createPosCustomer(postReq({ name: "Ana Ríos", phone: "+52 667 123 4567" }))
    expect(res.status).toBe(201)

    const data = mocks.userCreate.mock.calls[0][0].data
    expect(data.role).toBe("CUSTOMER")
    expect(data.status).toBe("APPROVED")
    expect(data.customerType).toBe("NORMAL")
    expect(data.businessId).toBe(BIZ)
    // normalizePhone: últimos 10 dígitos, sin lada ni espacios.
    expect(data.phone).toBe("6671234567")
    expect(data.phoneNormalized).toBe("6671234567")
    expect(data.password).toBeUndefined()
    expect(data.email).toBeUndefined()

    const body = await res.json()
    expect(body.existing).toBe(false)
    expect(body.user).toMatchObject({ id: "c9", name: "Ana Ríos" })

    // Bitácora sin secretos (no hay ninguno que filtrar: no se capturan).
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
  })

  it("empleado con módulo clientes también puede dar de alta", async () => {
    mocks.auth.mockResolvedValue(clientesUser)
    const res = await createPosCustomer(postReq({ name: "Ana Ríos" }))
    expect(res.status).toBe(201)
  })

  it("sin módulo ventas ni clientes → 403 y no crea nada", async () => {
    mocks.auth.mockResolvedValue(sinModulo)
    const res = await createPosCustomer(postReq({ name: "Ana Ríos" }))
    expect(res.status).toBe(403)
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })

  it("nombre de una letra o vacío → 400", async () => {
    expect((await createPosCustomer(postReq({ name: "x" }))).status).toBe(400)
    expect((await createPosCustomer(postReq({ name: "" }))).status).toBe(400)
    expect((await createPosCustomer(postReq({}))).status).toBe(400)
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })

  it("teléfono capturado con menos de 7 dígitos → 400", async () => {
    const res = await createPosCustomer(postReq({ name: "Ana", phone: "12345" }))
    expect(res.status).toBe(400)
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })

  it("sin teléfono crea igual — el dato puede completarse después", async () => {
    const res = await createPosCustomer(postReq({ name: "Ana Ríos" }))
    expect(res.status).toBe(201)
    expect(mocks.userCreate.mock.calls[0][0].data.phone).toBeNull()
  })

  it("teléfono ya registrado como cliente aprobado del negocio: devuelve ESE (existing) sin duplicar", async () => {
    mocks.userFindFirst.mockResolvedValue({ ...createdRow, role: "CUSTOMER", status: "APPROVED" })
    const res = await createPosCustomer(postReq({ name: "Ana Ríos", phone: "6671234567" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.existing).toBe(true)
    expect(body.user.id).toBe("c9")
    // La respuesta whitelist no expone role/status del match interno.
    expect(body.user.role).toBeUndefined()
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })

  it("teléfono de otro usuario del negocio (staff/pendiente) → 409 sin crear", async () => {
    mocks.userFindFirst.mockResolvedValue({ ...createdRow, role: "EMPLOYEE", status: "APPROVED" })
    const res = await createPosCustomer(postReq({ name: "Ana Ríos", phone: "6671234567" }))
    expect(res.status).toBe(409)
    expect(mocks.userCreate).not.toHaveBeenCalled()

    mocks.userFindFirst.mockResolvedValue({ ...createdRow, role: "CUSTOMER", status: "PENDING" })
    expect((await createPosCustomer(postReq({ name: "Ana Ríos", phone: "6671234567" }))).status).toBe(409)
  })

  it("P2002 del create (teléfono en otro tenant) → 409, no 500", async () => {
    mocks.userCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }))
    const res = await createPosCustomer(postReq({ name: "Ana Ríos", phone: "6671234567" }))
    expect(res.status).toBe(409)
    const body = await res.json()
    // No filtra a qué tenant pertenece el número.
    expect(body.error).not.toMatch(/otro negocio|tenant/i)
  })

  it("error inesperado del create → 500 genérico", async () => {
    mocks.userCreate.mockRejectedValue(new Error("db caída"))
    const res = await createPosCustomer(postReq({ name: "Ana Ríos" }))
    expect(res.status).toBe(500)
  })
})
