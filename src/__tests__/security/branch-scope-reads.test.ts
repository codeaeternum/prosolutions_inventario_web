import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Alcance de sucursal del EMPLOYEE con allowedBranchIds — rutas de lectura.
 *
 * - Listados sin ?branchId= se recortan a las sucursales asignadas
 *   ({ in: allowedBranchIds }); con ?branchId= ajena responden 403.
 * - Detalles (venta, reserva, verify) validan la sucursal del documento tras
 *   cargarlo.
 * - /api/inventory/stock: la matriz exige módulo inventario; ?productId= queda
 *   para taller|inventario y en ambos modos el desglose por sucursal se recorta.
 * - /api/inventory: product.costPrice solo llega al ADMIN (revela margen).
 * - /api/search/pos: el overlay de stock del staff se limita a sus sucursales.
 * - /api/settings: bankTransferInfo/bankCashInfo solo para ADMIN o el módulo
 *   configuración.
 */

const tx = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  reservation: { findUnique: vi.fn() },
}))

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  productFindMany: vi.fn(),
  productFindFirst: vi.fn(),
  branchFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  branchStockFindMany: vi.fn(),
  repairOrderFindMany: vi.fn(),
  repairOrderCount: vi.fn(),
  paymentGroupBy: vi.fn(),
  userFindMany: vi.fn(),
  systemSettingsFindUnique: vi.fn(),
  systemSettingsFindMany: vi.fn(),
  saleFindUnique: vi.fn(),
  saleFindMany: vi.fn(),
  saleCount: vi.fn(),
  inventoryMovementFindMany: vi.fn(),
  inventoryMovementCount: vi.fn(),
  inventoryMovementGroupBy: vi.fn(),
  inventoryMovementAggregate: vi.fn(),
  reservationFindMany: vi.fn(),
  reservationCount: vi.fn(),
  reservationFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  encargoFindMany: vi.fn(),
  encargoCount: vi.fn(),
  purchaseFindMany: vi.fn(),
  settingsFindFirst: vi.fn(),
  businessFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => {
  const client = {
    product: { findMany: mocks.productFindMany, findFirst: mocks.productFindFirst },
    branch: { findMany: mocks.branchFindMany },
    category: { findMany: mocks.categoryFindMany },
    branchStock: { findMany: mocks.branchStockFindMany },
    repairOrder: { findMany: mocks.repairOrderFindMany, count: mocks.repairOrderCount },
    payment: { groupBy: mocks.paymentGroupBy },
    user: { findMany: mocks.userFindMany, findUnique: vi.fn() },
    systemSettings: { findUnique: mocks.systemSettingsFindUnique, findMany: mocks.systemSettingsFindMany },
    sale: { findUnique: mocks.saleFindUnique, findMany: mocks.saleFindMany, count: mocks.saleCount },
    inventoryMovement: {
      findMany: mocks.inventoryMovementFindMany,
      count: mocks.inventoryMovementCount,
      groupBy: mocks.inventoryMovementGroupBy,
      aggregate: mocks.inventoryMovementAggregate,
    },
    reservation: {
      findMany: mocks.reservationFindMany,
      count: mocks.reservationCount,
      findUnique: mocks.reservationFindUnique,
      findFirst: mocks.reservationFindFirst,
    },
    encargo: { findMany: mocks.encargoFindMany, count: mocks.encargoCount },
    purchase: { findMany: mocks.purchaseFindMany },
    settings: { findFirst: mocks.settingsFindFirst },
    business: { findFirst: mocks.businessFindFirst },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  }
  return { prisma: client, default: client }
})

import type { NextRequest } from "next/server"
import { GET as stockMatrix } from "@/app/api/inventory/stock/route"
import { GET as workshopList } from "@/app/api/workshop/route"
import { GET as saleDetail } from "@/app/api/sales/[id]/route"
import { GET as movements } from "@/app/api/inventory/route"
import { GET as pedidos } from "@/app/api/pedidos/route"
import { GET as purchases } from "@/app/api/purchases/route"
import { GET as reservations } from "@/app/api/reservations/route"
import { GET as reservationDetail } from "@/app/api/reservations/[id]/route"
import { GET as verifyLookup, POST as verifyDeliver } from "@/app/api/reservations/verify/route"
import { GET as posSearch } from "@/app/api/search/pos/route"
import { GET as settings } from "@/app/api/settings/route"

