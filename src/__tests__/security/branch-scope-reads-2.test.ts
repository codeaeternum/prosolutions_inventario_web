import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Alcance de sucursal y módulo del EMPLOYEE — segunda pasada de lecturas.
 *
 * - /api/branches: la lista de sucursales (con conteos/cajas) se recorta a
 *   las asignadas.
 * - /api/cash-requests: ?branchId= ajena es 403 y las pendientes de la
 *   sucursal base solo entran si está asignada.
 * - /api/notifications + /api/notifications/stream: exigen el módulo
 *   notificaciones (igual que la página /admin/notificaciones).
 * - /api/supplier-payments, /api/suppliers/balances, /api/suppliers/aging:
 *   OCs y abonos ligados a ellas se recortan por sucursal.
 * - /api/users/pos: PII de clientes (teléfono, crédito) exige ventas|clientes.
 * - /api/reports: reservas, ventas, caja y taller se agregan por sucursal.
 * - /api/pos/products, /api/products, /api/marketplace: el desglose de stock
 *   por sucursal se limita a las asignadas.
 * - /api/encargos/compras: la demanda de refacciones solo cuenta órdenes de
 *   sucursales propias; ?branchId= ajena sigue siendo 403.
 * - /api/inventory/sugerencias-compra: encargos y velocidad de venta se
 *   recortan por sucursal.
 * - /api/clientes y /api/clientes/[id]: los agregados de actividad del
 *   cliente (ventas/taller/reservas/documentos) se recortan por sucursal.
 * - /api/settings/geocode: proxy de geocodificación solo para configuración.
 */

// ——— Prisma mock: Proxy que auto-crea un vi.fn() por model.method ———
const db = vi.hoisted(() => ({
  fn: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

const prismaMock = vi.hoisted(() => {
  const defaults: Record<string, unknown> = {
    findUnique: null,
    findFirst: null,
    count: 0,
    aggregate: { _sum: {}, _count: { _all: 0 } },
  }
  const cache = new Map<string, unknown>()
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, prop: string) => {
      if (prop === "$queryRaw") {
        return (db.fn.$queryRaw ??= vi.fn().mockResolvedValue([]))
      }
      if (!cache.has(prop)) {
        cache.set(prop, new Proxy({} as Record<string, unknown>, {
          get: (_t2, method: string) => {
            const key = `${prop}.${method}`
            return (db.fn[key] ??= vi.fn().mockResolvedValue(method in defaults ? defaults[method] : []))
          },
        }))
      }
      return cache.get(prop)
    },
  })
})

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findAllyOffers: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock, default: prismaMock }))
vi.mock("@/lib/domain/ally-catalog", () => ({ findAllyOffers: mocks.findAllyOffers }))

import type { NextRequest } from "next/server"
import { GET as branches } from "@/app/api/branches/route"
import { GET as cashRequests } from "@/app/api/cash-requests/route"
import { GET as notifications } from "@/app/api/notifications/route"
import { GET as notificationStream } from "@/app/api/notifications/stream/route"
import { GET as supplierPayments } from "@/app/api/supplier-payments/route"
import { GET as supplierBalances } from "@/app/api/suppliers/balances/route"
import { GET as supplierAging } from "@/app/api/suppliers/aging/route"
import { GET as posCustomers } from "@/app/api/users/pos/route"
import { GET as reports } from "@/app/api/reports/route"
import { GET as posProducts } from "@/app/api/pos/products/route"
import { GET as products } from "@/app/api/products/route"
import { GET as marketplace } from "@/app/api/marketplace/route"
import { GET as comprasNeeds } from "@/app/api/encargos/compras/route"
import { GET as sugerencias } from "@/app/api/inventory/sugerencias-compra/route"
import { GET as clientes } from "@/app/api/clientes/route"
import { GET as clienteDetail } from "@/app/api/clientes/[id]/route"
import { GET as geocode } from "@/app/api/settings/geocode/route"

const staff = (role: string, opts: { modules?: string[]; branches?: string[] } = {}) => ({
  user: {
    id: `${role.toLowerCase()}-1`, role, status: "APPROVED", businessId: "biz-test",
    customerType: "NORMAL",
    allowedModules: opts.modules ?? [], allowedBranchIds: opts.branches ?? [],
  },
})
/** Empleado asignado solo a la sucursal b1 con los módulos dados. */
const restricted = (modules: string[]) => staff("EMPLOYEE", { modules, branches: ["b1"] })
/** Empleado sin módulo alguno ni lista de sucursales (alcance total por módulos). */
const unrestricted = (modules: string[]) => staff("EMPLOYEE", { modules })

