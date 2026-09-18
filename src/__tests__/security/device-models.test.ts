import { beforeEach, describe, expect, it, vi } from "vitest"
import { SUGGESTED_SERVICES } from "@/lib/workshop-service-suggestions"

// Mocks hoisted: auth decide la sesión; prisma es un stub por modelo.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  dmFindMany: vi.fn(),
  dmFindFirst: vi.fn(),
  dmUpsert: vi.fn(),
  dmCreate: vi.fn(),
  dmUpdate: vi.fn(),
  dmDelete: vi.fn(),
  wsFindMany: vi.fn(),
  wsCreateMany: vi.fn(),
  txUserFindUnique: vi.fn(),
  txOpFindUnique: vi.fn(),
  txOpCreate: vi.fn(),
  txOpUpdate: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    deviceModel: {
      findMany: mocks.dmFindMany,
      findFirst: mocks.dmFindFirst,
      upsert: mocks.dmUpsert,
      create: mocks.dmCreate,
      update: mocks.dmUpdate,
      delete: mocks.dmDelete,
    },
    workshopService: { findMany: mocks.wsFindMany, createMany: mocks.wsCreateMany },
  },
}))

import { GET as getModels, POST as postModel } from "@/app/api/device-models/route"
import { DELETE as deleteModel } from "@/app/api/device-models/[id]/route"
import { POST as importModels } from "@/app/api/device-models/import/route"
import { POST as seedSuggested } from "@/app/api/workshop-services/seed-suggested/route"

const TENANT = "biz-1"
const staff = (id = "u1", role = "ADMIN", isSuperAdmin = false) => ({
  user: { id, role, status: "APPROVED", businessId: TENANT, isSuperAdmin },
})
const post = (body: unknown) =>
  new Request("https://app.invalid/api/device-models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const del = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(staff())
  mocks.dmFindMany.mockResolvedValue([])
  mocks.dmFindFirst.mockResolvedValue(null)
  mocks.dmUpsert.mockImplementation(async ({ create }) => ({ id: "m1", ...create }))
  mocks.dmCreate.mockImplementation(async ({ data }) => ({ id: "m1", ...data }))
  mocks.dmUpdate.mockImplementation(async ({ data }) => ({ id: "m1", ...data }))
  mocks.dmDelete.mockResolvedValue({})
  // operation() abre db.$transaction(work) — se ejecuta con un tx stub.
  // La importación por tenant usa la forma de arreglo: se resuelven las
  // promesas que los mocks de upsert ya devolvieron.
  const txStub = {
    user: { findUnique: mocks.txUserFindUnique },
    businessOperation: { findUnique: mocks.txOpFindUnique, create: mocks.txOpCreate, update: mocks.txOpUpdate },
    workshopService: { findMany: mocks.wsFindMany, createMany: mocks.wsCreateMany },
    deviceModel: { findFirst: mocks.dmFindFirst, create: mocks.dmCreate, update: mocks.dmUpdate },
  }
  mocks.transaction.mockImplementation(async (work: unknown) =>
    typeof work === "function" ? (work as (tx: unknown) => Promise<unknown>)(txStub) : Promise.all(work as Promise<unknown>[]),
  )
  mocks.txUserFindUnique.mockResolvedValue({ id: "u1", status: "APPROVED", role: "ADMIN", businessId: TENANT })
  mocks.txOpFindUnique.mockResolvedValue(null)
  mocks.txOpCreate.mockResolvedValue({ id: "op-1" })
  mocks.txOpUpdate.mockResolvedValue({})
  mocks.wsFindMany.mockResolvedValue([])
  mocks.wsCreateMany.mockResolvedValue({ count: 0 })
})