const staff = (role: string, opts: { modules?: string[]; branches?: string[] } = {}) => ({
  user: {
    id: `${role.toLowerCase()}-1`, role, status: "APPROVED", businessId: "biz-test",
    customerType: "NORMAL",
    allowedModules: opts.modules ?? [], allowedBranchIds: opts.branches ?? [],
  },
})
/** Empleado asignado solo a la sucursal b1 con los módulos dados. */
const restricted = (modules: string[]) => staff("EMPLOYEE", { modules, branches: ["b1"] })

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
/** Las rutas con NextRequest reciben el Request del test casteado (solo se lee .url). */
const nx = (req: Request) => req as unknown as NextRequest

const saleRow = (id: string, branchId: string) => ({
  id, businessId: "biz-test", branchId, number: 1, status: "COMPLETED", kind: "RETAIL", total: 100,
  branch: { id: branchId, name: "Suc" }, seller: { id: "u", name: "Cajero" }, customer: null,
  items: [], payments: [], createdAt: new Date(),
})
const reservationRow = (id: string, branchId: string | null) => ({
  id, businessId: "biz-test", userId: "customer-9", productId: "p1", quantity: 1,
  status: "PENDING", type: "TEMPORARY", totalPrice: 100, paymentMethod: "STORE",
  depositPaid: false, depositAmount: null, branchId, qrCode: "qr-" + id,
  expiresAt: new Date(Date.now() + 3600000), adminNotes: null, createdAt: new Date(),
})
const purchaseRow = (id: string, branchId: string) => ({
  id, businessId: "biz-test", branchId, number: 1, status: "ORDERED",
  supplier: null, branch: { id: branchId, name: "Suc" }, createdBy: { id: "u", name: "U" },
  items: [], supplierPayments: [], createdAt: new Date(),
})
const productRow = (id: string) => ({
  id, name: `Producto ${id}`, barcode: `BC-${id}`, stock: 99, retailPrice: 100, wholesalePrice: 80,
  images: [], category: { name: "Pantallas" }, models: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.productFindMany.mockResolvedValue([])
  mocks.productFindFirst.mockResolvedValue(null)
  mocks.branchFindMany.mockResolvedValue([])
  mocks.categoryFindMany.mockResolvedValue([])
  mocks.branchStockFindMany.mockResolvedValue([])
  mocks.repairOrderFindMany.mockResolvedValue([])
  mocks.repairOrderCount.mockResolvedValue(0)
  mocks.paymentGroupBy.mockResolvedValue([])
  mocks.userFindMany.mockResolvedValue([])
  mocks.systemSettingsFindUnique.mockResolvedValue(null)
  mocks.systemSettingsFindMany.mockResolvedValue([])
  mocks.saleFindUnique.mockResolvedValue(null)
  mocks.saleFindMany.mockResolvedValue([])
  mocks.saleCount.mockResolvedValue(0)
  mocks.inventoryMovementFindMany.mockResolvedValue([])
  mocks.inventoryMovementCount.mockResolvedValue(0)
  mocks.inventoryMovementGroupBy.mockResolvedValue([])
  mocks.inventoryMovementAggregate.mockResolvedValue({ _sum: { quantity: 0 } })
  mocks.reservationFindMany.mockResolvedValue([])
  mocks.reservationCount.mockResolvedValue(0)
  mocks.reservationFindUnique.mockResolvedValue(null)
  mocks.reservationFindFirst.mockResolvedValue(null)
  mocks.encargoFindMany.mockResolvedValue([])
  mocks.encargoCount.mockResolvedValue(0)
  mocks.purchaseFindMany.mockResolvedValue([])
  mocks.settingsFindFirst.mockResolvedValue(null)
  mocks.businessFindFirst.mockResolvedValue({ id: "biz-test" })
  mocks.queryRaw.mockResolvedValue([])
  // Tx falso: pasa el assert de sucursal y el dominio no encuentra la reserva
  // → 404 controlado que demuestra que se llegó al dominio.
  tx.user.findUnique.mockResolvedValue({ id: "employee-1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-test" })
  tx.reservation.findUnique.mockResolvedValue(null)
  mocks.transaction.mockImplementation((work: (t: typeof tx) => unknown) => work(tx))
})

