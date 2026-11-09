import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Restricciones de staff por módulo y sucursal.
 *
 * requireModule = requireAdminOrEmployee + User.allowedModules
 * (lista vacía = sin restricción; ADMIN siempre pasa).
 * assertBranchAllowed / assertModuleAllowed son la misma regla para
 * handlers que ya autenticaron (rutas compartidas con clientes).
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    branch: { findFirst: vi.fn() },
  },
}))

import { requireModule, assertModuleAllowed, assertBranchAllowed, assertOperationBranch } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import type { ApiSession } from "@/lib/api-auth"

const user = (role: string, allowedModules?: string[], allowedBranchIds?: string[]) => ({
  user: {
    id: `${role.toLowerCase()}-1`,
    name: role,
    role,
    status: "APPROVED",
    businessId: "biz-test",
    customerType: "NORMAL",
    allowedModules,
    allowedBranchIds,
  },
})

const sessionOf = (role: string, allowedModules?: string[], allowedBranchIds?: string[]) =>
  user(role, allowedModules, allowedBranchIds) as unknown as ApiSession

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
})

describe("requireModule", () => {
  it("rechaza al empleado sin el módulo asignado", async () => {
    mocks.auth.mockResolvedValue(user("EMPLOYEE", ["caja"]))
    const result = await requireModule("ventas")
    expect(result.error).toBeTruthy()
    expect(result.error!.status).toBe(403)
    expect(await result.error!.json()).toEqual({ error: "No tienes acceso a este módulo." })
  })

  it("deja pasar al empleado con el módulo asignado", async () => {
    mocks.auth.mockResolvedValue(user("EMPLOYEE", ["ventas", "caja"]))
    const result = await requireModule("ventas")
    expect(result.error).toBeUndefined()
    expect(result.session?.user.id).toBe("employee-1")
  })

  it("ADMIN siempre pasa, con o sin lista", async () => {
    for (const modules of [undefined, [], ["caja"]]) {
      mocks.auth.mockResolvedValue(user("ADMIN", modules))
      const result = await requireModule("inventario")
      expect(result.error).toBeUndefined()
    }
  })

  it("lista de módulos vacía = sin restricción (excepto EMPLOYEE_RESTRICTED como sucursales)", async () => {
    mocks.auth.mockResolvedValue(user("EMPLOYEE", []))
    expect((await requireModule("taller")).error).toBeUndefined()
    expect((await requireModule("sucursales")).error?.status).toBe(403)
    mocks.auth.mockResolvedValue(user("EMPLOYEE"))
    expect((await requireModule("taller")).error).toBeUndefined()
    expect((await requireModule("sucursales")).error?.status).toBe(403)
  })

  it("sigue exigiendo rol de staff: cliente recibe 403 aunque liste el módulo", async () => {
    mocks.auth.mockResolvedValue(user("CUSTOMER", ["ventas"]))
    const result = await requireModule("ventas")
    expect(result.error?.status).toBe(403)
  })

  it("sin sesión devuelve 401", async () => {
    mocks.auth.mockResolvedValue(null)
    const result = await requireModule("ventas")
    expect(result.error?.status).toBe(401)
  })
})

describe("assertModuleAllowed", () => {
  it("devuelve null cuando el staff tiene el módulo y 403 si no", async () => {
    expect(assertModuleAllowed(sessionOf("EMPLOYEE", ["taller"]), "taller")).toBeNull()
    const denied = assertModuleAllowed(sessionOf("EMPLOYEE", ["taller"]), "caja")
    expect(denied?.status).toBe(403)
    expect(await denied!.json()).toEqual({ error: "No tienes acceso a este módulo." })
  })
})

describe("assertBranchAllowed", () => {
  it("devuelve null sin restricción, con sucursal permitida, siendo ADMIN o sin sucursal", () => {
    // Lista vacía = sin restricción.
    expect(assertBranchAllowed(sessionOf("EMPLOYEE", undefined, []), "b-2")).toBeNull()
    // Sucursal dentro de la lista permitida.
    expect(assertBranchAllowed(sessionOf("EMPLOYEE", undefined, ["b-1", "b-2"]), "b-1")).toBeNull()
    // ADMIN no se limita por sucursal.
    expect(assertBranchAllowed(sessionOf("ADMIN", undefined, ["b-1"]), "b-9")).toBeNull()
    // Sin sucursal objetivo no hay nada que validar.
    expect(assertBranchAllowed(sessionOf("EMPLOYEE", undefined, ["b-1"]), null)).toBeNull()
    expect(assertBranchAllowed(sessionOf("EMPLOYEE", undefined, ["b-1"]), undefined)).toBeNull()
  })

  it("niega una sucursal fuera de la lista con 403 y su mensaje", async () => {
    const denied = assertBranchAllowed(sessionOf("EMPLOYEE", undefined, ["b-1"]), "b-9")
    expect(denied).toBeTruthy()
    expect(denied!.status).toBe(403)
    expect(await denied!.json()).toEqual({ error: "No tienes acceso a esta sucursal." })
  })
})

// La sucursal pedida debe existir ACTIVA en el negocio de la sesión para
// cualquier rol: un branchId de otro tenant (preferencia reficio-branch
// vieja del modo soporte o request forjado) se rechaza en el guard, no
// más abajo en el dominio.
describe("assertOperationBranch", () => {
  const branchFindFirst = vi.mocked(prisma.branch.findFirst)

  it("rechaza 400 un branchId ajeno/inactivo aunque el actor sea ADMIN", async () => {
    branchFindFirst.mockResolvedValueOnce(null)
    const denied = await assertOperationBranch(sessionOf("ADMIN"), "rama-de-otro-negocio")
    expect(denied?.status).toBe(400)
    expect(await denied!.json()).toEqual({ error: "La sucursal indicada no está disponible." })
    expect(branchFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rama-de-otro-negocio", businessId: "biz-test", isActive: true } }),
    )
  })

  it("rechaza 400 un branchId ajeno también para empleado sin restricción", async () => {
    branchFindFirst.mockResolvedValueOnce(null)
    const denied = await assertOperationBranch(sessionOf("EMPLOYEE", undefined, []), "rama-ajena")
    expect(denied?.status).toBe(400)
  })

  it("ADMIN con sucursal propia activa pasa sin más validación", async () => {
    branchFindFirst.mockResolvedValueOnce({ id: "b-1" } as never)
    expect(await assertOperationBranch(sessionOf("ADMIN"), "b-1")).toBeNull()
  })

  it("empleado restringido: sucursal propia y asignada pasa; ajena a su lista da 403", async () => {
    branchFindFirst.mockResolvedValueOnce({ id: "b-1" } as never)
    expect(await assertOperationBranch(sessionOf("EMPLOYEE", undefined, ["b-1", "b-2"]), "b-1")).toBeNull()

    branchFindFirst.mockResolvedValueOnce({ id: "b-3" } as never)
    const denied = await assertOperationBranch(sessionOf("EMPLOYEE", undefined, ["b-1"]), "b-3")
    expect(denied?.status).toBe(403)
    expect(await denied!.json()).toEqual({ error: "No tienes acceso a esta sucursal." })
  })

  it("sin branchId pedido resuelve la sucursal base del empleado restringido", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ homeBranchId: "b-2" } as never)
    expect(await assertOperationBranch(sessionOf("EMPLOYEE", undefined, ["b-2"]), null)).toBeNull()
    expect(branchFindFirst).not.toHaveBeenCalled()
  })
})
