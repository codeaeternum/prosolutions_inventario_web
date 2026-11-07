import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Resolución del tenant en rutas públicas (auditoría multi-tenant).
 *
 * Contrato: las rutas de catálogo sin sesión resuelven el negocio por
 * `?biz=<slug>` o header `x-tenant-slug`. Sin indicio siguen cayendo al
 * default histórico (primer Business activo, compat mono-tenant). Un slug
 * EXPLÍCITO que no existe o está inactivo responde 404 — nunca el fallback
 * silencioso al tenant #1 (eso serviría el catálogo de un negocio bajo la
 * vitrina de otro).
 *
 * POST /api/auth/register acepta `slug`/`businessSlug` en el body para crear
 * la cuenta en la vitrina de origen; sin él conserva el default.
 */

const BIZ_DEFAULT = "biz-default"
const BIZ_TWO = "biz-2"
const SLUG_TWO = "vitrina-dos"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  businessFindFirst: vi.fn(),
  productFindMany: vi.fn(),
  productFindUnique: vi.fn(),
  productCount: vi.fn(),
  categoryFindMany: vi.fn(),
  brandFindMany: vi.fn(),
  modelFindMany: vi.fn(),
  settingsFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  userCreate: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    business: { findFirst: mocks.businessFindFirst },
    product: {
      findMany: mocks.productFindMany,
      findUnique: mocks.productFindUnique,
      count: mocks.productCount,
    },
    category: { findMany: mocks.categoryFindMany },
    brand: { findMany: mocks.brandFindMany },
    model: { findMany: mocks.modelFindMany },
    settings: { findFirst: mocks.settingsFindFirst },
    user: {
      findUnique: mocks.userFindUnique,
      findMany: mocks.userFindMany,
      create: mocks.userCreate,
    },
    $queryRaw: mocks.queryRaw,
  },
}))

import { GET as listProducts } from "@/app/api/products/route"
import { GET as getProduct } from "@/app/api/products/[id]/route"
import { GET as searchPos } from "@/app/api/search/pos/route"
import { GET as listCategories } from "@/app/api/categories/route"
import { GET as listBrands } from "@/app/api/brands/route"
import { GET as listModels } from "@/app/api/models/route"
import { GET as getSettings } from "@/app/api/settings/route"
import { POST as register } from "@/app/api/auth/register/route"

// IP distinta por test: el limiter de /api/auth/register comparte store.
vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const req = (url: string, init: RequestInit = {}) =>
  new Request(url, {
    ...init,
    headers: { "cf-connecting-ip": `10.8.8.${++ipCounter}`, ...(init.headers ?? {}) },
  })
const paramsOf = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) })

const productRow = {
  id: "p1",
  name: "Pantalla iPhone 15",
  retailPrice: 2500,
  stock: 4,
  images: [],
  isActive: true,
  marketVisibility: "PUBLIC",
  category: { name: "Pantallas" },
  models: [],
  _count: { reservations: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null) // anónimo: la resolución cae al slug/default
  // business.findFirst: con where.slug es la resolución de vitrina
  // (businessIdForSlug); sin slug es getDefaultBusinessId (primer activo).
  mocks.businessFindFirst.mockImplementation((args?: { where?: { slug?: string } }) =>
    Promise.resolve(
      args?.where?.slug
        ? args.where.slug === SLUG_TWO ? { id: BIZ_TWO } : null
        : { id: BIZ_DEFAULT }
    )
  )
  mocks.productFindMany.mockResolvedValue([productRow])
  mocks.productFindUnique.mockResolvedValue(productRow)
  mocks.productCount.mockResolvedValue(1)
  mocks.categoryFindMany.mockResolvedValue([])
  mocks.brandFindMany.mockResolvedValue([])
  mocks.modelFindMany.mockResolvedValue([])
  mocks.settingsFindFirst.mockResolvedValue(null)
  mocks.userFindUnique.mockResolvedValue(null)
  mocks.userFindMany.mockResolvedValue([])
  mocks.userCreate.mockResolvedValue({ id: "u-new" })
  mocks.queryRaw.mockResolvedValue([])
})

