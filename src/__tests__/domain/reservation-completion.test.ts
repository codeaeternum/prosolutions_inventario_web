import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

// low-stock cuelga de la cadena next-auth/notificaciones: la alerta post-commit
// es ajena al contrato probado aquí, se sustituye por un no-op.
vi.mock("@/lib/low-stock", () => ({
  collectLowStockIds: (items: { productId?: string | null }[]) => items.map(i => i.productId).filter(Boolean),
  syncLowStockAlerts: vi.fn(async () => {}),
}))

import { changeReservation } from "@/lib/domain/reservations"

/**
 * Entrega de reserva → documento de venta.
 *
 * Al completar/entregar una reserva, el dominio debe dejar (en el mismo tx):
 *   - Sale COMPLETED kind RETAIL con el total efectivamente cobrado,
 *   - su SaleItem al precio cobrado,
 *   - un Payment por cada bolsa de dinero (anticipo verificado + saldo),
 *     con purpose "RESERVATION" y reference = id de la reserva,
 *   - el Payment en efectivo ligado al cashMovement existente (no uno nuevo).
 * El dominio corre de verdad sobre un tx falso (db.$transaction entrega el
 * mock con estado mutable para simular el flip de estado atómico).
 */

const BIZ = "biz-res-completion"
const BRANCH = { id: "branch-1", name: "Matriz", isActive: true, businessId: BIZ }
const PRODUCT = { id: "prod-1", businessId: BIZ, name: "Pantalla A32", isActive: true, stock: 8, retailPrice: 200, wholesalePrice: 150 }

const users: Record<string, Record<string, unknown>> = {
  "admin-1": { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "emp-1": { id: "emp-1", name: "Empleado", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, homeBranchId: null },
  "cust-1": { id: "cust-1", name: "Cliente", role: "CUSTOMER", status: "APPROVED", businessId: BIZ, customerType: "NORMAL", creditBalance: 0, creditLimit: 5000 },
}

function reservation(over: Record<string, unknown> = {}) {
  return {
    id: "res-1", businessId: BIZ, userId: "cust-1", productId: "prod-1",
    quantity: 2, totalPrice: 400, depositAmount: null, depositPaid: false,
    type: "TEMPORARY", status: "APPROVED", paymentMethod: "STORE",
    paymentProofUrl: null, adminNotes: null, expiresAt: new Date(Date.now() + 3_600_000),
    branchId: "branch-1", businessVersion: 1, qrCode: "qr-1",
    product: { id: "prod-1", name: "Pantalla A32" },
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
  }
}

/** Réplica del tx de changeReservation con la reserva en estado mutable. */
function fakeDb(res: Record<string, unknown>) {
  const state = { ...res }
  const created = {
    sales: [] as Record<string, unknown>[],
    saleItems: [] as Record<string, unknown>[],
    payments: [] as Record<string, unknown>[],
    cash: [] as Record<string, unknown>[],
    credit: [] as Record<string, unknown>[],
    inventory: [] as Record<string, unknown>[],
  }
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id]),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    reservation: {
      findUnique: vi.fn(async () => ({ ...state })),
      findUniqueOrThrow: vi.fn(async () => ({ ...state })),
      // La guardia de concurrencia real: solo flipa si el estado no cambió.
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: Record<string, unknown> }) => {
        if (where.status !== state.status) return { count: 0 }
        Object.assign(state, data)
        return { count: 1 }
      }),
    },
    settings: { findFirst: vi.fn(async () => null) },
    creditMovement: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.credit.push(data); return { id: "cm-1", ...data } }),
    },
    product: {
      findFirst: vi.fn(async () => PRODUCT),
      findUniqueOrThrow: vi.fn(async () => ({ ...PRODUCT })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    branchStock: { upsert: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    branch: { findFirst: vi.fn(async () => BRANCH) },
    cashRegister: {
      findMany: vi.fn(async () => [{ id: "reg-1" }]),
      findUniqueOrThrow: vi.fn(async () => ({ id: "reg-1", initialAmount: 0 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    cashMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `cash-${created.cash.length + 1}`, ...data }
        created.cash.push(row)
        return row
      }),
      groupBy: vi.fn(async () => []),
    },
    inventoryMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.inventory.push(data); return { id: "mv-1", ...data } }),
    },
    sale: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `sale-${created.sales.length + 1}`, number: 100 + created.sales.length, ...data }
        created.sales.push(row)
        return row
      }),
    },
    saleItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.saleItems.push(data); return { id: "si-1", ...data } }),
    },
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created.payments.push(data); return { id: "pay-1", ...data } }),
    },
  }
  const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx, created }
}

