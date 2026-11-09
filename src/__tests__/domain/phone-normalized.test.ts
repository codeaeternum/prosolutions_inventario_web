import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { linkCustomerByPhone } from "@/lib/domain/customers"
import { createRepair } from "@/lib/domain/workshop"

/**
 * Ligadura de cuentas por teléfono (User.phoneNormalized) y escritura de los
 * espejos normalizados en RepairOrder (customerPhoneNormalized /
 * customerPhoneAltNormalized). La normalización es la de lib/utils:
 * solo dígitos, últimos 10.
 */

const tx = {
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  businessOperation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  repairOrder: { create: vi.fn() },
  repairEvent: { create: vi.fn() },
  branch: { findFirst: vi.fn() },
  business: { findUnique: vi.fn() },
}
const db = { $transaction: vi.fn((work: (t: unknown) => unknown) => work(tx)) } as unknown as PrismaClient

const staff = { id: "u-staff", name: "Mostrador", role: "EMPLOYEE", status: "APPROVED", businessId: "biz-1" }

beforeEach(() => {
  vi.clearAllMocks()
  tx.user.findUnique.mockResolvedValue(staff)
  // linkCustomerByPhone también usa user.findFirst (role CUSTOMER): en los
  // tests de createRepair no hay cliente que ligar.
  tx.user.findFirst.mockImplementation(({ where }: { where: { role?: unknown } }) =>
    Promise.resolve(where.role === "CUSTOMER" ? null : staff))
  tx.businessOperation.findUnique.mockResolvedValue(null)
  tx.businessOperation.create.mockResolvedValue({ id: "op-1" })
  tx.businessOperation.update.mockResolvedValue({})
  tx.branch.findFirst.mockResolvedValue({ id: "b1", name: "Centro" })
  tx.business.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id }))
  tx.repairOrder.create.mockImplementation(({ data }) => Promise.resolve({ id: "o1", number: 9, quoteCents: null, approvedQuoteCents: null, partnerPriceCents: null, ...data }))
  tx.repairEvent.create.mockResolvedValue({})
  // nextOrderNumber(): UPSERT sobre BusinessCounter vía $queryRaw → n = 9.
  tx.$queryRaw.mockResolvedValue([{ n: 9 }])
})

describe("linkCustomerByPhone", () => {
  // El dominio recibe el cliente transaccional (o el cliente completo): el
  // fake `tx` implementa justo lo que la función toca.
  const txDb = tx as unknown as PrismaClient

  it("busca por phoneNormalized indexado — sin barrido de clientes", async () => {
    tx.user.findFirst.mockResolvedValue({ id: "cust-1" })
    const id = await linkCustomerByPhone(txDb, "biz-1", "+52 1 (811) 234-5678")
    expect(id).toBe("cust-1")
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: { businessId: "biz-1", role: "CUSTOMER", phoneNormalized: "8112345678" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
  })

  it("normaliza el teléfono antes de consultar (últimos 10 dígitos)", async () => {
    tx.user.findFirst.mockResolvedValue(null)
    await linkCustomerByPhone(txDb, "biz-1", "+52 811 234 5678")
    const where = (tx.user.findFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where
    expect(where.phoneNormalized).toBe("8112345678")
  })

  it("devuelve null sin tocar la BD cuando el número es demasiado corto", async () => {
    expect(await linkCustomerByPhone(txDb, "biz-1", "55-1234")).toBeNull()
    expect(await linkCustomerByPhone(txDb, "biz-1", "")).toBeNull()
    expect(await linkCustomerByPhone(txDb, "biz-1", null)).toBeNull()
    expect(await linkCustomerByPhone(txDb, "biz-1", undefined)).toBeNull()
    expect(tx.user.findFirst).not.toHaveBeenCalled()
  })

  it("null cuando ningún cliente del tenant empató", async () => {
    tx.user.findFirst.mockResolvedValue(null)
    expect(await linkCustomerByPhone(txDb, "biz-1", "8112345678")).toBeNull()
  })
})

describe("createRepair escribe los espejos normalizados", () => {
  const baseInput = {
    idempotencyKey: "op-create-1",
    customerName: "Ana López",
    equipmentType: "Celular",
    reportedIssue: "No enciende",
    intakeBranchId: "b1",
  }
  const createdData = () =>
    (tx.repairOrder.create.mock.calls[0][0] as { data: Record<string, unknown> }).data

  it("persiste customerPhoneNormalized y customerPhoneAltNormalized (últimos 10 dígitos)", async () => {
    await createRepair(db, "u-staff", "biz-1", {
      ...baseInput,
      customerPhone: "+52 1 (811) 234-5678",
      customerPhoneAlt: "667 123 45 67",
    })
    expect(createdData()).toMatchObject({
      customerPhone: "+52 1 (811) 234-5678",
      customerPhoneNormalized: "8112345678",
      customerPhoneAlt: "667 123 45 67",
      customerPhoneAltNormalized: "6671234567",
    })
  })

  it("customerPhoneAltNormalized queda null cuando no hay segundo contacto", async () => {
    await createRepair(db, "u-staff", "biz-1", { ...baseInput, customerPhone: "8112345678" })
    const data = createdData()
    expect(data.customerPhoneNormalized).toBe("8112345678")
    expect(data.customerPhoneAlt).toBeNull()
    expect(data.customerPhoneAltNormalized).toBeNull()
  })

  it("liga customerId por la columna indexada phoneNormalized", async () => {
    tx.user.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.role === "CUSTOMER" && where.phoneNormalized === "8112345678" ? { id: "cust-1" } : staff))
    await createRepair(db, "u-staff", "biz-1", { ...baseInput, customerPhone: "+52 811 234 5678" })
    expect(createdData().customerId).toBe("cust-1")
  })
})