describe("GET /api/products — tenant público", () => {
  it("?biz=<slug> limita el catálogo a ESE negocio", async () => {
    const res = await listProducts(req(`https://app.invalid/api/products?biz=${SLUG_TWO}`))
    expect(res.status).toBe(200)
    expect(mocks.productFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
    expect(mocks.productCount.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("el header x-tenant-slug resuelve igual que ?biz", async () => {
    const res = await listProducts(
      req("https://app.invalid/api/products", { headers: { "x-tenant-slug": SLUG_TWO } })
    )
    expect(res.status).toBe(200)
    expect(mocks.productFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("sin indicio conserva el default (compat mono-tenant)", async () => {
    const res = await listProducts(req("https://app.invalid/api/products"))
    expect(res.status).toBe(200)
    expect(mocks.productFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_DEFAULT)
  })

  it("slug explícito inexistente responde 404, no el catálogo del default", async () => {
    const res = await listProducts(req("https://app.invalid/api/products?biz=no-existe"))
    expect(res.status).toBe(404)
    expect(mocks.productFindMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/products/[id] — tenant público", () => {
  it("?biz=<slug> busca la pieza en ese negocio", async () => {
    const res = await getProduct(
      new NextRequest(`https://app.invalid/api/products/p1?biz=${SLUG_TWO}`),
      paramsOf({ id: "p1" })
    )
    expect(res.status).toBe(200)
    expect(mocks.productFindUnique.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("slug inexistente responde 404 sin tocar la base de productos", async () => {
    const res = await getProduct(
      new NextRequest("https://app.invalid/api/products/p1?biz=no-existe"),
      paramsOf({ id: "p1" })
    )
    expect(res.status).toBe(404)
    expect(mocks.productFindUnique).not.toHaveBeenCalled()
  })
})

describe("GET /api/search/pos — tenant público", () => {
  it("?biz=<slug> busca dentro de ese negocio", async () => {
    const res = await searchPos(req(`https://app.invalid/api/search/pos?q=pant&biz=${SLUG_TWO}`))
    expect(res.status).toBe(200)
    expect(mocks.productFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("slug inexistente responde 404", async () => {
    const res = await searchPos(req("https://app.invalid/api/search/pos?q=pant&biz=no-existe"))
    expect(res.status).toBe(404)
    expect(mocks.productFindMany).not.toHaveBeenCalled()
  })
})

describe("catálogos auxiliares — tenant público", () => {
  it("GET /api/categories?biz=<slug> usa ese negocio", async () => {
    const res = await listCategories(req(`https://app.invalid/api/categories?biz=${SLUG_TWO}`))
    expect(res.status).toBe(200)
    expect(mocks.categoryFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("GET /api/brands?biz=<slug> usa ese negocio", async () => {
    const res = await listBrands(req(`https://app.invalid/api/brands?biz=${SLUG_TWO}`))
    expect(res.status).toBe(200)
    expect(mocks.brandFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("GET /api/models?biz=<slug> usa ese negocio", async () => {
    const res = await listModels(req(`https://app.invalid/api/models?biz=${SLUG_TWO}`))
    expect(res.status).toBe(200)
    expect(mocks.modelFindMany.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it("GET /api/settings?biz=<slug> lee los ajustes de ese negocio", async () => {
    const res = await getSettings(req(`https://app.invalid/api/settings?biz=${SLUG_TWO}`))
    expect(res.status).toBe(200)
    expect(mocks.settingsFindFirst.mock.calls[0][0].where.businessId).toBe(BIZ_TWO)
  })

  it.each([
    ["categories", () => listCategories(req("https://app.invalid/api/categories?biz=no-existe"))],
    ["brands", () => listBrands(req("https://app.invalid/api/brands?biz=no-existe"))],
    ["models", () => listModels(req("https://app.invalid/api/models?biz=no-existe"))],
    ["settings", () => getSettings(req("https://app.invalid/api/settings?biz=no-existe"))],
  ])("slug inexistente en /api/%s responde 404", async (_name, call) => {
    const res = await call()
    expect(res.status).toBe(404)
  })
})

describe("POST /api/auth/register — tenant de la vitrina", () => {
  const body = { name: "Cliente Nuevo", password: "secreto123", phone: "811 234 5678" }
  const postReq = (payload: unknown) =>
    req("https://app.invalid/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

  it("con businessSlug la cuenta nace en ese negocio", async () => {
    const res = await register(postReq({ ...body, businessSlug: SLUG_TWO }))
    expect(res.status).toBe(200)
    expect(mocks.userCreate.mock.calls[0][0].data.businessId).toBe(BIZ_TWO)
  })

  it("acepta también el alias slug", async () => {
    const res = await register(postReq({ ...body, slug: SLUG_TWO }))
    expect(res.status).toBe(200)
    expect(mocks.userCreate.mock.calls[0][0].data.businessId).toBe(BIZ_TWO)
  })

  it("sin slug conserva el default (compat)", async () => {
    const res = await register(postReq(body))
    expect(res.status).toBe(200)
    expect(mocks.userCreate.mock.calls[0][0].data.businessId).toBe(BIZ_DEFAULT)
  })

  it("slug inexistente responde 404 y NO crea la cuenta en otro negocio", async () => {
    const res = await register(postReq({ ...body, businessSlug: "no-existe" }))
    expect(res.status).toBe(404)
    expect(mocks.userCreate).not.toHaveBeenCalled()
  })
})