const nx = (req: Request) => req as unknown as NextRequest
const params = (id: string) => ({ params: Promise.resolve({ id }) })
/** Acceso al mock auto-generado: q("reservation.count") → vi.fn() usado por
 *  la ruta. Materializa el mock (el Proxy lo crea al primer acceso) para que
 *  exista aunque la ruta aún no lo haya llamado. */
const q = (key: string) => {
  const [model, method] = key.split(".")
  const p = prismaMock as Record<string, unknown>
  if (key === "$queryRaw") void p.$queryRaw
  else void (p[model] as Record<string, unknown>)?.[method]
  return db.fn[key]
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.findAllyOffers.mockResolvedValue(new Map())
  // Los vi.fn() del Proxy conservan sus defaults tras clearAllMocks porque
  // el default se fijó con mockResolvedValue (implementación persistente).
})

describe("GET /api/branches — lista recortada a las sucursales asignadas", () => {
  it("restringido recibe { in: allowed }; el admin conserva la lista completa", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    await branches()
    expect(q("branch.findMany").mock.calls[0][0].where.id).toEqual({ in: ["b1"] })

    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await branches()
    expect(q("branch.findMany").mock.calls[1][0].where).not.toHaveProperty("id")
  })
})

describe("GET /api/cash-requests — filtro de sucursal y pendientes de la base", () => {
  it("?branchId= ajena es 403 sin tocar la base", async () => {
    mocks.auth.mockResolvedValue(restricted(["caja"]))
    expect((await cashRequests(new Request("https://app.invalid/api/cash-requests?branchId=b2"))).status).toBe(403)
    expect(q("cashRequest.findMany")).not.toHaveBeenCalled()
  })

  it("la cláusula de pendientes por sucursal base respeta allowedBranchIds", async () => {
    // Base en b2 (fuera de las asignadas): solo se ven las solicitudes propias.
    mocks.auth.mockResolvedValue(restricted(["caja"]))
    q("user.findUnique").mockResolvedValue({ homeBranchId: "b2" })
    await cashRequests(new Request("https://app.invalid/api/cash-requests"))
    const where = q("cashRequest.findMany").mock.calls[0][0].where
    expect(where.OR).toHaveLength(1)
    expect(where.OR[0].requestedById).toBe("employee-1")

    // Base en b1 (asignada): sí entra la cláusula de pendientes de b1.
    q("cashRequest.findMany").mockClear()
    q("user.findUnique").mockResolvedValue({ homeBranchId: "b1" })
    await cashRequests(new Request("https://app.invalid/api/cash-requests"))
    const where2 = q("cashRequest.findMany").mock.calls[0][0].where
    expect(where2.OR).toHaveLength(2)
    expect(where2.OR[1]).toEqual({ status: "PENDING", branchId: "b1" })
  })
})

describe("notificaciones — el módulo gobierna historial y stream", () => {
  it("GET /api/notifications: sin módulo es 403; con él llega a la consulta", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["ventas"], branches: ["b1"] }))
    expect((await notifications()).status).toBe(403)
    expect(q("notification.findMany")).not.toHaveBeenCalled()

    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["notificaciones"], branches: ["b1"] }))
    expect((await notifications()).status).toBe(200)
    expect(q("notification.findMany")).toHaveBeenCalled()
  })

  it("GET /api/notifications/stream: sin módulo es 403 (mismo feed)", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["ventas"], branches: ["b1"] }))
    const res = await notificationStream(nx(new Request("https://app.invalid/api/notifications/stream")))
    expect(res.status).toBe(403)
    expect(q("user.findUnique")).not.toHaveBeenCalled()
  })
})

describe("saldos de proveedores — OCs y abonos recortados por sucursal", () => {
  it("GET /api/supplier-payments: abonos a OCs ajenas quedan fuera", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    await supplierPayments(nx(new Request("https://app.invalid/api/supplier-payments")))
    const where = q("supplierPayment.findMany").mock.calls[0][0].where
    expect(where.OR).toEqual([{ purchaseId: null }, { purchase: { branchId: { in: ["b1"] } } }])

    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await supplierPayments(nx(new Request("https://app.invalid/api/supplier-payments")))
    expect(q("supplierPayment.findMany").mock.calls[1][0].where).not.toHaveProperty("OR")
  })

  it("GET /api/suppliers/balances: recibido/abiertos/abonos se recortan", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    await supplierBalances()
    expect(q("purchase.groupBy").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("purchase.findMany").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("supplierPayment.groupBy").mock.calls[0][0].where.OR)
      .toEqual([{ purchaseId: null }, { purchase: { branchId: { in: ["b1"] } } }])
  })

  it("GET /api/suppliers/aging: OCs y abonos se recortan", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    await supplierAging()
    expect(q("purchase.findMany").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("supplierPayment.findMany").mock.calls[0][0].where.OR)
      .toEqual([{ purchaseId: null }, { purchase: { branchId: { in: ["b1"] } } }])
  })
})

