import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

// low-stock cuelga de la cadena next-auth/notificaciones: la alerta post-commit
// es ajena al contrato probado aquí, se sustituye por un no-op.
vi.mock("@/lib/low-stock", () => ({
  collectLowStockIds: (items: { productId: string }[]) => items.map(i => i.productId),
  syncLowStockAlerts: vi.fn(async () => {}),
}))

import { sell } from "@/lib/domain/sales"

/**
 * Sale.kind — separación contable de la "nota de venta a taller" (WORKSHOP)
 * vs el ticket de mostrador al público (RETAIL). El dominio corre de verdad
 * sobre un tx falso: db.$transaction entrega el tx mock y los asserts miran
 * el kind persistido y la lista de precio cobrada (mayoreo en taller).
 */

const BIZ = "biz-kind-test"
const admin = { id: "admin-1", name: "Admin", role: "ADMIN", status: "APPROVED", businessId: BIZ, homeBranchId: null }
const branch = { id: "branch-1", name: "Sucursal 1", isActive: true, businessId: BIZ }
const product = { id: "prod-1", businessId: BIZ, name: "Pantalla A32", isActive: true, stock: 10, retailPrice: 500, wholesalePrice: 350 }
let seq = 0
const key = () => `sale-kind-key-${++seq}`

const customer = (customerType: "NORMAL" | "STORE" | "TECHNICIAN") => ({
  id: "cust-1", name: "Taller Hermanos", role: "CUSTOMER", status: "APPROVED",
  businessId: BIZ, customerType, businessName: "Taller Hermanos S.A.",
})

/** Réplica mínima del flujo de sell(): actor, sucursal, stock con guards y asientos. */
function fakeDb(opts: { customer?: Record<string, unknown> | null } = {}) {
  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "cust-1" ? (opts.customer ?? null) : admin),
    },
    branch: { findFirst: vi.fn(async () => branch) },
    product: {
      findFirst: vi.fn(async () => product),
      findUniqueOrThrow: vi.fn(async () => ({ ...product, stock: 9 })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    branchStock: { updateMany: vi.fn(async () => ({ count: 1 })) },
    sale: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "sale-1", number: 7, ...data })) },
    saleItem: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "si-1", ...data })) },
    inventoryMovement: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "mv-1", ...data })) },
    payment: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "pay-1", ...data })) },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
  }
  // Tarjeta: no toca caja, así el mock no necesita cashRegister/cashMovement.
  const db = { $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) }
  return { db: db as unknown as PrismaClient, tx }
}

const input = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: "prod-1", quantity: 1 }],
  paymentMethod: "TARJETA",
  branchId: "branch-1",
  idempotencyKey: key(),
  ...over,
})

describe("Sale.kind — nota de venta a taller", () => {
  it("cliente STORE documenta WORKSHOP y cobra mayoreo sin pedirlo", async () => {
    const { db, tx } = fakeDb({ customer: customer("STORE") })
    const result = await sell(db, "admin-1", BIZ, input({ customerId: "cust-1", items: [{ productId: "prod-1", quantity: 2 }] }))
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "WORKSHOP" }),
    }))
    expect(result.kind).toBe("WORKSHOP")
    expect(result.sale.kind).toBe("WORKSHOP")
    // 2 × $350 mayoreo (el retail de $500 no aplica a cliente taller).
    expect(result.total).toBe(700)
    expect(result.sale.total).toBe(700)
    expect(tx.saleItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unitPrice: 350 }),
    }))
  })

  it("cliente TECHNICIAN también documenta WORKSHOP a mayoreo", async () => {
    const { db, tx } = fakeDb({ customer: customer("TECHNICIAN") })
    const result = await sell(db, "admin-1", BIZ, input({ customerId: "cust-1" }))
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "WORKSHOP" }),
    }))
    expect(result.kind).toBe("WORKSHOP")
    expect(result.sale.total).toBe(350)
  })

  it("workshopSale fuerza mayoreo a un cliente NORMAL (walk-in de taller)", async () => {
    const { db, tx } = fakeDb({ customer: customer("NORMAL") })
    const result = await sell(db, "admin-1", BIZ, input({ customerId: "cust-1", workshopSale: true }))
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "WORKSHOP" }),
    }))
    expect(result.kind).toBe("WORKSHOP")
    expect(result.sale.total).toBe(350)
    expect(tx.saleItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ unitPrice: 350 }),
    }))
  })

  it("workshopSale sin cliente también emite la nota a mayoreo", async () => {
    const { db, tx } = fakeDb()
    const result = await sell(db, "admin-1", BIZ, input({ workshopSale: true }))
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "WORKSHOP", customerId: null }),
    }))
    expect(result.sale.total).toBe(350)
  })

  it("sin cliente ni bandera la venta queda RETAIL a precio público", async () => {
    const { db, tx } = fakeDb()
    const result = await sell(db, "admin-1", BIZ, input())
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "RETAIL" }),
    }))
    expect(result.kind).toBe("RETAIL")
    expect(result.sale.total).toBe(500)
  })

  it("cliente NORMAL sin bandera sigue en RETAIL aunque tenga cuenta", async () => {
    const { db, tx } = fakeDb({ customer: customer("NORMAL") })
    const result = await sell(db, "admin-1", BIZ, input({ customerId: "cust-1" }))
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "RETAIL" }),
    }))
    expect(result.sale.total).toBe(500)
  })

  it("priceTier explícito manda sobre el mayoreo de la nota a taller", async () => {
    const { db, tx } = fakeDb({ customer: customer("STORE") })
    const result = await sell(db, "admin-1", BIZ, input({ customerId: "cust-1", priceTier: "retail" }))
    // El documento sigue siendo de taller; la lista forzada es la del público.
    expect(tx.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "WORKSHOP" }),
    }))
    expect(result.sale.total).toBe(500)
  })
})
