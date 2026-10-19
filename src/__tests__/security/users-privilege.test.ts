import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Escalación de privilegios vía gestión de usuarios.
 *
 * Un EMPLOYEE con el módulo "usuarios" pasa requireModule pero NO debe poder:
 * editar su propia cuenta (rol/módulos/PIN/estatus), cambiar el rol de
 * nadie, mover campos administrativos (status, customerType, allowedModules,
 * allowedBranchIds, quickPin), eliminar usuarios ni crear staff. Todas esas
 * facultades quedan reservadas al ADMIN.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  recordAudit: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
  userDelete: vi.fn(),
  branchCount: vi.fn(),
  branchFindUnique: vi.fn(),
  businessFindFirst: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      findFirst: mocks.userFindFirst,
      create: mocks.userCreate,
      update: mocks.userUpdate,
      delete: mocks.userDelete,
    },
    branch: { count: mocks.branchCount, findUnique: mocks.branchFindUnique },
    business: { findFirst: mocks.businessFindFirst },
    auditEvent: { create: mocks.auditCreate },
  },
}))
// recordAudit apagado (la alerta Telegram es fire-and-forget); diffChanges y
// listText quedan reales porque el PATCH los usa para armar el evento.
vi.mock("@/lib/audit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/audit")>()
  return { ...actual, recordAudit: mocks.recordAudit }
})

import { POST as createUser } from "@/app/api/users/route"
import { PATCH as patchUser, DELETE as deleteUser } from "@/app/api/users/[id]/route"

const BIZ = "biz-test"
const admin = () => ({ user: { id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ, customerType: "NORMAL" } })
const manager = () => ({ user: { id: "emp-1", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, customerType: "NORMAL", allowedModules: ["usuarios"] } })
const noModuleEmployee = () => ({ user: { id: "emp-9", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, customerType: "NORMAL", allowedModules: ["caja"] } })

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const patchReq = (body: unknown) =>
  new Request("https://app.invalid/api/users/x", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const postReq = (body: unknown) =>
  new Request("https://app.invalid/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const delReq = () => new Request("https://app.invalid/api/users/x", { method: "DELETE" })

// La fila que devuelve el findUnique del PATCH (select administrativo).
const existing = (over: Record<string, unknown> = {}) => ({
  id: "u-2", name: "Empleado Dos", status: "APPROVED", customerType: "NORMAL",
  role: "EMPLOYEE", homeBranchId: null, jobTitle: null, publicSlug: null,
  allowedModules: ["ventas"], allowedBranchIds: [], ...over,
})

const updatedRow = (over: Record<string, unknown> = {}) => ({
  id: "u-2", name: "Empleado Dos", email: "dos@test.mx", status: "APPROVED",
  customerType: "NORMAL", role: "EMPLOYEE", homeBranchId: null, jobTitle: null,
  publicSlug: null, allowedModules: ["ventas"], allowedBranchIds: [], ...over,
})

const newUserPayload = (over: Record<string, unknown> = {}) => ({
  name: "Nuevo", email: "nuevo@test.mx", password: "secreto1", role: "CUSTOMER", ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.userFindUnique.mockResolvedValue(existing())
  mocks.userFindFirst.mockResolvedValue(null)
  mocks.businessFindFirst.mockResolvedValue(null)
  mocks.branchCount.mockResolvedValue(0)
  mocks.branchFindUnique.mockResolvedValue({ id: "b1", isActive: true })
  mocks.userUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...updatedRow(), ...data }))
  mocks.userCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new-1", createdAt: new Date(), ...data }))
  mocks.userDelete.mockResolvedValue({})
  mocks.auditCreate.mockResolvedValue({})
})

