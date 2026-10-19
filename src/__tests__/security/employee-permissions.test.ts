import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Matriz de permisos del mostrador (EMPLOYEE).
 *
 * Las rutas se ejercitan con Request/Response reales y el dominio corre de
 * verdad: el mock de prisma implementa $transaction entregando un tx falso,
 * así un PATCH de reserva atraviesa changeReservation completo.
 */

const tx = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  reservation: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  settings: { findFirst: vi.fn() },
  product: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  branch: { findFirst: vi.fn() },
  branchStock: { upsert: vi.fn() },
  inventoryMovement: { create: vi.fn() },
  cashRegister: { findMany: vi.fn(), updateMany: vi.fn() },
  cashMovement: { create: vi.fn() },
  creditMovement: { findMany: vi.fn() },
  sale: { create: vi.fn() },
  saleItem: { create: vi.fn() },
  payment: { create: vi.fn() },
}))

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  serviceFindMany: vi.fn(),
  settingsFindMany: vi.fn(),
  userFindMany: vi.fn(),
  userCount: vi.fn(),
  repairGroupBy: vi.fn(),
  productFindMany: vi.fn(),
  branchFindMany: vi.fn(),
  reservationFindMany: vi.fn(),
  reservationCount: vi.fn(),
  reservationFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  transaction: vi.fn((work: (t: typeof tx) => unknown) => work(tx)),
}))

vi.mock("@/lib/auth", () => ({ auth: mocks.auth, handlers: { GET: vi.fn(), POST: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    workshopService: { findMany: mocks.serviceFindMany },
    systemSettings: { findMany: mocks.settingsFindMany },
    user: { findMany: mocks.userFindMany, count: mocks.userCount },
    repairOrder: { groupBy: mocks.repairGroupBy },
    product: { findMany: mocks.productFindMany },
    branch: { findMany: mocks.branchFindMany },
    reservation: {
      findMany: mocks.reservationFindMany,
      count: mocks.reservationCount,
      findUnique: mocks.reservationFindUnique,
      findFirst: mocks.reservationFindFirst,
    },
    $transaction: mocks.transaction,
  },
}))

import { GET as workshopServices, POST as createService } from "@/app/api/workshop-services/route"
import { GET as workshopConfig } from "@/app/api/workshop-config/route"
import { GET as clientes } from "@/app/api/clientes/route"
import { GET as exportCsv } from "@/app/api/export/route"
import { GET as reservations } from "@/app/api/reservations/route"
import { GET as reservationDetail, PATCH as changeOwn } from "@/app/api/reservations/[id]/route"
import { GET as verifyLookup, POST as verifyDeliver } from "@/app/api/reservations/verify/route"
import { GET as posCustomers } from "@/app/api/users/pos/route"

