import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Auditoría de exposición de precios internos — contrato del negocio:
 *
 *   costPrice / internalPrice / unitCostCents  → JAMÁS en respuesta pública,
 *     de CUSTOMER ni de taller aliado (WORKSHOP). internalPrice solo sale a
 *     staff (ADMIN/EMPLOYEE) y costPrice solo al dueño (ADMIN).
 *   wholesalePrice → solo para aliado autorizado (CUSTOMER aprobado con
 *     customerType STORE/TECHNICIAN, o WORKSHOP en su catálogo /api/marketplace)
 *     o staff. Público y CUSTOMER normal → fuera.
 *
 * Cada caso corre el handler real con una sesión mockeada y una fila
 * "envenenada" (todos los campos sensibles presentes). Se revisa el JSON de
 * respuesta RECURSIVAMENTE — un include/select anidado que escape un campo
 * interno debe tronar el test — y, cuando el handler filtra por `select`,
 * también se fija el contrato del propio select.
 */

const BIZ = "biz-1"

const mocks = vi.hoisted(() => {
  const prisma = {
    product: {
      findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(),
      count: vi.fn(), update: vi.fn(), create: vi.fn(),
      groupBy: vi.fn(), updateMany: vi.fn(),
    },
    productModel: { deleteMany: vi.fn() },
    category: { findMany: vi.fn(), findFirst: vi.fn() },
    model: { count: vi.fn() },
    branch: { findFirst: vi.fn(), findMany: vi.fn() },
    branchStock: { findMany: vi.fn() },
    business: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    marketplaceRequest: {
      findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(), create: vi.fn(),
    },
    partRequest: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    encargo: { findMany: vi.fn() },
    reservation: { findMany: vi.fn(), count: vi.fn() },
    repairOrder: { findUnique: vi.fn(), updateMany: vi.fn() },
    repairEvent: { findFirst: vi.fn(), create: vi.fn() },
    repairPhoto: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    settings: { findFirst: vi.fn() },
    systemSettings: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    creditMovement: { findMany: vi.fn() },
    sale: { findMany: vi.fn() },
    directoryEvent: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    priceHistory: { create: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    workshopService: { findMany: vi.fn() },
    deviceModel: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    $extends: vi.fn(),
  }
  return { auth: vi.fn(), prisma, notify: vi.fn(async () => {}) }
})

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))
vi.mock("@/app/api/notifications/stream/route", () => ({ sendNotificationToStaff: mocks.notify }))

import { GET as listDirectory } from "@/app/api/directory/route"
import { GET as directoryProducts } from "@/app/api/directory/products/route"
import { GET as directoryCategories } from "@/app/api/directory/categories/route"
import { GET as directoryPartners } from "@/app/api/directory/partners/route"
import { GET as listProducts } from "@/app/api/products/route"
import { GET as getProduct, PUT as updateProduct } from "@/app/api/products/[id]/route"
import { GET as searchPos } from "@/app/api/search/pos/route"
import { GET as marketplaceCatalog } from "@/app/api/marketplace/route"
import { GET as marketplaceRequests } from "@/app/api/marketplace/requests/route"
import { GET as marketplacePurchases } from "@/app/api/marketplace/purchases/route"
import { GET as marketplaceSugerencias } from "@/app/api/marketplace/sugerencias/route"
import { GET as encargosList } from "@/app/api/encargos/route"
import { GET as listPartRequests, POST as createPartRequest } from "@/app/api/part-requests/route"
import { GET as quoteGet } from "@/app/api/cotizacion/[token]/route"
import { POST as quoteApprove } from "@/app/api/cotizacion/[token]/approve/route"
import { GET as cuentaGet } from "@/app/api/cuenta/[token]/route"
import { GET as evidenciaGet } from "@/app/api/evidencia/[token]/route"
import { GET as seguimientoGet } from "@/app/api/seguimiento/route"
import { GET as settingsGet } from "@/app/api/settings/route"
import { GET as reservationsGet } from "@/app/api/reservations/route"

/* ---------------- helpers ---------------- */

/** Llaves que JAMÁS deben aparecer (anidadas o no) fuera del staff interno. */
const INTERNAL_KEYS = ["costPrice", "internalPrice", "unitCostCents"] as const
/** Precio aliado: solo con autorización de aliado/staff. */
const WHOLESALE_KEY = "wholesalePrice"

/** Devuelve las rutas "a.b[0].c" donde aparece cualquiera de `keys`. */
function keyPaths(value: unknown, keys: readonly string[], path = "$", hits: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) keyPaths(v, keys, `${path}[${i}]`, hits)
    return hits
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.includes(k)) hits.push(`${path}.${k}`)
      keyPaths(v, keys, `${path}.${k}`, hits)
    }
  }
  return hits
}

/** La respuesta no contiene NINGUNA llave interna, en ningún nivel. */
const expectNoInternalKeys = (json: unknown, extra: readonly string[] = []) =>
  expect(keyPaths(json, [...INTERNAL_KEYS, ...extra])).toEqual([])