describe("entrega de reserva → Sale + SaleItem + Payment", () => {
  it("entrega en EFECTIVO: un cashMovement ligado al Payment, sin doble cobro ni stock nuevo", async () => {
    const { db, tx, created } = fakeDb(reservation())
    const result = await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "EFECTIVO" })

    expect(result.changed).toBe(true)
    expect(result.saleId).toBe("sale-1")
    expect(result.reservation.status).toBe("COMPLETED")

    expect(created.sales).toHaveLength(1)
    expect(created.sales[0]).toMatchObject({
      businessId: BIZ, branchId: "branch-1", sellerId: "admin-1", customerId: "cust-1",
      kind: "RETAIL", status: "COMPLETED", total: 400, discountCents: 0,
    })
    expect(created.saleItems).toHaveLength(1)
    expect(created.saleItems[0]).toMatchObject({
      saleId: "sale-1", productId: "prod-1", quantity: 2, unitPrice: 200, totalPrice: 400,
    })
    // Un solo asiento de caja y el Payment lo referencia — no se duplica.
    expect(created.cash).toHaveLength(1)
    expect(created.cash[0]).toMatchObject({ type: "IN", amount: 400, referenceType: "RESERVATION", referenceId: "res-1" })
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({
      saleId: "sale-1", purpose: "RESERVATION", reference: "res-1",
      method: "CASH", amount: 400, status: "CONFIRMED",
      cashMovementId: "cash-1", createdById: "admin-1",
    })
    // El stock salió al reservar ("Compromiso"): la entrega no crea movimientos.
    expect(tx.branchStock.updateMany).not.toHaveBeenCalled()
    expect(created.inventory).toHaveLength(0)
  })

  it("entrega con TARJETA documenta el cobro sin tocar la caja", async () => {
    const { db, created } = fakeDb(reservation())
    await changeReservation(db, "emp-1", BIZ, "res-1", { action: "complete", finalPaymentMethod: "TARJETA" })
    expect(created.cash).toHaveLength(0)
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({ method: "CARD", amount: 400, purpose: "RESERVATION", cashMovementId: null })
  })

  it("segunda entrega no duplica la venta ni el dinero (guardia de estado)", async () => {
    const { db, created } = fakeDb(reservation())
    await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "EFECTIVO" })
    const again = await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "EFECTIVO" })
    expect(again.changed).toBe(false)
    expect(created.sales).toHaveLength(1)
    expect(created.saleItems).toHaveLength(1)
    expect(created.payments).toHaveLength(1)
    expect(created.cash).toHaveLength(1)
  })

  it("cancelar no crea venta y repone el stock", async () => {
    const { db, tx, created } = fakeDb(reservation({ status: "PENDING" }))
    const result = await changeReservation(db, "cust-1", BIZ, "res-1", { action: "cancel" })
    expect(result.changed).toBe(true)
    expect(result.saleId).toBeNull()
    expect(created.sales).toHaveLength(0)
    expect(created.payments).toHaveLength(0)
    expect(tx.branchStock.upsert).toHaveBeenCalled()
    expect(created.inventory[0]).toMatchObject({ type: "IN", quantity: 2 })
  })

  it("expirar por el proceso del sistema tampoco crea venta", async () => {
    const { db, created } = fakeDb(reservation({ status: "PENDING", expiresAt: new Date(0) }))
    const result = await changeReservation(db, null, BIZ, "res-1", { action: "expire" })
    expect(result.changed).toBe(true)
    expect(created.sales).toHaveLength(0)
    expect(created.payments).toHaveLength(0)
    expect(created.cash).toHaveLength(0)
  })

  it("una reserva ya terminal rechaza la entrega sin crear venta", async () => {
    const { db, created } = fakeDb(reservation({ status: "CANCELLED" }))
    await expect(changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "EFECTIVO" }))
      .rejects.toMatchObject({ status: 409 })
    expect(created.sales).toHaveLength(0)
  })

  it("reserva a CREDITO: la entrega documenta Payment CREDIT sin volver a endeudar", async () => {
    const { db, created } = fakeDb(reservation({ paymentMethod: "CREDIT" }))
    // La deuda se creó al reservar; la entrega solo asienta el documento.
    const result = await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver" })
    expect(result.saleId).toBe("sale-1")
    expect(created.credit).toHaveLength(0)
    expect(created.cash).toHaveLength(0)
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({ method: "CREDIT", amount: 400, purpose: "RESERVATION", reference: "res-1" })
  })

  it("entrega convertida a CREDIT crea la deuda una vez y su Payment CREDIT", async () => {
    const { db, created } = fakeDb(reservation({ paymentMethod: "STORE" }))
    await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "CREDIT" })
    expect(created.credit).toHaveLength(1)
    expect(created.credit[0]).toMatchObject({ type: "DEBT", amount: 400, referenceType: "RESERVATION", referenceId: "res-1" })
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({ method: "CREDIT", amount: 400, purpose: "RESERVATION" })
    expect(created.cash).toHaveLength(0)
  })

  it("reserva DEPOSIT: dos Payments — anticipo TRANSFER con comprobante + saldo en entrega", async () => {
    const { db, created } = fakeDb(reservation({
      type: "DEPOSIT", status: "DEPOSIT_VERIFIED", paymentMethod: "TRANSFER",
      depositAmount: 150, depositPaid: true, paymentProofUrl: "uploads/private/proof-1.png",
    }))
    const result = await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "EFECTIVO" })

    expect(created.sales[0]).toMatchObject({ total: 400, status: "COMPLETED" })
    expect(created.payments).toHaveLength(2)
    // El anticipo ya cobrado: transferencia con su comprobante, sin caja.
    expect(created.payments[0]).toMatchObject({
      saleId: "sale-1", purpose: "RESERVATION", reference: "res-1",
      method: "TRANSFER", amount: 150, status: "CONFIRMED",
      proofUrl: "uploads/private/proof-1.png",
    })
    // El saldo al entregar: efectivo ligado al único cashMovement.
    expect(created.payments[1]).toMatchObject({
      saleId: "sale-1", purpose: "RESERVATION", reference: "res-1",
      method: "CASH", amount: 250, status: "CONFIRMED", cashMovementId: "cash-1",
    })
    expect(created.cash).toHaveLength(1)
    expect(created.cash[0]).toMatchObject({ type: "IN", amount: 250 })
    // Los Payments cubren exactamente el total del documento.
    const paid = created.payments.reduce((sum, p) => sum + (p.amount as number), 0)
    expect(paid).toBe(created.sales[0].total)
    expect(result.reservation.status).toBe("COMPLETED")
  })

  it("reserva DEPOSIT con saldo a CREDIT: anticipo TRANSFER + Payment CREDIT y una sola deuda", async () => {
    const { db, created } = fakeDb(reservation({
      type: "DEPOSIT", status: "DEPOSIT_VERIFIED", paymentMethod: "TRANSFER",
      depositAmount: 150, depositPaid: true, paymentProofUrl: "uploads/private/proof-1.png",
    }))
    await changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "CREDIT" })
    expect(created.payments).toHaveLength(2)
    expect(created.payments[0]).toMatchObject({ method: "TRANSFER", amount: 150 })
    expect(created.payments[1]).toMatchObject({ method: "CREDIT", amount: 250 })
    expect(created.credit).toHaveLength(1)
    expect(created.credit[0]).toMatchObject({ type: "DEBT", amount: 250, referenceId: "res-1" })
    expect(created.cash).toHaveLength(0)
  })

  it("una reserva expirada no puede entregarse ni genera venta", async () => {
    const { db, created } = fakeDb(reservation({ expiresAt: new Date(0) }))
    await expect(changeReservation(db, "admin-1", BIZ, "res-1", { action: "deliver", finalPaymentMethod: "EFECTIVO" }))
      .rejects.toMatchObject({ status: 409 })
    expect(created.sales).toHaveLength(0)
    expect(created.cash).toHaveLength(0)
  })
})
