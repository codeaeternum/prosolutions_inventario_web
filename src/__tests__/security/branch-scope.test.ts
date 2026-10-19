import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Alcance de sucursal del EMPLOYEE con allowedBranchIds.
 *
 * - Lecturas con ?branchId= validan la sucursal (403 si es ajena).
 * - Listas sin filtro se recortan a las sucursales asignadas.
 * - Operaciones usan la sucursal EFECTIVA del documento/venta/encargo —
 *   omitir branchId en el body ya no cae en la sucursal base del actor.
 * - /api/encargos/compras oculta costPrice al empleado (costo = solo ADMIN).
 * - methodTotals de caja cuenta VOIDED: la anulación del mismo turno
 *   cancela a 0 en vez de quedar negativa.
 */

const tx = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  sale: { findUnique: vi.fn() },
  encargo: { findFirst: vi.fn() },
}))

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  saleFindMany: vi.fn(),
  saleCount: vi.fn(),
  saleFindUnique: vi.fn(),
  saleGroupBy: vi.fn(),
  saleItemFindMany: vi.fn(),
  productFindMany: vi.fn(),
  branchStockFindMany: vi.fn(),
  branchStockGroupBy: vi.fn(),
  repairPartFindMany: vi.fn(),
  repairOrderGroupBy: vi.fn(),
  inventoryMovementFindMany: vi.fn(),
  shoppingItemFindMany: vi.fn(),
  encargoFindMany: vi.fn(),
  encargoFindUnique: vi.fn(),
  cashRegisterFindFirst: vi.fn(),
  cashRegisterFindMany: vi.fn(),
  paymentGroupBy: vi.fn(),
  branchFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  systemSettingsFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => {
  const client = {
    sale: { findMany: mocks.saleFindMany, count: mocks.saleCount, findUnique: mocks.saleFindUnique, groupBy: mocks.saleGroupBy },
    saleItem: { findMany: mocks.saleItemFindMany },
    product: { findMany: mocks.productFindMany },
    branchStock: { findMany: mocks.branchStockFindMany, groupBy: mocks.branchStockGroupBy },
    repairPart: { findMany: mocks.repairPartFindMany },
    repairOrder: { groupBy: mocks.repairOrderGroupBy },
    inventoryMovement: { findMany: mocks.inventoryMovementFindMany },
    shoppingItem: { findMany: mocks.shoppingItemFindMany },
    encargo: { findMany: mocks.encargoFindMany, findUnique: mocks.encargoFindUnique },
    cashRegister: { findFirst: mocks.cashRegisterFindFirst, findMany: mocks.cashRegisterFindMany },
    payment: { groupBy: mocks.paymentGroupBy },
    branch: { findMany: mocks.branchFindMany },
    user: { findUnique: mocks.userFindUnique },
    systemSettings: { findUnique: mocks.systemSettingsFindUnique },
    $transaction: mocks.transaction,
  }
  return { prisma: client, default: client }
})

import type { NextRequest } from "next/server"
import { GET as salesList } from "@/app/api/sales/route"
import { POST as voidSaleRoute } from "@/app/api/sales/[id]/void/route"
import { POST as returnItemsRoute } from "@/app/api/sales/[id]/returns/route"
import { GET as posDocuments } from "@/app/api/pos/documents/route"
import { GET as posDocumentDetail, DELETE as deleteDocument } from "@/app/api/pos/documents/[id]/route"
import { POST as checkoutDocument } from "@/app/api/pos/documents/[id]/checkout/route"
import { POST as payDocument } from "@/app/api/pos/documents/[id]/pay/route"
import { GET as posProducts } from "@/app/api/pos/products/route"
import { GET as caja } from "@/app/api/caja/route"
import { GET as encargosList } from "@/app/api/encargos/route"
import { PATCH as transitionEncargoRoute } from "@/app/api/encargos/[id]/route"
import { GET as compras } from "@/app/api/encargos/compras/route"
import { GET as sucursales } from "@/app/api/reports/sucursales/route"

