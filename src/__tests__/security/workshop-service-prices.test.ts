import { beforeEach, describe, expect, it, vi } from "vitest"

// Prueba de rutas con prisma y auth mockeados — mismo patrón que
// device-models.test.ts: auth decide la sesión; prisma es un stub por
// modelo y $transaction ejecuta el trabajo con un tx equivalente.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  wsFindMany: vi.fn(),
  wsFindUnique: vi.fn(),
  wsFindUniqueOrThrow: vi.fn(),
  wsUpdate: vi.fn(),
  wsCreate: vi.fn(),
  wspDeleteMany: vi.fn(),
  wspCreateMany: vi.fn(),
  dmFindMany: vi.fn(),
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
    workshopService: {
      findMany: mocks.wsFindMany,
      findUnique: mocks.wsFindUnique,
      findUniqueOrThrow: mocks.wsFindUniqueOrThrow,
      update: mocks.wsUpdate,
      create: mocks.wsCreate,
    },
    workshopServicePrice: { deleteMany: mocks.wspDeleteMany, createMany: mocks.wspCreateMany },
    deviceModel: { findMany: mocks.dmFindMany },
  },
}))

import { GET as getServices, POST as postService } from "@/app/api/workshop-services/route"
import { PATCH as patchService } from "@/app/api/workshop-services/[id]/route"