const session = (id: string, role = "CUSTOMER", status = "APPROVED") => ({ user: { id, role, status, businessId: "biz-test", customerType: "NORMAL" } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const patch = (url: string, body: unknown) => new Request(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const post = (url: string, body: unknown) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

const staffUser = (role: string) => ({ id: `${role.toLowerCase()}-1`, name: role, role, status: "APPROVED", businessId: "biz-test" })
const activeReservation = (over: Record<string, unknown> = {}) => ({
  id: "res-1", businessId: "biz-test", userId: "customer-9", productId: "p1", quantity: 1,
  status: "PENDING", type: "TEMPORARY", totalPrice: 100, paymentMethod: "STORE",
  depositPaid: false, depositAmount: null, paymentProofUrl: null, branchId: "b1",
  businessVersion: 1, expiresAt: new Date(Date.now() + 3600000), adminNotes: null,
  product: { id: "p1", name: "Pantalla" }, ...over,
})

/** Deja el tx listo para que changeReservation complete el camino feliz. */
function armTxFor(action: "approve" | "cancel" | "complete") {
  const reservation = activeReservation()
  tx.reservation.findUnique.mockResolvedValue(reservation)
  tx.reservation.findUniqueOrThrow.mockResolvedValue({ ...reservation, status: "DONE" })
  tx.reservation.updateMany.mockResolvedValue({ count: 1 })
  tx.settings.findFirst.mockResolvedValue(null)
  if (action === "cancel") {
    tx.product.findFirst.mockResolvedValue({ id: "p1", name: "Pantalla", stock: 5 })
    tx.product.findUniqueOrThrow.mockResolvedValue({ id: "p1", name: "Pantalla", stock: 6 })
    tx.product.update.mockResolvedValue({})
    tx.branch.findFirst.mockResolvedValue({ id: "b1", name: "Matriz", isActive: true })
    tx.branchStock.upsert.mockResolvedValue({})
    tx.inventoryMovement.create.mockResolvedValue({})
  }
  if (action === "complete") {
    tx.branch.findFirst.mockResolvedValue({ id: "b1", name: "Matriz", isActive: true })
    tx.cashRegister.findMany.mockResolvedValue([{ id: "reg-1", status: "OPEN" }])
    tx.cashRegister.updateMany.mockResolvedValue({ count: 1 })
    tx.cashMovement.create.mockResolvedValue({ id: "cash-1" })
    // La entrega deja documento de venta: Sale + renglón + Payment ligado.
    tx.sale.create.mockResolvedValue({ id: "sale-1", number: 7 })
    tx.saleItem.create.mockResolvedValue({})
    tx.payment.create.mockResolvedValue({})
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue(null)
  mocks.serviceFindMany.mockResolvedValue([])
  mocks.settingsFindMany.mockResolvedValue([])
  mocks.userFindMany.mockResolvedValue([])
  mocks.userCount.mockResolvedValue(0)
  mocks.repairGroupBy.mockResolvedValue([])
  mocks.productFindMany.mockResolvedValue([])
  mocks.branchFindMany.mockResolvedValue([])
  mocks.reservationFindMany.mockResolvedValue([])
  mocks.reservationCount.mockResolvedValue(0)
})

describe("catálogo, configuración y clientes son legibles por el mostrador", () => {
  it("GET /api/workshop-services admite staff y rechaza el resto", async () => {
    for (const role of ["ADMIN", "EMPLOYEE"]) {
      mocks.auth.mockResolvedValue(session(`${role.toLowerCase()}-1`, role))
      expect((await workshopServices(new Request("https://app.invalid/api/workshop-services"))).status).toBe(200)
    }
    for (const s of [null, session("c", "CUSTOMER"), session("w", "WORKSHOP"), session("p", "EMPLOYEE", "PENDING")]) {
      mocks.auth.mockResolvedValue(s)
      expect([401, 403]).toContain((await workshopServices(new Request("https://app.invalid/api/workshop-services"))).status)
    }
  })

  it("POST /api/workshop-services sigue siendo admin-only", async () => {
    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    const res = await createService(post("https://app.invalid/api/workshop-services", { name: "Cambio de pantalla", idempotencyKey: "op-test-0001" }))
    expect(res.status).toBe(403)
  })

  it("GET /api/workshop-config admite empleado, no cliente", async () => {
    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    expect((await workshopConfig()).status).toBe(200)
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    expect((await workshopConfig()).status).toBe(403)
  })

  it("GET /api/clientes admite empleado, no cliente", async () => {
    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    expect((await clientes(new Request("https://app.invalid/api/clientes"))).status).toBe(200)
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    expect((await clientes(new Request("https://app.invalid/api/clientes"))).status).toBe(403)
    expect(mocks.userFindMany).toHaveBeenCalledTimes(1)
  })

  it("GET /api/users/pos sigue acotado a clientes con crédito del negocio", async () => {
    mocks.auth.mockResolvedValue(session("emp-1", "EMPLOYEE"))
    const res = await posCustomers(new Request("https://app.invalid/api/users/pos?search=mar"))
    expect(res.status).toBe(200)
    const where = mocks.userFindMany.mock.calls[0][0].where
    expect(where.businessId).toBe("biz-test")
    expect(where.role).toBe("CUSTOMER")
    expect(where.creditLimit).toEqual({ not: null })
    const select = mocks.userFindMany.mock.calls[0][0].select
    for (const pii of ["email", "phone", "telegramId", "password"]) expect(select).not.toHaveProperty(pii)
    // Búsquedas cortas no listan nada.
    const empty = await posCustomers(new Request("https://app.invalid/api/users/pos?search=m"))
    expect((await empty.json()).users).toEqual([])
    expect(mocks.userFindMany).toHaveBeenCalledTimes(1)
  })
})

describe("exportación CSV vuelve a ser admin-only", () => {
  it("empleado y cliente reciben 403; admin obtiene el CSV", async () => {
    for (const s of [session("e", "EMPLOYEE"), session("c", "CUSTOMER"), null]) {
      mocks.auth.mockResolvedValue(s)
      expect([401, 403]).toContain((await exportCsv(new Request("https://app.invalid/api/export?type=products"))).status)
    }
    expect(mocks.productFindMany).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValue(session("a", "ADMIN"))
    const res = await exportCsv(new Request("https://app.invalid/api/export?type=products"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/csv")
  })
})

describe("gestión de reservas en mostrador", () => {
  it("empleado entrega por QR cobrando el saldo en efectivo", async () => {
    armTxFor("complete")
    tx.user.findUnique.mockResolvedValue(staffUser("EMPLOYEE"))
    mocks.auth.mockResolvedValue(session("employee-1", "EMPLOYEE"))
    mocks.reservationFindFirst.mockResolvedValue({ id: "res-1" })
    const res = await verifyDeliver(post("https://app.invalid/api/reservations/verify", { qrCode: "RES-QR", finalPaymentMethod: "EFECTIVO", idempotencyKey: "op-test-0002" }))
    expect(res.status).toBe(200)
    expect(tx.cashMovement.create).toHaveBeenCalled()
    // La entrega deja el documento de venta: Sale COMPLETED + Payment ligado
    // al único asiento de caja (sin re-cobro ni segundo movimiento).
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", kind: "RETAIL", customerId: "customer-9", sellerId: "employee-1" }),
    }))
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purpose: "RESERVATION", reference: "res-1", method: "CASH", cashMovementId: "cash-1" }),
    }))
  })

  it("empleado cancela la reserva de un cliente y se libera el stock", async () => {
    armTxFor("cancel")
    tx.user.findUnique.mockResolvedValue(staffUser("EMPLOYEE"))
    mocks.auth.mockResolvedValue(session("employee-1", "EMPLOYEE"))
    const res = await changeOwn(patch("https://app.invalid/api/reservations/res-1", { action: "cancel" }), params("res-1"))
    expect(res.status).toBe(200)
    expect(tx.branchStock.upsert).toHaveBeenCalled()
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }))
  })

  it("cliente no puede aprobar ni gestionar reservas (dominio sigue cerrado)", async () => {
    armTxFor("approve")
    tx.user.findUnique.mockResolvedValue({ id: "c-1", name: "Cli", role: "CUSTOMER", status: "APPROVED", businessId: "biz-test" })
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    // La ruta de cliente llega al dominio y el dominio exige staff.
    expect((await changeOwn(patch("https://app.invalid/api/reservations/res-1", { action: "approve" }), params("res-1"))).status).toBe(403)
    expect(tx.reservation.updateMany).not.toHaveBeenCalled()
  })

  it("cliente sí puede cancelar su propia reserva", async () => {
    armTxFor("cancel")
    tx.user.findUnique.mockResolvedValue({ id: "customer-9", name: "Cli", role: "CUSTOMER", status: "APPROVED", businessId: "biz-test" })
    mocks.auth.mockResolvedValue(session("customer-9", "CUSTOMER"))
    const res = await changeOwn(patch("https://app.invalid/api/reservations/res-1", { action: "cancel" }), params("res-1"))
    expect(res.status).toBe(200)
  })

  it("cliente no puede cancelar la reserva de otro", async () => {
    armTxFor("cancel")
    tx.user.findUnique.mockResolvedValue({ id: "c-1", name: "Cli", role: "CUSTOMER", status: "APPROVED", businessId: "biz-test" })
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    expect((await changeOwn(patch("https://app.invalid/api/reservations/res-1", { action: "cancel" }), params("res-1"))).status).toBe(403)
  })

  it("GET /api/reservations devuelve todo el negocio al staff y solo lo propio al cliente", async () => {
    mocks.auth.mockResolvedValue(session("employee-1", "EMPLOYEE"))
    await reservations(new Request("https://app.invalid/api/reservations"))
    expect(mocks.reservationFindMany.mock.calls[0][0].where).not.toHaveProperty("userId")
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    await reservations(new Request("https://app.invalid/api/reservations"))
    expect(mocks.reservationFindMany.mock.calls[1][0].where.userId).toBe("c-1")
  })

  it("GET /api/reservations/[id] deja al staff ver reservas ajenas, no al cliente", async () => {
    mocks.reservationFindUnique.mockResolvedValue(activeReservation())
    mocks.auth.mockResolvedValue(session("employee-1", "EMPLOYEE"))
    expect((await reservationDetail(new Request("https://app.invalid/api/reservations/res-1"), params("res-1"))).status).toBe(200)
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    expect((await reservationDetail(new Request("https://app.invalid/api/reservations/res-1"), params("res-1"))).status).toBe(403)
  })

  it("GET /api/reservations/verify (lookup de QR) admite staff", async () => {
    mocks.reservationFindFirst.mockResolvedValue(activeReservation())
    mocks.auth.mockResolvedValue(session("employee-1", "EMPLOYEE"))
    expect((await verifyLookup(new Request("https://app.invalid/api/reservations/verify?code=RES-QR"))).status).toBe(200)
    mocks.auth.mockResolvedValue(session("c-1", "CUSTOMER"))
    expect((await verifyLookup(new Request("https://app.invalid/api/reservations/verify?code=RES-QR"))).status).toBe(403)
  })
})