describe("GET /api/users/pos — PII de clientes exige ventas|clientes", () => {
  it("staff sin esos módulos es 403; con ventas lista clientes", async () => {
    mocks.auth.mockResolvedValue(unrestricted(["caja"]))
    expect((await posCustomers(new Request("https://app.invalid/api/users/pos?search=ana"))).status).toBe(403)
    expect(q("user.findMany")).not.toHaveBeenCalled()

    mocks.auth.mockResolvedValue(unrestricted(["ventas"]))
    expect((await posCustomers(new Request("https://app.invalid/api/users/pos?search=ana"))).status).toBe(200)
    expect(q("user.findMany")).toHaveBeenCalled()
  })
})

describe("GET /api/reports — agregados recortados por sucursal", () => {
  it("reservas (conteo, estados, recientes) y top clientes quedan en { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["reportes"]))
    await reports(nx(new Request("https://app.invalid/api/reports")))
    expect(q("reservation.count").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("reservation.groupBy").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("reservation.findMany").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    // Top clientes: el _count de reservas COMPLETED también se recorta.
    const clientsCall = q("user.findMany").mock.calls[0][0]
    expect(clientsCall.select._count.select.reservations.where.branchId).toEqual({ in: ["b1"] })
  })

  it("?series=1: ventas, caja, cobros de taller y órdenes se recortan", async () => {
    mocks.auth.mockResolvedValue(restricted(["reportes"]))
    await reports(nx(new Request("https://app.invalid/api/reports?series=1")))
    expect(q("sale.findMany").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("cashMovement.findMany").mock.calls[0][0].where.register).toEqual({ branchId: { in: ["b1"] } })
    expect(q("payment.findMany").mock.calls[0][0].where.repairOrder).toEqual({ currentBranchId: { in: ["b1"] } })
    expect(q("repairOrder.groupBy").mock.calls[0][0].where.currentBranchId).toEqual({ in: ["b1"] })
    expect(q("repairPart.findMany").mock.calls[0][0].where.order).toEqual({ currentBranchId: { in: ["b1"] } })
  })

  it("admin conserva el reporte global", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await reports(nx(new Request("https://app.invalid/api/reports")))
    expect(q("reservation.count").mock.calls[0][0].where).not.toHaveProperty("branchId")
  })
})

describe("GET /api/pos/products — overlay de stock del staff", () => {
  beforeEach(() => {
    q("product.findMany").mockResolvedValue([
      { id: "p1", name: "Pantalla", barcode: "BC1", stock: 99, retailPrice: 100, wholesalePrice: 80, images: [], categoryId: "c1", category: { name: "Pantallas" }, models: [] },
    ])
  })

  it("restringido sin ?branchId= suma solo sus sucursales; ajena es 403", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    expect((await posProducts(new Request("https://app.invalid/api/pos/products?branchId=b2"))).status).toBe(403)
    expect(q("branchStock.findMany")).not.toHaveBeenCalled()

    q("branchStock.findMany").mockResolvedValue([{ productId: "p1", quantity: 3 }])
    const res = await posProducts(new Request("https://app.invalid/api/pos/products"))
    expect(res.status).toBe(200)
    expect(q("branchStock.findMany").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    const { products: list } = await res.json()
    expect(list[0].stock).toBe(3) // 3 en b1, no el total global (99)
  })

  it("admin sin ?branchId= conserva el stock global sin overlay", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    const res = await posProducts(new Request("https://app.invalid/api/pos/products"))
    expect(res.status).toBe(200)
    expect(q("branchStock.findMany")).not.toHaveBeenCalled()
  })
})

describe("GET /api/products — desglose de stock por sucursal recortado", () => {
  it("empleado restringido: include.stocks solo de sus sucursales", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    await products(new Request("https://app.invalid/api/products"))
    const stocksWhere = q("product.findMany").mock.calls[0][0].include.stocks.where
    expect(stocksWhere.branchId).toEqual({ in: ["b1"] })
  })

  it("admin ve el desglose completo y el público no recibe stocks", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await products(new Request("https://app.invalid/api/products"))
    const adminStocks = q("product.findMany").mock.calls[0][0].include.stocks.where
    expect(adminStocks).toEqual({ businessId: "biz-test" })

    mocks.auth.mockResolvedValue(null)
    await products(new Request("https://app.invalid/api/products"))
    const publicInclude = q("product.findMany").mock.calls[1][0].include
    expect(publicInclude).not.toHaveProperty("stocks")
  })
})