const staff = (role: string, opts: { modules?: string[]; branches?: string[] } = {}) => ({
  user: {
    id: `${role.toLowerCase()}-1`, role, status: "APPROVED", businessId: "biz-test",
    allowedModules: opts.modules ?? [], allowedBranchIds: opts.branches ?? [],
  },
})
/** Empleado asignado solo a la sucursal b1, con los módulos que ejercita la prueba. */
const restricted = () => staff("EMPLOYEE", { modules: ["ventas", "caja", "inventario", "reportes"], branches: ["b1"] })

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const patch = (url: string, body: unknown) => new Request(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const del = (url: string, body: unknown = {}) => new Request(url, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
/** Las rutas de encargos/reportes reciben NextRequest; el Request del test se castea (solo se lee .url). */
const nx = (req: Request) => req as unknown as NextRequest

const docRow = (id: string, branchId: string) => ({
  id, businessId: "biz-test", branchId, total: 100, status: "DRAFT", kind: "RETAIL",
  items: [], payments: [], customer: null, seller: { name: "Cajero" }, createdAt: new Date(),
})
const encargoRow = (id: string, branchId: string | null) => ({
  id, businessId: "biz-test", branchId, status: "PENDING", description: `Pieza ${id}`,
  quantity: 1, deposit: 0, priceQuoted: null, customer: null, product: null,
  branch: branchId ? { id: branchId, name: "Suc" } : null,
  createdBy: { id: "u", name: "U" }, resolvedBy: null, createdAt: new Date(),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.saleFindMany.mockResolvedValue([])
  mocks.saleCount.mockResolvedValue(0)
  mocks.saleFindUnique.mockResolvedValue(null)
  mocks.saleGroupBy.mockResolvedValue([])
  mocks.saleItemFindMany.mockResolvedValue([])
  mocks.productFindMany.mockResolvedValue([])
  mocks.branchStockFindMany.mockResolvedValue([])
  mocks.branchStockGroupBy.mockResolvedValue([])
  mocks.repairPartFindMany.mockResolvedValue([])
  mocks.repairOrderGroupBy.mockResolvedValue([])
  mocks.inventoryMovementFindMany.mockResolvedValue([])
  mocks.shoppingItemFindMany.mockResolvedValue([])
  mocks.encargoFindMany.mockResolvedValue([])
  mocks.encargoFindUnique.mockResolvedValue(null)
  mocks.cashRegisterFindFirst.mockResolvedValue(null)
  mocks.cashRegisterFindMany.mockResolvedValue([])
  mocks.paymentGroupBy.mockResolvedValue([])
  mocks.branchFindMany.mockResolvedValue([])
  mocks.userFindUnique.mockResolvedValue(null)
  mocks.systemSettingsFindUnique.mockResolvedValue(null)
  // Tx falso para las operaciones que PASAN el assert de sucursal: el actor
  // aprueba y el dominio no encuentra el documento → 404/409 controlado.
  tx.user.findUnique.mockResolvedValue({ id: "employee-1", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-test" })
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.sale.findUnique.mockResolvedValue(null)
  tx.encargo.findFirst.mockResolvedValue(null)
  mocks.transaction.mockImplementation((work: (t: typeof tx) => unknown) => work(tx))
})

describe("lecturas: ?branchId= ajena es 403 y la lista sin filtro se recorta", () => {
  it("GET /api/sales", async () => {
    mocks.auth.mockResolvedValue(restricted())
    expect((await salesList(new Request("https://app.invalid/api/sales?branchId=b2"))).status).toBe(403)
    expect(mocks.saleFindMany).not.toHaveBeenCalled()

    expect((await salesList(new Request("https://app.invalid/api/sales?branchId=b1"))).status).toBe(200)
    expect(mocks.saleFindMany.mock.calls[0][0].where.branchId).toBe("b1")

    await salesList(new Request("https://app.invalid/api/sales"))
    expect(mocks.saleFindMany.mock.calls[1][0].where.branchId).toEqual({ in: ["b1"] })
  })

  it("GET /api/sales sin restricción conserva el alcance completo", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    await salesList(new Request("https://app.invalid/api/sales"))
    expect(mocks.saleFindMany.mock.calls[0][0].where).not.toHaveProperty("branchId")

    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["ventas"] }))
    expect((await salesList(new Request("https://app.invalid/api/sales?branchId=b9"))).status).toBe(200)
  })

  it("GET /api/pos/documents", async () => {
    mocks.auth.mockResolvedValue(restricted())
    expect((await posDocuments(new Request("https://app.invalid/api/pos/documents?branchId=b2"))).status).toBe(403)

    mocks.saleFindMany.mockResolvedValue([docRow("d1", "b1"), docRow("d2", "b2")])
    const res = await posDocuments(new Request("https://app.invalid/api/pos/documents"))
    expect(res.status).toBe(200)
    const { documents } = await res.json()
    expect(documents.map((d: { id: string }) => d.id)).toEqual(["d1"])
  })

  it("GET /api/pos/documents/[id] de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue({ ...docRow("doc-1", "b2"), branch: { id: "b2", name: "Suc" } })
    const res = await posDocumentDetail(new Request("https://app.invalid/api/pos/documents/doc-1"), params("doc-1"))
    expect(res.status).toBe(403)
  })

  it("GET /api/pos/products?branchId= ajena es 403", async () => {
    mocks.auth.mockResolvedValue(restricted())
    expect((await posProducts(new Request("https://app.invalid/api/pos/products?branchId=b2"))).status).toBe(403)
    expect(mocks.branchStockFindMany).not.toHaveBeenCalled()

    mocks.productFindMany.mockResolvedValue([])
    expect((await posProducts(new Request("https://app.invalid/api/pos/products?branchId=b1"))).status).toBe(200)
  })

  it("GET /api/caja: caja activa y cortes de la semana se acotan a las asignadas", async () => {
    mocks.auth.mockResolvedValue(restricted())
    expect((await caja(new Request("https://app.invalid/api/caja?branchId=b2"))).status).toBe(403)
    expect(mocks.cashRegisterFindFirst).not.toHaveBeenCalled()

    expect((await caja(new Request("https://app.invalid/api/caja"))).status).toBe(200)
    expect(mocks.cashRegisterFindFirst.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })

    await caja(new Request("https://app.invalid/api/caja?view=week"))
    expect(mocks.cashRegisterFindMany.mock.calls[0][0].where.branchId).toEqual({ in: ["b1"] })
  })

  it("GET /api/encargos: lista recortada a las sucursales asignadas", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.userFindUnique.mockResolvedValue({ homeBranchId: "b1" })
    mocks.encargoFindMany.mockResolvedValue([encargoRow("e1", "b1"), encargoRow("e2", "b2"), encargoRow("e3", null)])
    const res = await encargosList(nx(new Request("https://app.invalid/api/encargos")))
    expect(res.status).toBe(200)
    const { encargos } = await res.json()
    expect(encargos.map((e: { id: string }) => e.id)).toEqual(["e1"])
    expect((await encargosList(nx(new Request("https://app.invalid/api/encargos?branchId=b2")))).status).toBe(403)
  })

  it("GET /api/reports/sucursales: el comparador se limita a las asignadas", async () => {
    mocks.branchFindMany.mockResolvedValue([{ id: "b1", name: "Matriz" }, { id: "b2", name: "Suc" }])
    mocks.auth.mockResolvedValue(staff("EMPLOYEE", { modules: ["reportes"], branches: ["b1"] }))

    const res = await sucursales(nx(new Request("https://app.invalid/api/reports/sucursales")))
    expect(res.status).toBe(200)
    expect((await res.json()).branches.map((b: { id: string }) => b.id)).toEqual(["b1"])

    expect((await sucursales(nx(new Request("https://app.invalid/api/reports/sucursales?branchId=b2")))).status).toBe(403)

    mocks.auth.mockResolvedValue(staff("ADMIN"))
    const adm = await sucursales(nx(new Request("https://app.invalid/api/reports/sucursales")))
    expect((await adm.json()).branches).toHaveLength(2)
  })
})