describe("PATCH /api/users/[id] — empleado con módulo usuarios", () => {
  it("no puede auto-otorgarse módulos ni cambiar nada de su propia cuenta", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(existing({ id: "emp-1", role: "EMPLOYEE" }))
    // El intento original del bug: darse los 13 módulos a sí mismo.
    const res = await patchUser(patchReq({
      allowedModules: ["taller", "ventas", "caja", "reservas", "clientes", "credito", "mercado", "inventario", "sucursales", "usuarios", "reportes", "notificaciones", "configuracion"],
      quickPin: "4321",
      status: "APPROVED",
    }), params("emp-1"))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/propia cuenta/)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("rechaza hasta campos operativos sobre sí mismo (su perfil va por /api/perfil)", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(existing({ id: "emp-1", role: "EMPLOYEE" }))
    for (const body of [{ jobTitle: "Dueño" }, { homeBranchId: "b1" }]) {
      const res = await patchUser(patchReq(body), params("emp-1"))
      expect(res.status).toBe(403)
    }
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("no puede cambiar el rol de otro usuario (CUSTOMER→EMPLOYEE incluido)", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(existing({ role: "CUSTOMER" }))
    for (const role of ["EMPLOYEE", "WORKSHOP", "ADMIN", "CUSTOMER"]) {
      const res = await patchUser(patchReq({ role }), params("u-2"))
      expect(res.status).toBe(403)
    }
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("no puede mover status, customerType, PIN, módulos ni sucursales ajenos", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(existing({ role: "CUSTOMER" }))
    const forbidden = [
      { status: "REJECTED" },
      { status: "APPROVED" },           // aprobar clientes pendientes también es admin-only
      { customerType: "TECHNICIAN" },   // desbloquearía precios de mayoreo
      { quickPin: "4321" },             // takeover vía /api/auth/switch
      { quickPin: "CLEAR" },
      { allowedModules: [] },           // quitar restricciones = todos los módulos
      { allowedModules: ["usuarios"] },
      { allowedBranchIds: ["b1"] },
    ]
    for (const body of forbidden) {
      const res = await patchUser(patchReq(body), params("u-2"))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatch(/administrador/)
    }
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("sí puede ajustar campos operativos (puesto, sucursal base) de un no-admin", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(existing({ role: "EMPLOYEE" }))
    const res = await patchUser(patchReq({ jobTitle: "Recepción", homeBranchId: "b1" }), params("u-2"))
    expect(res.status).toBe(200)
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobTitle: "Recepción", homeBranchId: "b1" }) })
    )
  })

  it("sigue sin poder tocar a un ADMIN aunque mande campos benignos", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(existing({ role: "ADMIN" }))
    const res = await patchUser(patchReq({ jobTitle: "X" }), params("u-2"))
    expect(res.status).toBe(403)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("empleado sin el módulo usuarios ni siquiera llega al handler", async () => {
    mocks.auth.mockResolvedValue(noModuleEmployee())
    const res = await patchUser(patchReq({ jobTitle: "X" }), params("u-2"))
    expect(res.status).toBe(403)
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/users/[id] — admin conserva control total", () => {
  it("cambia rol, estatus, tipo de cliente, módulos, sucursales y PIN", async () => {
    mocks.auth.mockResolvedValue(admin())
    mocks.branchCount.mockResolvedValue(1)
    const res = await patchUser(patchReq({
      role: "EMPLOYEE",
      status: "REJECTED",
      customerType: "TECHNICIAN",
      allowedModules: ["ventas", "caja"],
      allowedBranchIds: ["b1"],
      quickPin: "1234",
    }), params("u-2"))
    expect(res.status).toBe(200)
    const data = mocks.userUpdate.mock.calls[0][0].data
    expect(data).toMatchObject({
      role: "EMPLOYEE",
      status: "REJECTED",
      customerType: "TECHNICIAN",
      allowedModules: ["ventas", "caja"],
      allowedBranchIds: ["b1"],
    })
    expect(typeof data.quickPin).toBe("string")
    expect(data.quickPin).not.toBe("1234") // guardado hasheado
  })

  it("no puede degradarse a sí mismo (regla previa intacta)", async () => {
    mocks.auth.mockResolvedValue(admin())
    mocks.userFindUnique.mockResolvedValue(existing({ id: "admin-1", role: "ADMIN" }))
    const res = await patchUser(patchReq({ role: "EMPLOYEE" }), params("admin-1"))
    expect(res.status).toBe(400)
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it("estatus o tipo de cliente inválidos son 400, no un 500 de Prisma", async () => {
    mocks.auth.mockResolvedValue(admin())
    for (const body of [{ status: "FUBAR" }, { customerType: "VIP" }]) {
      const res = await patchUser(patchReq(body), params("u-2"))
      expect(res.status).toBe(400)
    }
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })
})

describe("POST /api/users — empleado con módulo usuarios", () => {
  it("no puede crear EMPLOYEE, WORKSHOP ni ADMIN", async () => {
    mocks.auth.mockResolvedValue(manager())
    for (const role of ["EMPLOYEE", "WORKSHOP", "ADMIN"]) {
      const res = await createUser(postReq(newUserPayload({ role })))
      expect(res.status).toBe(403)
    }
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })

  it("puede crear CUSTOMER pero módulos, PIN, tipo y estatus se fuerzan a defaults", async () => {
    mocks.auth.mockResolvedValue(manager())
    mocks.userFindUnique.mockResolvedValue(null) // correo libre
    mocks.branchCount.mockResolvedValue(1)
    const res = await createUser(postReq(newUserPayload({
      role: "CUSTOMER",
      customerType: "TECHNICIAN",            // intento de mayoreo: ignorado
      allowedModules: ["usuarios", "caja"],  // intento de módulos: ignorado
      allowedBranchIds: ["b1"],              // ignorado
      quickPin: "4321",                      // ignorado
      status: "REJECTED",                    // nunca se leyó del body
      homeBranchId: "b1",                    // campo operativo: sí pasa
    })))
    expect(res.status).toBe(200)
    const data = mocks.userCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      role: "CUSTOMER",
      customerType: "NORMAL",
      allowedModules: [],
      allowedBranchIds: [],
      quickPin: null,
      status: "APPROVED",
      homeBranchId: "b1",
      businessId: BIZ,
    })
  })

  it("admin sí crea EMPLOYEE con módulos, sucursales y PIN elegidos", async () => {
    mocks.auth.mockResolvedValue(admin())
    mocks.userFindUnique.mockResolvedValue(null)
    mocks.branchCount.mockResolvedValue(1)
    const res = await createUser(postReq(newUserPayload({
      role: "EMPLOYEE",
      allowedModules: ["ventas", "caja"],
      allowedBranchIds: ["b1"],
      quickPin: "1234",
      customerType: "TECHNICIAN",
    })))
    expect(res.status).toBe(200)
    const data = mocks.userCreate.mock.calls[0][0].data
    expect(data.allowedModules).toEqual(["ventas", "caja"])
    expect(data.allowedBranchIds).toEqual(["b1"])
    expect(typeof data.quickPin).toBe("string")
    expect(data.customerType).toBe("TECHNICIAN")
    expect(data.status).toBe("APPROVED")
  })

  it("rol inválido del body es 400 (admin)", async () => {
    mocks.auth.mockResolvedValue(admin())
    const res = await createUser(postReq(newUserPayload({ role: "SUPERUSER" })))
    expect(res.status).toBe(400)
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/users/[id]", () => {
  it("empleado no puede eliminar a nadie", async () => {
    mocks.auth.mockResolvedValue(manager())
    const res = await deleteUser(delReq(), params("u-2"))
    expect(res.status).toBe(403)
    expect(mocks.userDelete).not.toHaveBeenCalled()
    expect(mocks.userFindUnique).not.toHaveBeenCalled() // el guard corre antes de la BD
  })

  it("admin sí elimina dentro de su negocio", async () => {
    mocks.auth.mockResolvedValue(admin())
    mocks.userFindUnique.mockResolvedValue({ role: "CUSTOMER", name: "Cliente" })
    const res = await deleteUser(delReq(), params("u-2"))
    expect(res.status).toBe(200)
    expect(mocks.userDelete).toHaveBeenCalledWith({ where: { id: "u-2", businessId: BIZ } })
  })
})