describe("GET /api/device-models — merge global + tenant", () => {
  it("scopes la consulta al catálogo global y al tenant de la sesión", async () => {
    const response = await getModels(new Request("https://app.invalid/api/device-models"))
    expect(response.status).toBe(200)
    const where = mocks.dmFindMany.mock.calls[0][0].where
    expect(where.AND[0].OR).toEqual([{ businessId: null }, { businessId: TENANT }])
  })

  it("dedup por marca+modelo: la fila del tenant gana sobre la global", async () => {
    mocks.dmFindMany.mockResolvedValue([
      { id: "g1", businessId: null, brand: "Samsung", model: "Galaxy A54", code: "G", type: "SMARTPHONE" },
      { id: "t1", businessId: TENANT, brand: "Samsung", model: "Galaxy A54", code: "T", type: "SMARTPHONE" },
      { id: "g2", businessId: null, brand: "Apple", model: "iPhone 13", code: null, type: "SMARTPHONE" },
    ])
    const json = await (await getModels(new Request("https://app.invalid/api/device-models"))).json()
    expect(json.models).toHaveLength(2)
    const samsung = json.models.find((m: { brand: string }) => m.brand === "Samsung")
    expect(samsung.id).toBe("t1")
    expect(samsung.code).toBe("T")
  })

  it("exige sesión de staff", async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await getModels(new Request("https://app.invalid/api/device-models"))).status).toBe(401)
    expect(mocks.dmFindMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/device-models", () => {
  it("staff crea modelo privado con el businessId de su sesión", async () => {
    const response = await postModel(post({ brand: "Samsung", model: "Galaxy A54", code: "SM-A546E" }))
    expect(response.status).toBe(201)
    const args = mocks.dmUpsert.mock.calls[0][0]
    expect(args.where.businessId_brand_model).toEqual({ businessId: TENANT, brand: "Samsung", model: "Galaxy A54" })
    expect(args.create.businessId).toBe(TENANT)
  })

  it("global: true sin ser superadmin → 403 y no escribe", async () => {
    const response = await postModel(post({ brand: "Samsung", model: "Galaxy A54", global: true }))
    expect(response.status).toBe(403)
    expect(mocks.dmUpsert).not.toHaveBeenCalled()
    expect(mocks.dmCreate).not.toHaveBeenCalled()
  })

  it("superadmin con global: true escribe en el catálogo global (businessId null)", async () => {
    mocks.auth.mockResolvedValue(staff("root", "ADMIN", true))
    const response = await postModel(post({ brand: "Samsung", model: "Galaxy A54", global: true }))
    expect(response.status).toBe(201)
    expect(mocks.dmFindFirst).toHaveBeenCalledWith({ where: { businessId: null, brand: "Samsung", model: "Galaxy A54" } })
    expect(mocks.dmCreate.mock.calls[0][0].data.businessId).toBeNull()
    expect(mocks.dmUpsert).not.toHaveBeenCalled()
  })

  it("superadmin con global: true actualiza el global existente en vez de duplicar", async () => {
    mocks.auth.mockResolvedValue(staff("root", "ADMIN", true))
    mocks.dmFindFirst.mockResolvedValue({ id: "g1" })
    const response = await postModel(post({ brand: "Samsung", model: "Galaxy A54", global: true, code: "X" }))
    expect(response.status).toBe(201)
    expect(mocks.dmUpdate).toHaveBeenCalledWith({ where: { id: "g1" }, data: { code: "X", type: "SMARTPHONE" } })
    expect(mocks.dmCreate).not.toHaveBeenCalled()
  })

  it("un body con businessId ajeno no puede elegir el scope", async () => {
    const response = await postModel(post({ brand: "A", model: "B", businessId: "biz-otro" }))
    expect(response.status).toBe(201)
    expect(mocks.dmUpsert.mock.calls[0][0].create.businessId).toBe(TENANT)
  })
})

describe("DELETE /api/device-models/[id]", () => {
  it("staff borra modelos de su propio tenant", async () => {
    mocks.dmFindFirst.mockResolvedValue({ id: "t1", businessId: TENANT })
    const response = await deleteModel(new Request("https://app.invalid/api/device-models/t1", { method: "DELETE" }), del("t1"))
    expect(response.status).toBe(200)
    expect(mocks.dmDelete).toHaveBeenCalledWith({ where: { id: "t1" } })
  })

  it("staff de tenant no puede borrar un modelo global → 403", async () => {
    mocks.dmFindFirst.mockResolvedValue({ id: "g1", businessId: null })
    const response = await deleteModel(new Request("https://app.invalid/api/device-models/g1", { method: "DELETE" }), del("g1"))
    expect(response.status).toBe(403)
    expect(mocks.dmDelete).not.toHaveBeenCalled()
  })

  it("superadmin sí borra un modelo global", async () => {
    mocks.auth.mockResolvedValue(staff("root", "ADMIN", true))
    mocks.dmFindFirst.mockResolvedValue({ id: "g1", businessId: null })
    const response = await deleteModel(new Request("https://app.invalid/api/device-models/g1", { method: "DELETE" }), del("g1"))
    expect(response.status).toBe(200)
  })

  it("un modelo de otro tenant responde 404 (no se revela)", async () => {
    mocks.dmFindFirst.mockResolvedValue(null)
    const response = await deleteModel(new Request("https://app.invalid/api/device-models/x", { method: "DELETE" }), del("x"))
    expect(response.status).toBe(404)
    const where = mocks.dmFindFirst.mock.calls[0][0].where
    expect(where.OR).toEqual([{ businessId: TENANT }, { businessId: null }])
  })
})