describe("operaciones: la sucursal efectiva es la del documento/venta/encargo", () => {
  const doc = (branchId: string) => ({ id: "doc-1", businessId: "biz-test", branchId })

  it("checkout de documento ajeno es 403 aunque el body omita branchId", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue(doc("b2"))
    const res = await checkoutDocument(post("https://app.invalid/api/pos/documents/doc-1/checkout", { paymentMethod: "EFECTIVO", idempotencyKey: "op-branch-0001" }), params("doc-1"))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("checkout de documento propio sí llega al dominio", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue(doc("b1"))
    const res = await checkoutDocument(post("https://app.invalid/api/pos/documents/doc-1/checkout", { paymentMethod: "EFECTIVO", idempotencyKey: "op-branch-0002" }), params("doc-1"))
    expect(res.status).toBe(404) // el tx falso no encuentra el documento
    expect(mocks.transaction).toHaveBeenCalled()
  })

  it("abono (pay) a apartado de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue(doc("b2"))
    const res = await payDocument(post("https://app.invalid/api/pos/documents/doc-1/pay", { payments: [{ method: "EFECTIVO", amount: 10 }], idempotencyKey: "op-branch-0003" }), params("doc-1"))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("DELETE de documento ajeno es 403; el propio llega al dominio", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue(doc("b2"))
    const res = await deleteDocument(del("https://app.invalid/api/pos/documents/doc-1", { reason: "Cancelado", idempotencyKey: "op-branch-0004" }), params("doc-1"))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()

    mocks.saleFindUnique.mockResolvedValue(doc("b1"))
    const ok = await deleteDocument(del("https://app.invalid/api/pos/documents/doc-1", { reason: "Cancelado", idempotencyKey: "op-branch-0005" }), params("doc-1"))
    expect(ok.status).toBe(404)
  })

  it("anular (void) una venta de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue(doc("b2"))
    const res = await voidSaleRoute(post("https://app.invalid/api/sales/doc-1/void", { reason: "Error de captura", idempotencyKey: "op-branch-0006" }), params("doc-1"))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()

    mocks.saleFindUnique.mockResolvedValue(doc("b1"))
    const ok = await voidSaleRoute(post("https://app.invalid/api/sales/doc-1/void", { reason: "Error de captura", idempotencyKey: "op-branch-0007" }), params("doc-1"))
    expect(ok.status).toBe(404)
  })

  it("devolución sobre venta de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.saleFindUnique.mockResolvedValue(doc("b2"))
    const body = { items: [{ saleItemId: "si-1", quantity: 1 }], refundMethod: "EFECTIVO", reason: "No era", idempotencyKey: "op-branch-0008" }
    const res = await returnItemsRoute(post("https://app.invalid/api/sales/doc-1/returns", body), params("doc-1"))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()

    mocks.saleFindUnique.mockResolvedValue(doc("b1"))
    const ok = await returnItemsRoute(post("https://app.invalid/api/sales/doc-1/returns", { ...body, idempotencyKey: "op-branch-0009" }), params("doc-1"))
    expect(ok.status).toBe(409) // dominio: la venta no existe en el tx falso
  })

  it("PATCH /api/encargos/[id] sobre encargo de otra sucursal es 403", async () => {
    mocks.auth.mockResolvedValue(restricted())
    mocks.encargoFindUnique.mockResolvedValue({ id: "e-1", businessId: "biz-test", branchId: "b2" })
    const res = await transitionEncargoRoute(nx(patch("https://app.invalid/api/encargos/e-1", { action: "ORDERED", idempotencyKey: "op-branch-0010" })), params("e-1"))
    expect(res.status).toBe(403)
    expect(mocks.transaction).not.toHaveBeenCalled()

    mocks.encargoFindUnique.mockResolvedValue({ id: "e-1", businessId: "biz-test", branchId: "b1" })
    const ok = await transitionEncargoRoute(nx(patch("https://app.invalid/api/encargos/e-1", { action: "ORDERED", idempotencyKey: "op-branch-0011" })), params("e-1"))
    expect(ok.status).toBe(404)
  })
})