/** Cuentas de prueba: businessId+status aprobado, salvo que el caso lo pida. */
const asSession = (user: Record<string, unknown>) => ({
  user: { businessId: BIZ, status: "APPROVED", customerType: "NORMAL", name: "U", ...user },
})
const anonymous = null
const customer = asSession({ id: "c1", role: "CUSTOMER" })
const customerStore = asSession({ id: "c2", role: "CUSTOMER", customerType: "STORE" })
const customerTech = asSession({ id: "c3", role: "CUSTOMER", customerType: "TECHNICIAN" })
const workshop = asSession({ id: "w1", role: "WORKSHOP" })
const employee = asSession({ id: "e1", role: "EMPLOYEE" })
const admin = asSession({ id: "a1", role: "ADMIN" })

/** Fila de producto con TODOS los campos sensibles presentes. */
const productRow = {
  id: "p1",
  businessId: BIZ,
  name: "Pantalla iPhone 15",
  description: "OLED original",
  barcode: "750123456",
  retailPrice: 2500,
  wholesalePrice: 1900,
  internalPrice: 1600,
  costPrice: 900,
  stock: 4,
  minStock: 2,
  lowStockAlertAt: null,
  images: ["/uploads/p1.png"],
  isUniversal: true,
  isActive: true,
  marketVisibility: "PUBLIC",
  categoryId: "cat-1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  category: { id: "cat-1", name: "Pantallas", businessId: BIZ },
  models: [],
  stocks: [{ quantity: 4, branch: { id: "b1", name: "Centro", isActive: true } }],
  _count: { reservations: 0 },
}

// IP distinta por request: los limiters en memoria comparten store entre tests.
vi.stubEnv("TRUST_PROXY_HEADERS", "true")
let ipCounter = 0
const nextIp = () => `10.1.0.${++ipCounter}`
const req = (url: string, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { "x-real-ip": nextIp(), ...(init.headers ?? {}) } })
const paramsOf = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) })

beforeEach(() => {
  vi.clearAllMocks()
  // $transaction ejecuta el callback con el mismo mock como tx.
  mocks.prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) => work(mocks.prisma))
  mocks.prisma.business.findFirst.mockResolvedValue({ id: BIZ })
  mocks.prisma.systemSettings.findUnique.mockResolvedValue(null)
  mocks.prisma.systemSettings.findMany.mockResolvedValue([])
  mocks.prisma.directoryEvent.create.mockResolvedValue({})
  mocks.prisma.auditEvent.create.mockResolvedValue({})
  mocks.prisma.productModel.deleteMany.mockResolvedValue({ count: 0 })
  mocks.prisma.priceHistory.create.mockResolvedValue({})
  mocks.auth.mockResolvedValue(anonymous)
})

/* ---------------- directorio público ---------------- */

describe("GET /api/directory (público)", () => {
  it("solo expone datos de vitrina: nunca precios internos ni contacto", async () => {
    mocks.prisma.business.findMany.mockResolvedValue([
      {
        name: "Taller Uno", slug: "taller-uno", category: "Taller",
        logoUrl: "/uploads/logo.png", address: "Av. 1", lat: 25.1, lng: -100.1,
        // Veneno: si la whitelist dejara pasar el registro crudo, estos datos
        // internos del negocio aparecerían en la respuesta.
        email: "dueno@taller.com", phone: "8100000000",
        _count: { products: 3, workshopServices: 2 },
      },
    ])
    const res = await listDirectory(req("https://app.invalid/api/directory"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY, "email", "phone", "businessId"])
    expect(json.businesses[0]).toEqual({
      name: "Taller Uno", slug: "taller-uno", category: "Taller",
      logoUrl: "/uploads/logo.png", address: "Av. 1", lat: 25.1, lng: -100.1,
      counts: { products: 3, workshopServices: 2 },
    })
  })
})

describe("GET /api/directory/products (público)", () => {
  it("mapea a la vista pública y el select nunca pide precios internos", async () => {
    mocks.prisma.product.findMany.mockResolvedValue([
      { ...productRow, business: { name: "Taller Uno", slug: "taller-uno" } },
    ])
    const res = await directoryProducts(req("https://app.invalid/api/directory/products?q=pantalla"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY, "marketVisibility", "minStock"])
    expect(json.products[0].retailPrice).toBe(2500)
    // Disponibilidad binaria, nunca existencia exacta.
    expect(json.products[0].inStock).toBe(true)
    expect(json.products[0]).not.toHaveProperty("stock")
    // Contrato del select: solo campos ya públicos.
    const select = mocks.prisma.product.findMany.mock.calls[0][0].select
    for (const key of [WHOLESALE_KEY, ...INTERNAL_KEYS, "marketVisibility", "minStock", "businessId"]) {
      expect(select).not.toHaveProperty(key)
    }
    expect(mocks.prisma.product.findMany.mock.calls[0][0].where.marketVisibility).toBe("PUBLIC")
  })
})

describe("GET /api/directory/categories (público)", () => {
  it("solo nombre + conteo", async () => {
    mocks.prisma.category.findMany.mockResolvedValue([{ name: "Pantallas", _count: { products: 4 } }])
    const res = await directoryCategories(req("https://app.invalid/api/directory/categories"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY])
    expect(json.categories).toEqual([{ name: "Pantallas", count: 4 }])
  })
})