const TENANT = "biz-1"
const admin = () => ({ user: { id: "u1", role: "ADMIN", status: "APPROVED", businessId: TENANT } })
const patch = (id: string, body: unknown) => [
  new Request(`https://app.invalid/api/workshop-services/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
] as const
const post = (body: unknown) =>
  new Request("https://app.invalid/api/workshop-services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(admin())
  // PATCH corre dentro de transaction() → prisma.$transaction(work): el tx
  // recibe los mismos stubs por modelo.
  const txStub = {
    workshopService: {
      findUnique: mocks.wsFindUnique,
      findUniqueOrThrow: mocks.wsFindUniqueOrThrow,
      update: mocks.wsUpdate,
      create: mocks.wsCreate,
    },
    workshopServicePrice: { deleteMany: mocks.wspDeleteMany, createMany: mocks.wspCreateMany },
    deviceModel: { findMany: mocks.dmFindMany },
    user: { findUnique: mocks.txUserFindUnique },
    businessOperation: { findUnique: mocks.txOpFindUnique, create: mocks.txOpCreate, update: mocks.txOpUpdate },
  }
  mocks.transaction.mockImplementation(async (work: unknown) =>
    typeof work === "function" ? (work as (tx: unknown) => Promise<unknown>)(txStub) : Promise.all(work as Promise<unknown>[]),
  )
  mocks.wsFindMany.mockResolvedValue([])
  mocks.wsFindUnique.mockResolvedValue({ id: "s1", businessId: TENANT })
  mocks.wsFindUniqueOrThrow.mockResolvedValue({ id: "s1", businessId: TENANT, name: "Servicio", prices: [] })
  mocks.wsUpdate.mockResolvedValue({})
  mocks.wsCreate.mockImplementation(async ({ data }) => ({ id: "s1", ...data }))
  mocks.wspDeleteMany.mockResolvedValue({ count: 0 })
  mocks.wspCreateMany.mockResolvedValue({ count: 0 })
  mocks.dmFindMany.mockResolvedValue([])
  mocks.txUserFindUnique.mockResolvedValue({ id: "u1", status: "APPROVED", role: "ADMIN", businessId: TENANT })
  mocks.txOpFindUnique.mockResolvedValue(null)
  mocks.txOpCreate.mockResolvedValue({ id: "op-1" })
  mocks.txOpUpdate.mockResolvedValue({})
})

describe("GET /api/workshop-services — incluye precios por dispositivo", () => {
  it("cada servicio trae prices con alcance, precio y marca/modelo", async () => {
    mocks.wsFindMany.mockResolvedValue([
      { id: "s1", name: "Cambio de pantalla", priceCents: 50000, prices: [
        { id: "p1", deviceModelId: "m1", equipmentType: null, priceCents: 90000, deviceModel: { brand: "Apple", model: "iPhone 12" } },
      ] },
    ])
    const response = await getServices(new Request("https://app.invalid/api/workshop-services"))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.services[0].prices[0]).toMatchObject({ deviceModelId: "m1", priceCents: 90000, deviceModel: { brand: "Apple", model: "iPhone 12" } })
    const include = mocks.wsFindMany.mock.calls[0][0].include
    expect(include.prices.select).toMatchObject({ deviceModelId: true, equipmentType: true, priceCents: true })
    expect(include.prices.select.deviceModel.select).toEqual({ brand: true, model: true })
  })
})

describe("PATCH /api/workshop-services/[id] — reemplazo de precios", () => {
  const prices = [
    { deviceModelId: "m1", priceCents: 90000 },
    { equipmentType: "Celular", priceCents: 70000 },
  ]

  it("reemplaza el set completo: deleteMany + createMany en la misma tx", async () => {
    mocks.dmFindMany.mockResolvedValue([{ id: "m1" }])
    const response = await patchService(...patch("s1", { prices }))
    expect(response.status).toBe(200)
    expect(mocks.dmFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["m1"] }, OR: [{ businessId: null }, { businessId: TENANT }] },
      select: { id: true },
    })
    expect(mocks.wspDeleteMany).toHaveBeenCalledWith({ where: { serviceId: "s1" } })
    const data = mocks.wspCreateMany.mock.calls[0][0].data
    expect(data).toEqual([
      { serviceId: "s1", deviceModelId: "m1", equipmentType: null, priceCents: 90000 },
      { serviceId: "s1", deviceModelId: null, equipmentType: "Celular", priceCents: 70000 },
    ])
  })

  it("dedup por alcance dentro del payload: la última fila gana", async () => {
    mocks.dmFindMany.mockResolvedValue([{ id: "m1" }])
    const response = await patchService(...patch("s1", { prices: [{ deviceModelId: "m1", priceCents: 1 }, { deviceModelId: "m1", priceCents: 2 }] }))
    expect(response.status).toBe(200)
    expect(mocks.wspCreateMany.mock.calls[0][0].data).toEqual([{ serviceId: "s1", deviceModelId: "m1", equipmentType: null, priceCents: 2 }])
  })

  it("prices: [] vacía el set sin crear filas", async () => {
    const response = await patchService(...patch("s1", { prices: [] }))
    expect(response.status).toBe(200)
    expect(mocks.wspDeleteMany).toHaveBeenCalledWith({ where: { serviceId: "s1" } })
    expect(mocks.wspCreateMany).not.toHaveBeenCalled()
  })

  it("omitir prices deja el set intacto (solo actualiza campos)", async () => {
    const response = await patchService(...patch("s1", { name: "Nuevo nombre" }))
    expect(response.status).toBe(200)
    expect(mocks.wspDeleteMany).not.toHaveBeenCalled()
    expect(mocks.wspCreateMany).not.toHaveBeenCalled()
    expect(mocks.wsUpdate.mock.calls[0][0].data.name).toBe("Nuevo nombre")
  })

  it("un deviceModelId fuera del catálogo visible → 400 y nada se escribe", async () => {
    mocks.dmFindMany.mockResolvedValue([]) // "m1" no existe ni global ni del tenant
    const response = await patchService(...patch("s1", { prices }))
    expect(response.status).toBe(400)
    expect(mocks.wspDeleteMany).not.toHaveBeenCalled()
    expect(mocks.wspCreateMany).not.toHaveBeenCalled()
  })

  it("una fila con ambos alcances o sin alcance → 400 de validación", async () => {
    expect((await patchService(...patch("s1", { prices: [{ deviceModelId: "m1", equipmentType: "Celular", priceCents: 1 }] }))).status).toBe(400)
    expect((await patchService(...patch("s1", { prices: [{ priceCents: 1 }] }))).status).toBe(400)
    expect((await patchService(...patch("s1", { prices: [{ equipmentType: "Celular", priceCents: -5 }] }))).status).toBe(400)
    expect(mocks.wsFindUnique).not.toHaveBeenCalled()
  })

  it("servicio de otro tenant → 404 y no toca precios", async () => {
    mocks.wsFindUnique.mockResolvedValue(null)
    const response = await patchService(...patch("s1", { prices }))
    expect(response.status).toBe(404)
    expect(mocks.wspDeleteMany).not.toHaveBeenCalled()
  })

  it("empleado no puede editar precios (admin-only)", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "e1", role: "EMPLOYEE", status: "APPROVED", businessId: TENANT } })
    expect((await patchService(...patch("s1", { prices }))).status).toBe(403)
    expect(mocks.wspCreateMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/workshop-services — crear con precios", () => {
  const body = {
    name: "Cambio de pantalla",
    priceCents: 50000,
    idempotencyKey: "service-create-0001",
    prices: [{ deviceModelId: "m1", priceCents: 90000 }, { equipmentType: "Celular", priceCents: 70000 }],
  }

  it("crea el servicio con sus precios anidados tras validar modelos", async () => {
    mocks.dmFindMany.mockResolvedValue([{ id: "m1" }])
    const response = await postService(post(body))
    expect(response.status).toBe(201)
    const data = mocks.wsCreate.mock.calls[0][0].data
    expect(data.prices.create).toEqual([
      { deviceModelId: "m1", equipmentType: null, priceCents: 90000 },
      { deviceModelId: null, equipmentType: "Celular", priceCents: 70000 },
    ])
  })

  it("modelo inexistente en el payload → 400 y no crea el servicio", async () => {
    mocks.dmFindMany.mockResolvedValue([])
    const response = await postService(post(body))
    expect(response.status).toBe(400)
    expect(mocks.wsCreate).not.toHaveBeenCalled()
  })
})
