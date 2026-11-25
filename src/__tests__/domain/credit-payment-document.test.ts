import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@/generated/prisma/client"

// Los avisos Telegram/BD son post-commit y ajenos al contrato del abono.
vi.mock("@/lib/operation-alerts", () => ({ alertSensitiveOperation: vi.fn(async () => {}) }))

import { changeCredit } from "@/lib/domain/credit"

/**
 * Abono de crédito documentado: CreditMovement sigue siendo el asiento de
 * deuda, pero el dinero también queda como Payment CONFIRMED para que
 * "Cobrado por método" pueda conciliarlo. En efectivo el Payment se liga al
 * CashMovement ya existente (una sola entrada de cajón); en tarjeta/SPEI el
 * folio queda en reference y la sucursal operativa en el tag estructurado de
 * notes (deuda técnica documentada: no hay columna branchId en Payment).
 */
const BIZ = "biz-credit-test"
const collector = {
  id: "emp-1", name: "Cobrador", role: "EMPLOYEE", status: "APPROVED", businessId: BIZ, homeBranchId: "branch-1",
}
const customer = {
  id: "cust-1", name: "Taller Ruiz", role: "CUSTOMER", status: "APPROVED", businessId: BIZ,
  creditBalance: 500, creditLimit: 1000,
}
const branch = { id: "branch-1", name: "Matriz", isActive: true, businessId: BIZ }
const register = { id: "reg-1", status: "OPEN", branchId: "branch-1", businessId: BIZ, initialAmount: 0 }
let seq = 0
const key = () => `credit-payment-test-${++seq}`

function fakeDb() {
  const created = {
    cash: [] as Record<string, unknown>[],
    payments: [] as Record<string, unknown>[],
    credit: [] as Record<string, unknown>[],
  }
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === collector.id ? collector : customer),
      findFirst: vi.fn(async () => customer),
      update: vi.fn(async () => ({})),
    },
    branch: { findFirst: vi.fn(async () => branch) },
    cashRegister: {
      findMany: vi.fn(async () => [register]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    creditMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "cm-1", ...data }
        created.credit.push(row)
        return row
      }),
    },
    cashMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "cash-1", ...data }
        created.cash.push(row)
        return row
      }),
    },
    payment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "pay-1", ...data }
        created.payments.push(row)
        return row
      }),
    },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
  }
  const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx, created }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("changeCredit PAYMENT documenta el dinero", () => {
  it("efectivo: crea Payment CASH ligado al único CashMovement del abono", async () => {
    const { db, created } = fakeDb()
    const result = await changeCredit(db, collector.id, BIZ, "PAYMENT", {
      idempotencyKey: key(), userId: customer.id, amount: 200, paymentMethod: "EFECTIVO", branchId: "branch-1",
    })

    expect(result).toMatchObject({ movementId: "cm-1", paymentId: "pay-1", creditBalance: 300 })
    expect(created.cash).toHaveLength(1)
    expect(created.cash[0]).toMatchObject({
      type: "IN", amount: 200, referenceType: "CREDIT_PAYMENT", referenceId: "cm-1",
    })
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({
      purpose: "CREDIT_PAYMENT", method: "CASH", amount: 200, status: "CONFIRMED",
      cashMovementId: "cash-1", createdById: collector.id,
    })
    expect(created.payments[0].notes).toContain("[credit-movement:cm-1]")
    expect(created.payments[0].notes).toContain("[branch:branch-1]")
  })

  it("transferencia: no toca caja, conserva folio SPEI y atribuye la sucursal operativa", async () => {
    const { db, tx, created } = fakeDb()
    await changeCredit(db, collector.id, BIZ, "PAYMENT", {
      idempotencyKey: key(), userId: customer.id, amount: 125.5,
      paymentMethod: "TRANSFERENCIA", reference: "SPEI-9988", notes: "Abono parcial",
    })

    expect(tx.cashMovement.create).not.toHaveBeenCalled()
    expect(created.payments).toHaveLength(1)
    expect(created.payments[0]).toMatchObject({
      purpose: "CREDIT_PAYMENT", method: "TRANSFER", amount: 125.5,
      reference: "SPEI-9988", cashMovementId: null,
    })
    expect(created.payments[0].notes).toContain("Abono de Taller Ruiz")
    expect(created.payments[0].notes).toContain("Abono parcial")
    expect(created.payments[0].notes).toContain("[branch:branch-1]")
    // El asiento de crédito conserva el rastro legible para la ficha del cliente.
    expect(created.credit[0].notes).toContain("Medio: TRANSFERENCIA")
    expect(created.credit[0].notes).toContain("Ref: SPEI-9988")
  })
})
