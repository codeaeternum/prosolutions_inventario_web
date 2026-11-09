import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * PATCH /api/brands|models|categories — rename inline del panel Clasificación.
 *
 * Contrato: body { id, name }; requireModule("inventario"); el registro debe
 * pertenecer al tenant (uno ajeno = 404); nombre vacío = 400; duplicado
 * case-insensitive en el tenant (para modelos, dentro de su marca) = 400 con
 * el mismo mensaje que el POST de alta. El rename regenera el slug y deja
 * evento *_UPDATE en bitácora.
 */

const BIZ = "biz-test"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  brandFindFirst: vi.fn(),
  brandUpdate: vi.fn(),
  modelFindFirst: vi.fn(),
  modelUpdate: vi.fn(),
  categoryFindFirst: vi.fn(),
  categoryUpdate: vi.fn(),
  auditCreate: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brand: { findFirst: mocks.brandFindFirst, update: mocks.brandUpdate },
    model: { findFirst: mocks.modelFindFirst, update: mocks.modelUpdate },
    category: { findFirst: mocks.categoryFindFirst, update: mocks.categoryUpdate },
    auditEvent: { create: mocks.auditCreate },
  },
}))

import { PATCH as patchBrand } from "@/app/api/brands/route"
import { PATCH as patchModel } from "@/app/api/models/route"
import { PATCH as patchCategory } from "@/app/api/categories/route"

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

const patchReq = (url: string, payload: unknown) =>
  new Request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

type ResourceCase = {
  nombre: string
  handler: (req: Request) => Promise<Response>
  url: string
  findFirst: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  existing: Record<string, unknown>
  updated: Record<string, unknown>
  dupMsg: string
  notFoundMsg: string
  auditAction: string
}

const resources: ResourceCase[] = [
  {
    nombre: "marca",
    handler: patchBrand,
    url: "https://app.invalid/api/brands",
    findFirst: mocks.brandFindFirst,
    update: mocks.brandUpdate,
    existing: { id: "brand-1", name: "Samsung" },
    updated: { id: "brand-1", name: "Samsung Galaxy", slug: "samsung-galaxy" },
    dupMsg: "Esta marca ya existe",
    notFoundMsg: "Marca no encontrada",
    auditAction: "BRAND_UPDATE",
  },
  {
    nombre: "modelo",
    handler: patchModel,
    url: "https://app.invalid/api/models",
    findFirst: mocks.modelFindFirst,
    update: mocks.modelUpdate,
    existing: { id: "model-1", name: "S24", slug: "s24", brandId: "brand-1", brand: { name: "Samsung" } },
    updated: { id: "model-1", name: "Galaxy S24", slug: "galaxy-s24", brand: { name: "Samsung" } },
    dupMsg: "Este modelo ya existe para esta marca",
    notFoundMsg: "Modelo no encontrado",
    auditAction: "MODEL_UPDATE",
  },
  {
    nombre: "categoría",
    handler: patchCategory,
    url: "https://app.invalid/api/categories",
    findFirst: mocks.categoryFindFirst,
    update: mocks.categoryUpdate,
    existing: { id: "cat-1", name: "Pantallas" },
    updated: { id: "cat-1", name: "Pantallas OLED", slug: "pantallas-oled" },
    dupMsg: "Esta categoría ya existe",
    notFoundMsg: "Categoría no encontrada",
    auditAction: "CATEGORY_UPDATE",
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin)
  mocks.auditCreate.mockResolvedValue({})
})

for (const r of resources) {
  describe(`PATCH rename — ${r.nombre}`, () => {
    it("renombra, regenera el slug y registra en bitácora", async () => {
      r.findFirst
        .mockResolvedValueOnce(r.existing) // registro propio del tenant
        .mockResolvedValueOnce(null) // sin duplicado
      r.update.mockResolvedValueOnce(r.updated)

      const res = await r.handler(patchReq(r.url, { id: r.existing.id, name: (r.updated as { name: string }).name }))

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ id: r.existing.id, name: (r.updated as { name: string }).name })

      // El lookup del registro va acotado al tenant de la sesión.
      expect(r.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ where: expect.objectContaining({ id: r.existing.id, businessId: BIZ }) }),
      )
      // El chequeo de duplicados excluye al propio registro.
      expect(r.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: expect.objectContaining({ businessId: BIZ, id: { not: r.existing.id } }) }),
      )
      expect(r.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: r.existing.id },
          data: { name: (r.updated as { name: string }).name, slug: (r.updated as { slug: string }).slug },
        }),
      )
      expect(mocks.auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: r.auditAction,
            businessId: BIZ,
            changes: { name: { before: r.existing.name, after: (r.updated as { name: string }).name } },
          }),
        }),
      )
    })

    it("rechaza nombre vacío o solo espacios con 400 y no toca la BD", async () => {
      for (const name of ["", "   "]) {
        const res = await r.handler(patchReq(r.url, { id: r.existing.id, name }))
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toBeTruthy()
      }
      expect(r.findFirst).not.toHaveBeenCalled()
      expect(r.update).not.toHaveBeenCalled()
    })

    it("rechaza duplicado en el mismo tenant con el mensaje del POST", async () => {
      r.findFirst
        .mockResolvedValueOnce(r.existing)
        .mockResolvedValueOnce({ id: "otro-registro" })

      const res = await r.handler(patchReq(r.url, { id: r.existing.id, name: "Nombre Duplicado" }))

      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(r.dupMsg)
      expect(r.update).not.toHaveBeenCalled()
    })

    it("un registro de otro tenant responde 404, nunca lo renombra", async () => {
      // findFirst con businessId de la sesión no encuentra el id ajeno.
      r.findFirst.mockResolvedValueOnce(null)

      const res = await r.handler(patchReq(r.url, { id: "registro-de-otro-negocio", name: "X" }))

      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe(r.notFoundMsg)
      expect(r.update).not.toHaveBeenCalled()
    })

    it("empleado sin el módulo inventario recibe 403", async () => {
      mocks.auth.mockResolvedValueOnce(employeeSinModulo)

      const res = await r.handler(patchReq(r.url, { id: r.existing.id, name: "X" }))

      expect(res.status).toBe(403)
      expect(r.findFirst).not.toHaveBeenCalled()
    })

    it("sin sesión recibe 401", async () => {
      mocks.auth.mockResolvedValueOnce(null)

      const res = await r.handler(patchReq(r.url, { id: r.existing.id, name: "X" }))

      expect(res.status).toBe(401)
      expect(r.findFirst).not.toHaveBeenCalled()
    })
  })
}
