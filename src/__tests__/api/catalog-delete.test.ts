import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * DELETE /api/brands|models|categories/[id] — borrado del panel Clasificación.
 *
 * Contrato: requireModule("inventario"); el registro debe pertenecer al tenant
 * (uno ajeno = 404); con dependientes vivos responde 409 explicando el motivo
 * (marca con modelos, modelo con productos vinculados, categoría con
 * productos — todos onDelete: Cascade en el schema, un delete directo
 * arrastraría datos del catálogo). Sin dependientes borra y registra
 * *_DELETE en bitácora.
 */

const BIZ = "biz-test"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  brandFindFirst: vi.fn(),
  brandDelete: vi.fn(),
  modelFindFirst: vi.fn(),
  modelDelete: vi.fn(),
  categoryFindFirst: vi.fn(),
  categoryDelete: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brand: { findFirst: mocks.brandFindFirst, delete: mocks.brandDelete },
    model: { findFirst: mocks.modelFindFirst, delete: mocks.modelDelete },
    category: { findFirst: mocks.categoryFindFirst, delete: mocks.categoryDelete },
    auditEvent: { create: mocks.auditCreate },
  },
}))

import { DELETE as deleteBrand } from "@/app/api/brands/[id]/route"
import { DELETE as deleteModel } from "@/app/api/models/[id]/route"
import { DELETE as deleteCategory } from "@/app/api/categories/[id]/route"

type SessionUser = {
  id: string
  role: string
  status: string
  businessId: string
  allowedModules?: string[]
}
const sessionWith = (user: SessionUser | null) => (user ? { user, expires: "" } : null)

const admin = sessionWith({ id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ })
const employeeSinModulo = sessionWith({
  id: "emp-1", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, allowedModules: ["ventas"],
})

const deleteReq = (url: string) => new Request(url, { method: "DELETE" })
const paramsOf = (id: string) => ({ params: Promise.resolve({ id }) })

type ResourceCase = {
  nombre: string
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
  url: string
  findFirst: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  /** Registro vacío (sin dependientes) tal como lo devuelve findFirst+_count. */
  empty: Record<string, unknown>
  /** Registro con dependientes. */
  busy: Record<string, unknown>
  /** Fragmento del mensaje 409. */
  busyMsg: string
  notFoundMsg: string
  auditAction: string
}

const resources: ResourceCase[] = [
  {
    nombre: "marca",
    handler: deleteBrand,
    url: "https://app.invalid/api/brands/brand-1",
    findFirst: mocks.brandFindFirst,
    del: mocks.brandDelete,
    empty: { id: "brand-1", name: "Samsung", _count: { models: 0 } },
    busy: { id: "brand-1", name: "Samsung", _count: { models: 3 } },
    busyMsg: "tiene 3 modelo(s)",
    notFoundMsg: "Marca no encontrada",
    auditAction: "BRAND_DELETE",
  },
  {
    nombre: "modelo",
    handler: deleteModel,
    url: "https://app.invalid/api/models/model-1",
    findFirst: mocks.modelFindFirst,
    del: mocks.modelDelete,
    empty: { id: "model-1", name: "Galaxy S24", _count: { products: 0 } },
    busy: { id: "model-1", name: "Galaxy S24", _count: { products: 5 } },
    busyMsg: "5 producto(s) lo tienen asignado",
    notFoundMsg: "Modelo no encontrado",
    auditAction: "MODEL_DELETE",
  },
  {
    nombre: "categoría",
    handler: deleteCategory,
    url: "https://app.invalid/api/categories/cat-1",
    findFirst: mocks.categoryFindFirst,
    del: mocks.categoryDelete,
    empty: { id: "cat-1", name: "Pantallas", _count: { products: 0 } },
    busy: { id: "cat-1", name: "Pantallas", _count: { products: 8 } },
    busyMsg: "tiene 8 producto(s)",
    notFoundMsg: "Categoría no encontrada",
    auditAction: "CATEGORY_DELETE",
  },
]

const idOf = (url: string) => url.split("/").pop()!

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin)
  mocks.auditCreate.mockResolvedValue({})
})

for (const r of resources) {
  describe(`DELETE — ${r.nombre}`, () => {
    it("elimina el registro vacío y registra en bitácora", async () => {
      r.findFirst.mockResolvedValueOnce(r.empty)
      r.del.mockResolvedValueOnce(r.empty)

      const res = await r.handler(deleteReq(r.url), paramsOf(idOf(r.url)))

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ deleted: true })
      // El lookup va acotado al tenant de la sesión.
      expect(r.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: idOf(r.url), businessId: BIZ }) }),
      )
      expect(r.del).toHaveBeenCalledWith({ where: { id: idOf(r.url) } })
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: r.auditAction, businessId: BIZ }),
        }),
      )
    })

    it("con dependientes responde 409 con el motivo y no borra nada", async () => {
      r.findFirst.mockResolvedValueOnce(r.busy)

      const res = await r.handler(deleteReq(r.url), paramsOf(idOf(r.url)))

      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain(r.busyMsg)
      expect(r.del).not.toHaveBeenCalled()
      expect(mocks.auditCreate).not.toHaveBeenCalled()
    })

    it("un registro de otro tenant responde 404, nunca lo borra", async () => {
      r.findFirst.mockResolvedValueOnce(null)

      const res = await r.handler(deleteReq(r.url), paramsOf("registro-de-otro-negocio"))

      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe(r.notFoundMsg)
      expect(r.del).not.toHaveBeenCalled()
    })

    it("empleado sin el módulo inventario recibe 403", async () => {
      mocks.auth.mockResolvedValueOnce(employeeSinModulo)

      const res = await r.handler(deleteReq(r.url), paramsOf(idOf(r.url)))

      expect(res.status).toBe(403)
      expect(r.findFirst).not.toHaveBeenCalled()
    })

    it("sin sesión recibe 401", async () => {
      mocks.auth.mockResolvedValueOnce(null)

      const res = await r.handler(deleteReq(r.url), paramsOf(idOf(r.url)))

      expect(res.status).toBe(401)
      expect(r.findFirst).not.toHaveBeenCalled()
    })
  })
}