describe("GET /api/directory/partners (staff)", () => {
  it("niega anónimos, CUSTOMER y WORKSHOP sin tocar la base", async () => {
    for (const session of [anonymous, customer, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await directoryPartners()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.business.findMany).not.toHaveBeenCalled()
  })

  it("staff recibe solo id/name/slug", async () => {
    mocks.auth.mockResolvedValue(employee)
    mocks.prisma.business.findMany.mockResolvedValue([{ id: "biz-9", name: "Taller Socio", slug: "socio" }])
    const res = await directoryPartners()
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY])
    expect(json.partners).toEqual([{ id: "biz-9", name: "Taller Socio", slug: "socio" }])
  })
})

/* ---------------- catálogo tenant (/api/products + búsqueda POS) ---------------- */

describe("GET /api/products (auth opcional, DTO por viewer)", () => {
  const url = "https://app.invalid/api/products"
  const seedList = () => {
    mocks.prisma.product.findMany.mockResolvedValue([productRow])
    mocks.prisma.product.count.mockResolvedValue(1)
    mocks.prisma.$queryRaw.mockResolvedValue([{ productos: 1, unidades: 4, bajoMinimo: 0, sinStock: 0 }])
  }

  it("anónimo: solo campos públicos — sin mayoreo, interno, costo ni flags internos", async () => {
    seedList()
    const res = await listProducts(req(url))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.products[0].retailPrice).toBe(2500)
    expectNoInternalKeys(json, [WHOLESALE_KEY])
    for (const key of ["minStock", "marketVisibility", "businessId", "stocks", "_count", "isActive"]) {
      expect(json.products[0]).not.toHaveProperty(key)
    }
  })

  it("CUSTOMER normal: igual que anónimo (sin mayoreo)", async () => {
    mocks.auth.mockResolvedValue(customer)
    seedList()
    const json = await (await listProducts(req(url))).json()
    expectNoInternalKeys(json, [WHOLESALE_KEY])
  })

  it("CUSTOMER pendiente de aprobación: sin mayoreo aunque sea STORE", async () => {
    mocks.auth.mockResolvedValue({ user: { ...customerStore.user, status: "PENDING" } })
    seedList()
    const json = await (await listProducts(req(url))).json()
    expectNoInternalKeys(json, [WHOLESALE_KEY])
  })

  it.each([
    ["STORE", customerStore],
    ["TECHNICIAN", customerTech],
  ])("CUSTOMER %s aprobado (aliado comercial): ve wholesalePrice pero nunca costo/interno", async (_label, session) => {
    mocks.auth.mockResolvedValue(session)
    seedList()
    const json = await (await listProducts(req(url))).json()
    expect(json.products[0].wholesalePrice).toBe(1900)
    expectNoInternalKeys(json)
  })

  it("WORKSHOP: el catálogo tenant no le da mayoreo (su canal es /api/marketplace)", async () => {
    mocks.auth.mockResolvedValue(workshop)
    seedList()
    const json = await (await listProducts(req(url))).json()
    expectNoInternalKeys(json, [WHOLESALE_KEY])
  })

  it("EMPLOYEE: ve mayoreo + interno pero NUNCA costPrice (solo dueño)", async () => {
    mocks.auth.mockResolvedValue(employee)
    seedList()
    const json = await (await listProducts(req(url))).json()
    expect(json.products[0].wholesalePrice).toBe(1900)
    expect(json.products[0].internalPrice).toBe(1600)
    expect(keyPaths(json, ["costPrice", "unitCostCents"])).toEqual([])
  })

  it("ADMIN: ve costPrice (es el dueño)", async () => {
    mocks.auth.mockResolvedValue(admin)
    seedList()
    const json = await (await listProducts(req(url))).json()
    expect(json.products[0].costPrice).toBe(900)
  })

  it("lowStock=true exige staff: anónimo y CUSTOMER reciben 403", async () => {
    seedList()
    for (const session of [anonymous, customer, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await listProducts(req(`${url}?lowStock=true`))
      expect(res.status).toBe(403)
    }
  })
})