describe("POST /api/device-models/import", () => {
  const callImport = (body: unknown) =>
    importModels(new Request("https://app.invalid/api/device-models/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }))

  it("scope global: superadmin siembra con businessId null vía findFirst+create", async () => {
    mocks.auth.mockResolvedValue(staff("root", "ADMIN", true))
    const response = await callImport({ rows: [{ brand: "Samsung", model: "Galaxy A54", type: "SMARTPHONE" }] })
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.created).toBe(1)
    expect(mocks.dmFindFirst).toHaveBeenCalledWith({ where: { businessId: null, brand: "Samsung", model: "Galaxy A54" }, select: { id: true } })
    expect(mocks.dmCreate.mock.calls[0][0].data.businessId).toBeNull()
  })

  it("scope global rechaza a un admin de tenant", async () => {
    const response = await callImport({ rows: [{ brand: "A", model: "B" }] })
    expect(response.status).toBe(403)
    expect(mocks.dmCreate).not.toHaveBeenCalled()
  })

  it("scope tenant: admin importa a su negocio con upsert compuesto", async () => {
    mocks.dmFindMany.mockResolvedValue([])
    const response = await callImport({ scope: "tenant", rows: [{ brand: "A", model: "B" }] })
    expect(response.status).toBe(200)
    expect(mocks.dmUpsert.mock.calls[0][0].where.businessId_brand_model.businessId).toBe(TENANT)
  })

  it("scope tenant rechaza a un empleado", async () => {
    mocks.auth.mockResolvedValue(staff("e1", "EMPLOYEE"))
    expect((await callImport({ scope: "tenant", rows: [{ brand: "A", model: "B" }] })).status).toBe(403)
  })
})

describe("POST /api/workshop-services/seed-suggested", () => {
  const call = () =>
    seedSuggested(new Request("https://app.invalid/api/workshop-services/seed-suggested", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "seed-suggested-0001" }),
    }))

  it("crea el catálogo sugerido completo en un tenant vacío", async () => {
    const json = await (await call()).json()
    expect(json.created).toBe(SUGGESTED_SERVICES.length)
    expect(json.skipped).toBe(0)
    const rows = mocks.wsCreateMany.mock.calls[0][0].data
    expect(rows).toHaveLength(SUGGESTED_SERVICES.length)
    expect(rows.every((r: { businessId: string }) => r.businessId === TENANT)).toBe(true)
    expect(rows.every((r: { priceCents: null }) => r.priceCents === null)).toBe(true)
  })

  it("dedup por nombre case-insensitive: solo crea los faltantes", async () => {
    mocks.wsFindMany.mockResolvedValue([{ name: "diagnóstico general" }, { name: "CAMBIO DE BATERÍA" }])
    const json = await (await call()).json()
    expect(json.skipped).toBe(2)
    expect(json.created).toBe(SUGGESTED_SERVICES.length - 2)
    const rows = mocks.wsCreateMany.mock.calls[0][0].data
    expect(rows.some((r: { name: string }) => r.name === "Diagnóstico general")).toBe(false)
    expect(rows.some((r: { name: string }) => r.name === "Cambio de batería")).toBe(false)
  })

  it("empleado no puede sembrar el catálogo (admin-only)", async () => {
    mocks.auth.mockResolvedValue(staff("e1", "EMPLOYEE"))
    expect((await call()).status).toBe(403)
    expect(mocks.wsCreateMany).not.toHaveBeenCalled()
  })

  it("los nombres sugeridos son únicos (el dedup es por nombre)", () => {
    const names = SUGGESTED_SERVICES.map(s => s.name.toLowerCase())
    expect(new Set(names).size).toBe(SUGGESTED_SERVICES.length)
    expect(SUGGESTED_SERVICES.length).toBeGreaterThanOrEqual(15)
  })
})