describe("GET /api/encargos/compras — costo solo para ADMIN", () => {
  beforeEach(() => {
    mocks.repairPartFindMany.mockResolvedValue([
      { productId: "p1", qty: 2, orderId: "o1", order: { number: 5 }, product: { id: "p1", name: "Pantalla", stock: 0, costPrice: 300 } },
    ])
    mocks.productFindMany.mockResolvedValue([
      { id: "p2", name: "Batería", stock: 1, minStock: 3, costPrice: 150, isActive: true },
    ])
  })

  it("empleado recibe la demanda sin costPrice; admin sí lo ve", async () => {
    mocks.auth.mockResolvedValue(restricted())
    const emp = await compras(nx(new Request("https://app.invalid/api/encargos/compras")))
    expect(emp.status).toBe(200)
    const empBody = await emp.json()
    expect(empBody.partsShortage[0].name).toBe("Pantalla")
    expect(empBody.partsShortage[0].shortage).toBe(2)
    expect(empBody.partsShortage[0]).not.toHaveProperty("costPrice")
    expect(empBody.lowStock[0]).not.toHaveProperty("costPrice")

    mocks.auth.mockResolvedValue(staff("ADMIN"))
    const adm = await compras(nx(new Request("https://app.invalid/api/encargos/compras")))
    const admBody = await adm.json()
    expect(admBody.partsShortage[0].costPrice).toBe(300)
    expect(admBody.lowStock[0].costPrice).toBe(150)
  })

  it("empleado restringido no puede pedir la lista de otra sucursal", async () => {
    mocks.auth.mockResolvedValue(restricted())
    expect((await compras(nx(new Request("https://app.invalid/api/encargos/compras?branchId=b2")))).status).toBe(403)
    expect(mocks.repairPartFindMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/caja — Cobrado por método", () => {
  it("una anulación del mismo turno cancela a 0 (VOIDED + REFUNDED), no queda negativo", async () => {
    mocks.auth.mockResolvedValue(staff("ADMIN"))
    mocks.cashRegisterFindFirst.mockResolvedValue({
      id: "reg-1", businessId: "biz-test", branchId: "b1", status: "OPEN",
      openedAt: new Date(Date.now() - 60 * 60 * 1000), closedAt: null,
      initialAmount: 100, finalAmount: null, notes: null,
      branch: { id: "b1", name: "Matriz" }, openedBy: { name: "Cajero" }, closedBy: null,
      movements: [],
    })
    // Ledger del turno: cobro anulado (VOIDED +100 con su REFUNDED −100)
    // más una venta vigente de +50 → el método debe cerrar en 50.
    const ledger = [
      { method: "CASH", amount: 100, status: "VOIDED" },
      { method: "CASH", amount: -100, status: "REFUNDED" },
      { method: "CASH", amount: 50, status: "CONFIRMED" },
    ]
    mocks.paymentGroupBy.mockImplementation(({ where }: { where: { status: { in: string[] } } }) => {
      const sums = new Map<string, number>()
      for (const p of ledger) {
        if (!where.status.in.includes(p.status)) continue
        sums.set(p.method, (sums.get(p.method) ?? 0) + p.amount)
      }
      return Promise.resolve([...sums].map(([method, amount]) => ({ method, _sum: { amount } })))
    })

    const res = await caja(new Request("https://app.invalid/api/caja"))
    expect(res.status).toBe(200)
    expect(mocks.paymentGroupBy.mock.calls[0][0].where.status.in).toContain("VOIDED")
    const body = await res.json()
    expect(body.register.methodTotals.CASH).toBe(50)
  })
})