describe("GET /api/inventory/stock", () => {
  it("la matriz exige módulo inventario y recorta sucursales del restringido", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    expect((await stockMatrix(nx(new Request("https://app.invalid/api/inventory/stock")))).status).toBe(403)
    expect(mocks.productFindMany).not.toHaveBeenCalled()

    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    expect((await stockMatrix(nx(new Request("https://app.invalid/api/inventory/stock")))).status).toBe(200)
    expect(mocks.productFindMany.mock.calls[0][0].select.stocks.where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.branchFindMany.mock.calls[0][0].where.id).toEqual({ in: ["b1"] })
  })

  it("?productId= sirve a taller|inventario y también recorta sucursales", async () => {
    mocks.productFindFirst.mockResolvedValue({ id: "p1", name: "Pantalla", barcode: "B1", stocks: [{ branchId: "b1", quantity: 2 }] })
    mocks.branchFindMany.mockResolvedValue([{ id: "b1", name: "Matriz" }])

    // Sin taller ni inventario → 403.
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    expect((await stockMatrix(nx(new Request("https://app.invalid/api/inventory/stock?productId=p1")))).status).toBe(403)

    // Con taller sí entra y solo ve sus sucursales.
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    const res = await stockMatrix(nx(new Request("https://app.invalid/api/inventory/stock?productId=p1")))
    expect(res.status).toBe(200)
    expect(mocks.branchFindMany.mock.calls[0][0].where.id).toEqual({ in: ["b1"] })
    const body = await res.json()
    expect(body.stock.map((s: { branchId: string }) => s.branchId)).toEqual(["b1"])
  })

  it("admin ve todas las sucursales activas", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    mocks.productFindFirst.mockResolvedValue({ id: "p1", name: "P", barcode: "B", stocks: [] })
    await stockMatrix(nx(new Request("https://app.invalid/api/inventory/stock?productId=p1")))
    expect(mocks.branchFindMany.mock.calls[0][0].where).not.toHaveProperty("id")
  })
})

describe("GET /api/workshop — lista recortada por currentBranchId", () => {
  it("sin filtro aplica { in: allowed }; con filtro ajeno es 403", async () => {
    mocks.auth.mockResolvedValue(restricted(["taller"]))
    expect((await workshopList(new Request("https://app.invalid/api/workshop?branchId=b2"))).status).toBe(403)
    expect(mocks.repairOrderFindMany).not.toHaveBeenCalled()

    await workshopList(new Request("https://app.invalid/api/workshop?branchId=b1"))
    expect(mocks.repairOrderFindMany.mock.calls[0][0].where.currentBranchId).toBe("b1")

    await workshopList(new Request("https://app.invalid/api/workshop"))
    expect(mocks.repairOrderFindMany.mock.calls[1][0].where.currentBranchId).toEqual({ in: ["b1"] })
  })

  it("empleado sin restricción conserva el alcance completo", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["taller"] }))
    await workshopList(new Request("https://app.invalid/api/workshop"))
    expect(mocks.repairOrderFindMany.mock.calls[0][0].where).not.toHaveProperty("currentBranchId")
  })
})

describe("GET /api/sales/[id] — detalle acotado a la sucursal de la venta", () => {
  it("venta de otra sucursal es 403; la propia responde 200", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    mocks.saleFindUnique.mockResolvedValue(saleRow("s-1", "b2"))
    expect((await saleDetail(new Request("https://app.invalid/api/sales/s-1"), params("s-1"))).status).toBe(403)

    mocks.saleFindUnique.mockResolvedValue(saleRow("s-1", "b1"))
    expect((await saleDetail(new Request("https://app.invalid/api/sales/s-1"), params("s-1"))).status).toBe(200)
  })

  it("venta de otro negocio sigue siendo 404", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    mocks.saleFindUnique.mockResolvedValue(null) // el where businessId no la alcanza
    expect((await saleDetail(new Request("https://app.invalid/api/sales/s-9"), params("s-9"))).status).toBe(404)
  })
})