describe("GET /api/products/[id] (auth opcional)", () => {
  it("anónimo: sin mayoreo/interno/costo ni flags internos", async () => {
    mocks.prisma.product.findUnique.mockResolvedValue(productRow)
    const res = await getProduct(new NextRequest("https://app.invalid/api/products/p1"), paramsOf({ id: "p1" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY, "marketVisibility", "minStock", "lowStockAlertAt"])
    // El id de tenant no viaja en el nivel producto (el de la categoría
    // anidada es parte del contrato público preexistente del DTO).
    expect(json).not.toHaveProperty("businessId")
    expect(json.retailPrice).toBe(2500)
  })

  it("CUSTOMER aliado (STORE): wholesalePrice sí; interno/costo no", async () => {
    mocks.auth.mockResolvedValue(customerStore)
    mocks.prisma.product.findUnique.mockResolvedValue(productRow)
    const res = await getProduct(new NextRequest("https://app.invalid/api/products/p1"), paramsOf({ id: "p1" }))
    const json = await res.json()
    expect(json.wholesalePrice).toBe(1900)
    expectNoInternalKeys(json)
  })
})

describe("GET /api/search/pos (auth opcional)", () => {
  it("anónimo: la fila con precios internos se filtra por productDto", async () => {
    mocks.prisma.product.findMany.mockResolvedValue([productRow])
    const res = await searchPos(req("https://app.invalid/api/search/pos?q=pant"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY])
    expect(json.products[0].retailPrice).toBe(2500)
  })

  it("camino fuzzy (raw SQL): el resultado crudo también pasa por productDto", async () => {
    mocks.prisma.product.findMany.mockResolvedValue([])
    mocks.prisma.$queryRaw.mockResolvedValue([{
      id: "p2", name: "Pantalla Xiaomi", barcode: "999", stock: 2,
      retailPrice: 1500, wholesalePrice: 1100, images: [], categoryName: "Pantallas",
    }])
    const res = await searchPos(req("https://app.invalid/api/search/pos?q=pantlla"))
    const json = await res.json()
    expectNoInternalKeys(json, [WHOLESALE_KEY])
    expect(json.products[0].name).toBe("Pantalla Xiaomi")
  })

  it("CUSTOMER aliado (TECHNICIAN): wholesalePrice sale incluso por el camino fuzzy", async () => {
    mocks.auth.mockResolvedValue(customerTech)
    mocks.prisma.product.findMany.mockResolvedValue([])
    mocks.prisma.$queryRaw.mockResolvedValue([{
      id: "p2", name: "Pantalla Xiaomi", barcode: "999", stock: 2,
      retailPrice: 1500, wholesalePrice: 1100, images: [], categoryName: "Pantallas",
    }])
    const res = await searchPos(req("https://app.invalid/api/search/pos?q=pantlla"))
    const json = await res.json()
    expect(json.products[0].wholesalePrice).toBe(1100)
    expectNoInternalKeys(json)
  })
})

/* ---------------- mercado B2B ---------------- */

const marketRow = { ...productRow, marketVisibility: "ALLIES" }

describe("GET /api/marketplace (B2B)", () => {
  it("niega anónimos y CUSTOMER antes de leer la base", async () => {
    for (const session of [anonymous, customer, customerStore]) {
      mocks.auth.mockResolvedValue(session)
      const res = await marketplaceCatalog(req("https://app.invalid/api/marketplace"))
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.product.findMany).not.toHaveBeenCalled()
  })

  it("WORKSHOP: ve wholesalePrice (es aliado autorizado) pero nunca interno/costo", async () => {
    mocks.auth.mockResolvedValue(workshop)
    mocks.prisma.product.findMany.mockResolvedValue([marketRow])
    mocks.prisma.product.groupBy.mockResolvedValue([{ marketVisibility: "ALLIES", _count: { _all: 1 } }])
    const res = await marketplaceCatalog(req("https://app.invalid/api/marketplace"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.products[0].wholesalePrice).toBe(1900)
    expectNoInternalKeys(json)
    // El taller solo recibe niveles ALLIES|PUBLIC — nunca HIDDEN.
    expect(mocks.prisma.product.findMany.mock.calls[0][0].where.marketVisibility).toEqual({ in: ["ALLIES", "PUBLIC"] })
    // Contrato del select: el precio aliado se pide, los internos jamás.
    const select = mocks.prisma.product.findMany.mock.calls[0][0].select
    for (const key of INTERNAL_KEYS) expect(select).not.toHaveProperty(key)
  })

  it("staff (EMPLOYEE): catálogo completo sin filtro de visibilidad, sin costo/interno", async () => {
    mocks.auth.mockResolvedValue(employee)
    mocks.prisma.product.findMany.mockResolvedValue([marketRow])
    mocks.prisma.product.groupBy.mockResolvedValue([])
    const res = await marketplaceCatalog(req("https://app.invalid/api/marketplace"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json)
    expect(mocks.prisma.product.findMany.mock.calls[0][0].where).not.toHaveProperty("marketVisibility")
  })
})

describe("GET /api/marketplace/requests", () => {
  const requestRow = {
    id: "r1", status: "PENDING", qty: 2, tallerName: "Taller W",
    createdAt: new Date(), decidedAt: null, decisionNote: null, note: null,
    contactName: null, contactPhone: null, businessId: BIZ,
    product: { name: "Pantalla iPhone 15", barcode: "750123456", wholesalePrice: 1900, retailPrice: 2500 },
    business: { id: "biz-9", name: "Proveedor", slug: "prov" },
    requestedBy: { id: "w1", name: "W", role: "WORKSHOP" },
    decidedBy: null, sale: null,
  }

  it("niega anónimos y CUSTOMER", async () => {
    for (const session of [anonymous, customer]) {
      mocks.auth.mockResolvedValue(session)
      const res = await marketplaceRequests(req("https://app.invalid/api/marketplace/requests"))
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.marketplaceRequest.findMany).not.toHaveBeenCalled()
  })

  it("WORKSHOP: solo sus solicitudes; wholesale visible, interno/costo jamás en el include", async () => {
    mocks.auth.mockResolvedValue(workshop)
    mocks.prisma.marketplaceRequest.findMany.mockResolvedValue([requestRow])
    const res = await marketplaceRequests(req("https://app.invalid/api/marketplace/requests"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.requests[0].product.wholesalePrice).toBe(1900)
    expectNoInternalKeys(json)
    // El where limita al solicitante — un taller no ve pedidos de otros.
    expect(mocks.prisma.marketplaceRequest.findMany.mock.calls[0][0].where.requestedById).toBe("w1")
    // Contrato del include compartido por GET/PATCH/POST de solicitudes.
    const productSelect = mocks.prisma.marketplaceRequest.findMany.mock.calls[0][0].include.product.select
    for (const key of INTERNAL_KEYS) expect(productSelect).not.toHaveProperty(key)
  })
})

describe("GET /api/marketplace/purchases", () => {
  it("niega anónimos y CUSTOMER", async () => {
    for (const session of [anonymous, customer]) {
      mocks.auth.mockResolvedValue(session)
      const res = await marketplacePurchases()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.marketplaceRequest.findMany).not.toHaveBeenCalled()
  })

  it("WORKSHOP: montos de venta a mayoreo, sin costos internos", async () => {
    mocks.auth.mockResolvedValue(workshop)
    mocks.prisma.marketplaceRequest.findMany.mockResolvedValue([{
      id: "r9", tallerName: "Taller W", createdAt: new Date(), decidedAt: new Date(),
      sale: {
        id: "s1", number: 7, status: "PAID", total: 3800, createdAt: new Date(),
        items: [{ id: "i1", quantity: 2, unitPrice: 1900, totalPrice: 3800, product: { name: "Pantalla", barcode: "750" } }],
        payments: [{ id: "pay1", method: "EFECTIVO", amount: 3800, status: "CONFIRMED", createdAt: new Date() }],
      },
    }])
    mocks.prisma.user.findUnique.mockResolvedValue({ creditBalance: 0, creditLimit: null })
    const res = await marketplacePurchases()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.purchases[0].sale.items[0].unitPrice).toBe(1900)
    expectNoInternalKeys(json)
    expect(mocks.prisma.marketplaceRequest.findMany.mock.calls[0][0].where.requestedById).toBe("w1")
  })
})

describe("GET /api/marketplace/sugerencias", () => {
  it("niega anónimos y CUSTOMER", async () => {
    for (const session of [anonymous, customer]) {
      mocks.auth.mockResolvedValue(session)
      const res = await marketplaceSugerencias(req("https://app.invalid/api/marketplace/sugerencias?q=pa"))
      expect([401, 403]).toContain(res.status)
    }
  })

  it("WORKSHOP: wholesalePrice sí; interno/costo jamás (select fijado)", async () => {
    mocks.auth.mockResolvedValue(workshop)
    mocks.prisma.product.findMany.mockResolvedValue([{
      id: "p9", name: "Pantalla X", retailPrice: 1500, wholesalePrice: 1100,
      stock: 3, marketVisibility: "ALLIES",
      business: { id: "biz-9", name: "Proveedor", slug: "prov" },
      stocks: [{ branch: { name: "Centro", isActive: true } }],
      // Veneno: si el handler serializara más de lo seleccionado, aparece.
      internalPrice: 900, costPrice: 800,
    }])
    const res = await marketplaceSugerencias(req("https://app.invalid/api/marketplace/sugerencias?q=pa"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.suggestions[0].wholesalePrice).toBe(1100)
    expectNoInternalKeys(json)
    const select = mocks.prisma.product.findMany.mock.calls[0][0].select
    for (const key of INTERNAL_KEYS) expect(select).not.toHaveProperty(key)
  })
})

/* ---------------- superficies staff-only ---------------- */

describe("GET /api/encargos (módulo inventario)", () => {
  it("niega anónimos, CUSTOMER y WORKSHOP sin tocar la base", async () => {
    for (const session of [anonymous, customer, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await encargosList(new NextRequest("https://app.invalid/api/encargos"))
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.encargo.findMany).not.toHaveBeenCalled()
  })
})

describe("/api/part-requests", () => {
  it("POST público responde solo {ok:true} — anti-enumeración", async () => {
    mocks.prisma.partRequest.create.mockResolvedValue({ id: "pr1" })
    const res = await createPartRequest(
      req("https://app.invalid/api/part-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Batería iPhone 12", phone: "8112345678" }),
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json).toEqual({ ok: true })
    expectNoInternalKeys(json, [WHOLESALE_KEY])
  })

  it("GET niega anónimos, CUSTOMER y WORKSHOP (feed interno)", async () => {
    for (const session of [anonymous, customer, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await listPartRequests(new Request("https://app.invalid/api/part-requests"))
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.partRequest.findMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/reservations (CUSTOMER solo ve lo suyo)", () => {
  it("filtra por userId y el producto no lleva NINGÚN precio", async () => {
    mocks.auth.mockResolvedValue(customer)
    mocks.prisma.reservation.findMany.mockResolvedValue([{
      id: "res1", status: "PENDING", type: "DEPOSIT", quantity: 1, depositAmount: 500,
      expiresAt: null, createdAt: new Date(),
      product: {
        id: "p1", name: "Pantalla", images: [], category: { name: "Pantallas" },
        models: [{ model: { name: "iPhone 15", brand: { name: "Apple" } } }],
      },
      user: { id: "c1", name: "Ana", phone: "8112345678", customerType: "NORMAL" },
    }])
    mocks.prisma.reservation.count.mockResolvedValue(1)
    const res = await reservationsGet(req("https://app.invalid/api/reservations"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(mocks.prisma.reservation.findMany.mock.calls[0][0].where.userId).toBe("c1")
    expectNoInternalKeys(json, [WHOLESALE_KEY, "retailPrice"])
    // Contrato del include: el producto ligado jamás trae campos de precio.
    const productSelect = mocks.prisma.reservation.findMany.mock.calls[0][0].include.product.select
    for (const key of [...INTERNAL_KEYS, WHOLESALE_KEY, "retailPrice"]) {
      expect(productSelect).not.toHaveProperty(key)
    }
  })
})

/* ---------------- enlaces públicos por token ---------------- */

const future = new Date(Date.now() + 86400_000)

describe("GET /api/cotizacion/[token] (público por token)", () => {
  const order = {
    number: 7, businessId: BIZ, business: { isActive: true },
    status: "WAITING_APPROVAL", customerName: "Ana", equipmentType: "Celular",
    brand: "Apple", model: "iPhone 15", equipmentColor: null,
    reportedIssue: "Cambio de pantalla · No enciende", serviceName: "Cambio de pantalla",
    diagnosis: null, quoteCents: 50000, approvedQuoteCents: null,
    quoteApprovedAt: null, quoteExpiresAt: future, createdAt: new Date(),
    parts: [{ description: "Pantalla", qty: 1, unitPriceCents: 15000 }],
    events: [{ createdAt: new Date() }],
  }

  it("desglosa unitPriceCents pero JAMÁS unitCostCents (select fijado)", async () => {
    mocks.prisma.repairOrder.findUnique.mockResolvedValue(order)
    mocks.prisma.workshopService.findMany.mockResolvedValue([])
    mocks.prisma.deviceModel.findMany.mockResolvedValue([])
    const res = await quoteGet(req("https://app.invalid/api/cotizacion/tok"), paramsOf({ token: "tok" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.quote.parts[0].unitPriceCents).toBe(15000)
    expectNoInternalKeys(json)
    const select = mocks.prisma.repairOrder.findUnique.mock.calls[0][0].select
    expect(select.parts.select).toMatchObject({ unitPriceCents: true })
    expect(select.parts.select).not.toHaveProperty("unitCostCents")
    for (const key of ["deviceAccessValue", "customerPhone", "location", "uploadToken", "quoteToken"]) {
      expect(select).not.toHaveProperty(key)
    }
  })
})

describe("POST /api/cotizacion/[token]/approve (público por token)", () => {
  it("la respuesta es mínima aunque el tx lea unitCostCents internamente", async () => {
    mocks.prisma.repairOrder.findUnique.mockResolvedValue({
      id: "o1", number: 7, version: 1, status: "WAITING_APPROVAL", businessId: BIZ,
      quoteCents: 50000, approvedQuoteCents: null, quoteApprovedAt: null,
      quoteExpiresAt: future, createdAt: new Date(), createdById: "e1",
      equipmentType: "Celular", brand: "Apple", model: "iPhone 15",
      business: { isActive: true }, events: [{ createdAt: new Date() }],
      // Veneno: el total de refacciones se calcula con costo+precio interno;
      // la respuesta pública no debe reflejar ninguno.
      parts: [{ qty: 1, unitCostCents: 9000, unitPriceCents: 15000, status: "APPROVED" }],
    })
    mocks.prisma.repairOrder.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.repairEvent.findFirst.mockResolvedValue(null)
    mocks.prisma.repairEvent.create.mockResolvedValue({})
    const res = await quoteApprove(
      req("https://app.invalid/api/cotizacion/tok/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVE", expectedLaborCents: 50000, expectedPartsCents: 15000 }),
      }),
      paramsOf({ token: "tok" }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, decision: "APPROVED" })
    expectNoInternalKeys(json)
  })
})

describe("GET /api/cuenta/[token] (público por token)", () => {
  it("estado de cuenta mapeado a DTO: sin ids internos ni datos de otros", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "c1", name: "Ana", creditBalance: 900, creditLimit: 5000,
      statementTokenExpiresAt: future,
      business: { name: "Taller Uno", isActive: true },
      // Veneno: si se serializara la fila completa estos campos saldrían.
      email: "ana@x.com", phone: "8112345678", businessId: BIZ, role: "CUSTOMER",
    })
    mocks.prisma.creditMovement.findMany.mockResolvedValue([
      { type: "DEBT", amount: 1200, notes: "Venta V-000003", createdAt: new Date() },
    ])
    mocks.prisma.sale.findMany.mockResolvedValue([
      { number: 3, total: 900, expiresAt: null, createdAt: new Date(), payments: [{ amount: 300 }] },
    ])
    const res = await cuentaGet(req("https://app.invalid/api/cuenta/tok"), paramsOf({ token: "tok" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expectNoInternalKeys(json, [WHOLESALE_KEY, "businessId", "email", "phone", "role", "statementToken"])
    expect(json.statement.layaways[0]).toMatchObject({ folio: "V-000003", balance: 600 })
  })
})

describe("GET /api/evidencia/[token] (público por token)", () => {
  it("solo folio y fotos — nunca datos internos de la orden", async () => {
    mocks.prisma.repairOrder.findUnique.mockResolvedValue({
      number: 9, businessId: BIZ, uploadTokenExpiresAt: future,
      business: { isActive: true },
      photos: [{ id: "ph1", label: "frente", createdAt: new Date() }],
      // Veneno: la hoja interna no debe colarse.
      customerPhone: "8112345678", quoteCents: 50000, deviceAccessValue: "1234",
    })
    const res = await evidenciaGet(req("https://app.invalid/api/evidencia/tok"), paramsOf({ token: "tok" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.folio).toBe("OT-000009")
    expectNoInternalKeys(json, ["customerPhone", "quoteCents", "deviceAccessValue", "uploadToken", "businessId"])
    const select = mocks.prisma.repairOrder.findUnique.mock.calls[0][0].select
    for (const key of ["customerPhone", "quoteCents", "deviceAccessValue", "signatureData"]) {
      expect(select).not.toHaveProperty(key)
    }
  })
})

describe("GET /api/seguimiento (folio + 4 dígitos del teléfono)", () => {
  it("lee unitCostCents para calcular pero NUNCA lo devuelve; eventos solo isPublic", async () => {
    mocks.prisma.repairOrder.findUnique.mockResolvedValue({
      number: 5, businessId: BIZ, status: "IN_REPAIR",
      customerPhone: "+52 8112345678", customerName: "Ana",
      equipmentType: "Celular", brand: "Apple", model: "iPhone 15",
      reportedIssue: "No enciende", serviceName: "Diagnóstico",
      promisedAt: null, createdAt: new Date(),
      quoteCents: 50000, approvedQuoteCents: 50000, diagnosticFeeCents: null,
      closedWithoutRepair: false, warrantyUntil: null, quoteToken: "qtok",
      currentBranch: { name: "Centro" },
      events: [
        { id: "ev1", type: "STATUS", detail: "En reparación → Diagnóstico.", isPublic: true, createdAt: new Date() },
        { id: "ev2", type: "NOTE", detail: "Costo interno refacción 9000", isPublic: false, createdAt: new Date() },
      ],
      photos: [{ id: "ph1", label: "frente", createdAt: new Date() }],
      payments: [{ amount: 200, status: "CONFIRMED" }],
      // Veneno: la fila lleva el costo real; la respuesta lo descarta.
      parts: [{ qty: 1, unitCostCents: 9000, unitPriceCents: 15000, status: "APPROVED" }],
      business: { name: "Taller Uno", phone: "8122334455", isActive: true },
    })
    const res = await seguimientoGet(req("https://app.invalid/api/seguimiento?folio=5&phone=5678"))
    const json = await res.json()
    expect(res.status).toBe(200)
    // Mano de obra autorizada + refacción aprobada (precio al cliente, no costo).
    expect(json.order.authorizedCents).toBe(65000)
    expect(json.order.paidCents).toBe(20000)
    expectNoInternalKeys(json, ["customerPhone", "customerName", "quoteCents", "businessId", "parts"])
    expect(json.order.events).toHaveLength(1) // la nota interna isPublic:false queda fuera
    expect(json.order.events[0].detail).not.toContain("9000")
  })

  it("404 genérico cuando el teléfono no coincide — no revela que el folio existe", async () => {
    mocks.prisma.repairOrder.findUnique.mockResolvedValue({
      number: 5, businessId: BIZ, status: "IN_REPAIR", customerPhone: "8112345678",
      business: { isActive: true },
    })
    const res = await seguimientoGet(req("https://app.invalid/api/seguimiento?folio=5&phone=0000"))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "No encontramos una orden con esos datos." })
  })
})

/* ---------------- filtraciones corregidas ---------------- */

describe("PUT /api/products/[id] (staff inventario)", () => {
  const existing = {
    id: "p1", businessId: BIZ, name: "Pantalla iPhone 15", description: "OLED",
    barcode: "750123456", retailPrice: 1200, wholesalePrice: 1900,
    internalPrice: null, costPrice: 900, stock: 4, minStock: 1,
    images: [], isUniversal: true, isActive: true, marketVisibility: "HIDDEN",
    categoryId: "cat-1", createdAt: new Date(), updatedAt: new Date(),
  }
  const body = (over: Record<string, unknown> = {}) => ({
    name: "Pantalla iPhone 15", retailPrice: "1500", wholesalePrice: "1900",
    internalPrice: "1600", costPrice: "5", categoryId: "cat-1",
    isUniversal: true, isActive: true, marketVisibility: "ALLIES",
    barcode: "750123456", ...over,
  })
  const put = () => updateProduct(
    new NextRequest("https://app.invalid/api/products/p1", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()),
    }),
    paramsOf({ id: "p1" }),
  )
  const seedPut = () => {
    mocks.prisma.category.findFirst.mockResolvedValue({ id: "cat-1" })
    mocks.prisma.product.findUnique.mockResolvedValue(existing)
    mocks.prisma.product.findFirst.mockResolvedValue(null) // barcode libre
    mocks.prisma.user.findUnique.mockResolvedValue({ homeBranchId: "b1" })
    mocks.prisma.product.findMany.mockResolvedValue([]) // syncLowStockAlerts
    mocks.prisma.product.update.mockImplementation(({ data }: any) => ({
      ...existing, ...data,
      models: [], category: { id: "cat-1", name: "Pantallas", businessId: BIZ },
    }))
  }

  it("EMPLOYEE: la respuesta pasa por productDto — NUNCA costPrice", async () => {
    mocks.auth.mockResolvedValue(employee)
    seedPut()
    const res = await put()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).not.toHaveProperty("costPrice")
    expect(json).not.toHaveProperty("businessId")
    expect(keyPaths(json, ["costPrice", "unitCostCents"])).toEqual([])
    // Contrato staff: mayoreo e interno sí viajan.
    expect(json.wholesalePrice).toBe(1900)
    expect(json.internalPrice).toBe(1600)
    // El empleado no puede fijar costo ni visibilidad: el update conserva los
    // valores existentes aunque el body traiga otros.
    const data = mocks.prisma.product.update.mock.calls[0][0].data
    expect(data.costPrice).toBe(900)
    expect(data.marketVisibility).toBe("HIDDEN")
  })

  it("ADMIN: ve costPrice y sí puede fijar costo/visibilidad", async () => {
    mocks.auth.mockResolvedValue(admin)
    seedPut()
    const res = await put()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.costPrice).toBe(5) // el dueño sí manda el costo
    const data = mocks.prisma.product.update.mock.calls[0][0].data
    expect(data.costPrice).toBe(5)
    expect(data.marketVisibility).toBe("ALLIES")
  })

  it("niega anónimos, CUSTOMER y WORKSHOP", async () => {
    for (const session of [anonymous, customer, workshop]) {
      mocks.auth.mockResolvedValue(session)
      const res = await put()
      expect([401, 403]).toContain(res.status)
    }
    expect(mocks.prisma.product.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/settings", () => {
  const settingsRow = {
    id: "s1", businessId: BIZ, tempReservationMinutes: 30, depositPercentage: 50,
    depositReservationHours: 48, pendingVerificationHours: 24, exchangeRate: 17.5,
    bankCashEnabled: true, createdAt: new Date(), updatedAt: new Date(),
  }
  const seedSettings = () => {
    mocks.prisma.settings.findFirst.mockResolvedValue(settingsRow)
    mocks.prisma.systemSettings.findMany.mockResolvedValue([
      { key: "bank_transfer_info", value: "CLABE 999888777" },
      { key: "repair_partner_business_id", value: "biz-taller-aliado" },
      { key: "ticket_footer", value: "Texto interno del ticket" },
    ])
  }
  const PUBLIC_SUBSET_KEYS = [
    "tempReservationMinutes", "depositPercentage", "depositReservationHours",
    "pendingVerificationHours", "exchangeRate",
  ]
  const expectPublicSubset = (json: Record<string, unknown>) => {
    expect(Object.keys(json).sort()).toEqual([...PUBLIC_SUBSET_KEYS].sort())
    expect(json.depositPercentage).toBe(50)
  }

  it("anónimo: solo el subset de la reserva pública", async () => {
    seedSettings()
    const json = await (await settingsGet()).json()
    expectPublicSubset(json)
  })

  it.each([
    ["CUSTOMER", customer],
    ["WORKSHOP", workshop],
    ["EMPLOYEE pendiente", { user: { ...employee.user, status: "PENDING" } }],
  ])("sesión %s: recibe el subset público, JAMÁS datos bancarios", async (_label, session) => {
    mocks.auth.mockResolvedValue(session)
    seedSettings()
    const res = await settingsGet()
    const json = await res.json()
    expect(res.status).toBe(200)
    expectPublicSubset(json)
    expectNoInternalKeys(json, [
      WHOLESALE_KEY, "bankTransferInfo", "bankCashInfo", "repairPartnerBusinessId",
      "ticketBusinessName", "ticketSubtitle", "ticketFooter", "orderPrefix",
      "partnerIntakeEnabled", "saleAutoTicket", "businessId",
    ])
  })

  it.each([
    ["EMPLOYEE", employee],
    ["ADMIN", admin],
  ])("staff %s aprobado: recibe la configuración completa", async (_label, session) => {
    mocks.auth.mockResolvedValue(session)
    seedSettings()
    const json = await (await settingsGet()).json()
    expect(json.bankTransferInfo).toBe("CLABE 999888777")
    expect(json.repairPartnerBusinessId).toBe("biz-taller-aliado")
  })
})