describe("GET /api/marketplace — existencias por sucursal del staff", () => {
  beforeEach(() => {
    // Las implementaciones persisten entre describes (mockClear no las quita):
    // se restaura la fila vacía de productos para que el map de la ruta no
    // choque con el renglón del describe de pos/products.
    q("product.findMany").mockResolvedValue([])
    q("product.groupBy").mockResolvedValue([])
  })

  it("empleado restringido: branches[] solo de sus sucursales", async () => {
    mocks.auth.mockResolvedValue(restricted(["mercado"]))
    await marketplace(new Request("https://app.invalid/api/marketplace"))
    const stocksWhere = q("product.findMany").mock.calls[0][0].select.stocks.where
    expect(stocksWhere.branchId).toEqual({ in: ["b1"] })
  })

  it("WORKSHOP aliado conserva todas las sucursales (necesita la de recogida)", async () => {
    mocks.auth.mockResolvedValue(staff("WORKSHOP"))
    await marketplace(new Request("https://app.invalid/api/marketplace"))
    const stocksWhere = q("product.findMany").mock.calls[0][0].select.stocks.where
    expect(stocksWhere).toEqual({ businessId: "biz-test" })
  })
})

describe("GET /api/encargos/compras — demanda recortada a órdenes propias", () => {
  it("?branchId= ajena es 403; sin filtro la demanda cuenta solo { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    expect((await comprasNeeds(nx(new Request("https://app.invalid/api/encargos/compras?branchId=b2")))).status).toBe(403)
    expect(q("repairPart.findMany")).not.toHaveBeenCalled()

    await comprasNeeds(nx(new Request("https://app.invalid/api/encargos/compras")))
    expect(q("repairPart.findMany").mock.calls[0][0].where.order.currentBranchId).toEqual({ in: ["b1"] })
  })

  it("admin conserva la demanda consolidada del negocio", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await comprasNeeds(nx(new Request("https://app.invalid/api/encargos/compras")))
    expect(q("repairPart.findMany").mock.calls[0][0].where.order).not.toHaveProperty("currentBranchId")
  })
})

describe("GET /api/inventory/sugerencias-compra — señales recortadas", () => {
  it("encargos pendientes y velocidad de venta quedan en { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    await sugerencias()
    expect(q("encargo.groupBy").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("saleItem.groupBy").mock.calls[0][0].where.sale.branchId).toEqual({ in: ["b1"] })
  })

  it("empleado sin restricción agrega el negocio completo", async () => {
    mocks.auth.mockResolvedValue(unrestricted(["inventario"]))
    await sugerencias()
    expect(q("encargo.groupBy").mock.calls[0][0].where).not.toHaveProperty("branchId")
  })
})

describe("clientes — agregados de actividad por sucursal", () => {
  it("GET /api/clientes: conteos de reservas/ventas/taller en { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["clientes"]))
    await clientes(new Request("https://app.invalid/api/clientes"))
    const include = q("user.findMany").mock.calls[0][0].select._count.select
    expect(include.reservations.where.branchId).toEqual({ in: ["b1"] })
    expect(include.salesAsCustomer.where.branchId).toEqual({ in: ["b1"] })
    expect(q("repairOrder.groupBy").mock.calls[0][0].where.currentBranchId).toEqual({ in: ["b1"] })
  })

  it("GET /api/clientes/[id]: ventas, reservas y documentos en { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["clientes"]))
    q("user.findFirst").mockResolvedValue({ id: "c1", name: "Ana", phone: "5512345678", role: "CUSTOMER" })
    await clienteDetail(nx(new Request("https://app.invalid/api/clientes/c1")), params("c1"))
    // Ventas del historial y documentos vivos (apartados/cotizaciones).
    const saleCalls = q("sale.findMany").mock.calls.map(c => c[0].where)
    for (const where of saleCalls) expect(where.branchId).toEqual({ in: ["b1"] })
    expect(q("sale.aggregate").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("reservation.findMany").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(q("reservation.count").mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    // El empalme histórico por teléfono también se recorta (SQL con IN).
    expect(q("$queryRaw")).toHaveBeenCalled()
  })

  it("admin conserva la ficha completa", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    q("user.findFirst").mockResolvedValue({ id: "c1", name: "Ana", phone: null, role: "CUSTOMER" })
    await clienteDetail(nx(new Request("https://app.invalid/api/clientes/c1")), params("c1"))
    expect(q("sale.findMany").mock.calls[0][0].where).not.toHaveProperty("branchId")
  })
})

describe("GET /api/settings/geocode — solo módulo configuración", () => {
  it("staff sin configuración es 403 antes de llamar a Nominatim", async () => {
    mocks.auth.mockResolvedValue(unrestricted(["ventas"]))
    const res = await geocode(new Request("https://app.invalid/api/settings/geocode?q=guadalajara"))
    expect(res.status).toBe(403)
  })
})