describe("GET /api/inventory — movimientos + reservas recortados, costo solo ADMIN", () => {
  it("?branchId= ajena es 403 y sin filtro ambas fuentes quedan en { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    expect((await movements(nx(new Request("https://app.invalid/api/inventory?branchId=b2")))).status).toBe(403)
    expect(mocks.inventoryMovementFindMany).not.toHaveBeenCalled()

    await movements(nx(new Request("https://app.invalid/api/inventory?branchId=b1")))
    expect(mocks.inventoryMovementFindMany.mock.calls[0][0].where.branchId).toBe("b1")
    expect(mocks.reservationFindMany.mock.calls[0][0].where.branchId).toBe("b1")

    await movements(nx(new Request("https://app.invalid/api/inventory")))
    expect(mocks.inventoryMovementFindMany.mock.calls[1][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.reservationFindMany.mock.calls[1][0].where.branchId).toEqual({ in: ["b1"] })
  })

  it("costPrice solo se selecciona para ADMIN", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    await movements(nx(new Request("https://app.invalid/api/inventory")))
    expect(mocks.inventoryMovementFindMany.mock.calls[0][0].include.product.select).not.toHaveProperty("costPrice")

    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await movements(nx(new Request("https://app.invalid/api/inventory")))
    expect(mocks.inventoryMovementFindMany.mock.calls[1][0].include.product.select.costPrice).toBe(true)
  })
})

describe("GET /api/pedidos — las tres fuentes se recortan", () => {
  it("encargos, reservas y apartados reciben { in: allowed }", async () => {
    mocks.auth.mockResolvedValue(restricted(["clientes"]))
    const res = await pedidos(nx(new Request("https://app.invalid/api/pedidos")))
    expect(res.status).toBe(200)
    expect(mocks.encargoFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.reservationFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.saleFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.encargoCount.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.reservationCount.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.saleCount.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
  })

  it("admin ve todo el negocio", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await pedidos(nx(new Request("https://app.invalid/api/pedidos")))
    expect(mocks.encargoFindMany.mock.calls[0][0].where).not.toHaveProperty("branchId")
    expect(mocks.reservationFindMany.mock.calls[0][0].where).not.toHaveProperty("branchId")
    expect(mocks.saleFindMany.mock.calls[0][0].where).not.toHaveProperty("branchId")
  })
})

describe("GET /api/purchases — assert en ?branchId= y recorte por defecto", () => {
  it("?branchId= ajena es 403 y sin filtro solo llegan las propias", async () => {
    mocks.auth.mockResolvedValue(restricted(["inventario"]))
    expect((await purchases(nx(new Request("https://app.invalid/api/purchases?branchId=b2")))).status).toBe(403)
    expect(mocks.purchaseFindMany).not.toHaveBeenCalled()

    mocks.purchaseFindMany.mockResolvedValue([purchaseRow("oc-1", "b1"), purchaseRow("oc-2", "b2")])
    const res = await purchases(nx(new Request("https://app.invalid/api/purchases")))
    expect(res.status).toBe(200)
    const { purchases: list } = await res.json()
    expect(list.map((p: { id: string }) => p.id)).toEqual(["oc-1"])
  })
})

describe("reservas — lista, detalle y verify acotados por sucursal", () => {
  it("GET /api/reservations: staff restringido recibe { in: allowed }, el cliente solo lo suyo", async () => {
    mocks.auth.mockResolvedValue(restricted(["reservas"]))
    await reservations(new Request("https://app.invalid/api/reservations"))
    expect(mocks.reservationFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    expect(mocks.reservationFindMany.mock.calls[0][0].where).not.toHaveProperty("userId")

    mocks.auth.mockResolvedValue(staff("CUSTOMER"))
    await reservations(new Request("https://app.invalid/api/reservations"))
    expect(mocks.reservationFindMany.mock.calls[1][0].where.userId).toBe("customer-1")
    expect(mocks.reservationFindMany.mock.calls[1][0].where).not.toHaveProperty("branchId")
  })

  it("GET /api/reservations/[id]: reserva de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted(["reservas"]))
    mocks.reservationFindUnique.mockResolvedValue(reservationRow("res-1", "b2"))
    expect((await reservationDetail(new Request("https://app.invalid/api/reservations/res-1"), params("res-1"))).status).toBe(403)

    mocks.reservationFindUnique.mockResolvedValue(reservationRow("res-1", "b1"))
    expect((await reservationDetail(new Request("https://app.invalid/api/reservations/res-1"), params("res-1"))).status).toBe(200)
  })

  it("GET /api/reservations/verify: QR de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted(["reservas"]))
    mocks.reservationFindFirst.mockResolvedValue(reservationRow("res-1", "b2"))
    expect((await verifyLookup(new Request("https://app.invalid/api/reservations/verify?code=qr-res-1"))).status).toBe(403)

    mocks.reservationFindFirst.mockResolvedValue(reservationRow("res-1", "b1"))
    expect((await verifyLookup(new Request("https://app.invalid/api/reservations/verify?code=qr-res-1"))).status).toBe(200)
  })

  it("POST /api/reservations/verify (entrega) exige sucursal asignada", async () => {
    mocks.auth.mockResolvedValue(restricted(["reservas"]))
    mocks.reservationFindFirst.mockResolvedValue({ id: "res-1", branchId: "b2" })
    const res = await verifyDeliver(post("https://app.invalid/api/reservations/verify", { qrCode: "qr-res-1", finalPaymentMethod: "EFECTIVO" }))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()

    // La propia llega al dominio (tx falso no encuentra la reserva → 404).
    mocks.reservationFindFirst.mockResolvedValue({ id: "res-1", branchId: "b1" })
    const ok = await verifyDeliver(post("https://app.invalid/api/reservations/verify", { qrCode: "qr-res-1", finalPaymentMethod: "EFECTIVO" }))
    expect(ok.status).toBe(404)
    expect(mocks.transaction).toHaveBeenCalled()
  })
})

describe("GET /api/search/pos — overlay de stock del staff", () => {
  beforeEach(() => {
    mocks.productFindMany.mockResolvedValue([productRow("p1")])
  })

  it("empleado restringido: ?branchId= ajena es 403; sin filtro suma solo sus sucursales", async () => {
    mocks.auth.mockResolvedValue(restricted(["ventas"]))
    expect((await posSearch(new Request("https://app.invalid/api/search/pos?q=pantalla&branchId=b2"))).status).toBe(403)
    expect(mocks.branchStockFindMany).not.toHaveBeenCalled()

    mocks.branchStockFindMany.mockResolvedValue([{ productId: "p1", quantity: 3 }])
    const res = await posSearch(new Request("https://app.invalid/api/search/pos?q=pantalla"))
    expect(res.status).toBe(200)
    expect(mocks.branchStockFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
    const { products } = await res.json()
    expect(products[0].stock).toBe(3) // 3 en b1, no el total global (99)
  })

  it("empleado sin restricción con ?branchId= recibe el stock de esa sucursal", async () => {
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["ventas"] }))
    mocks.branchStockFindMany.mockResolvedValue([{ productId: "p1", quantity: 7 }])
    const res = await posSearch(new Request("https://app.invalid/api/search/pos?q=pantalla&branchId=b9"))
    expect(res.status).toBe(200)
    expect(mocks.branchStockFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b9"] })
    const { products } = await res.json()
    expect(products[0].stock).toBe(7)
  })

  it("anónimo: ?branchId= no dispara overlay; queda el stock total", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await posSearch(new Request("https://app.invalid/api/search/pos?q=pantalla&branchId=b1"))
    expect(res.status).toBe(200)
    expect(mocks.branchStockFindMany).not.toHaveBeenCalled()
    const { products } = await res.json()
    expect(products[0].stock).toBe(99)
  })
})

describe("GET /api/settings — datos bancarios solo para ADMIN/configuración", () => {
  const bankRows = () => {
    mocks.systemSettingsFindMany.mockResolvedValue([
      { key: "bank_transfer_info", value: "CLABE 0123" },
      { key: "bank_cash_info", value: "Cuenta 456" },
    ])
  }

  it("empleado sin módulo configuración recibe el payload sin datos bancarios", async () => {
    bankRows()
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["ventas"] }))
    const res = await settings()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).not.toHaveProperty("bankTransferInfo")
    expect(json).not.toHaveProperty("bankCashInfo")
    expect(json.ticketFooter).toBeTruthy() // el resto del payload staff sigue igual
  })

  it("empleado con módulo configuración y admin sí los reciben", async () => {
    bankRows()
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["configuracion"] }))
    let json = await (await settings()).json()
    expect(json.bankTransferInfo).toBe("CLABE 0123")
    expect(json.bankCashInfo).toBe("Cuenta 456")

    mocks.auth.mockResolvedValue(staff("ADMIN"))
    json = await (await settings()).json()
    expect(json.bankTransferInfo).toBe("CLABE 0123")
  })

  it("el subset público (anónimo) se mantiene igual", async () => {
    mocks.auth.mockResolvedValue(null)
    const res = await settings()
    const json = await res.json()
    expect(json).toHaveProperty("tempReservationMinutes")
    expect(json).not.toHaveProperty("bankTransferInfo")
    expect(json).not.toHaveProperty("ticketFooter")
  })
})
