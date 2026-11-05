import { describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@prisma/client"

vi.mock("@/lib/low-stock", () => ({
  syncLowStockAlerts: vi.fn(async () => undefined),
}))

import { setPurchaseStatus } from "@/lib/domain/purchasing"

const BIZ = "biz-purchase-history"

function buildMockDb(prevCostPrice: number | null) {
  const priceHistoryCreates: Record<string, unknown>[] = []
  const productUpdates: Record<string, unknown>[] = []

  const tx = {
    user: {
      findUnique: vi.fn(async () => ({
        id: "staff-1",
        role: "ADMIN",
        status: "APPROVED",
        businessId: BIZ,
      })),
    },
    businessOperation: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "op-1" })),
      update: vi.fn(async () => ({})),
    },
    purchase: {
      findFirst: vi.fn(async () => ({
        id: "pur-1",
        businessId: BIZ,
        number: 7,
        status: "ORDERED",
        branchId: "branch-1",
        branch: { id: "branch-1", name: "Principal" },
        items: [
          {
            id: "pi-1",
            purchaseId: "pur-1",
            productId: "prod-1",
            quantity: 5,
            receivedQty: 0,
            unitCostCents: 24500,
          },
        ],
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    purchaseItem: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    branch: {
      findFirst: vi.fn(async () => ({ id: "branch-1", isActive: true, businessId: BIZ })),
    },
    branchStock: {
      upsert: vi.fn(async () => ({ quantity: 5 })),
    },
    product: {
      findFirst: vi.fn(async () => ({ id: "prod-1", businessId: BIZ, costPrice: prevCostPrice })),
      findUnique: vi.fn(async () => ({ id: "prod-1", businessId: BIZ, costPrice: prevCostPrice })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        productUpdates.push(data)
        return { id: "prod-1", stock: 15, ...data }
      }),
    },
    priceHistory: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        priceHistoryCreates.push(data)
        return { id: "ph-1", ...data }
      }),
    },
    inventoryMovement: {
      create: vi.fn(async () => ({ id: "mov-1" })),
    },
  }

  const db = {
    $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx),
  } as unknown as PrismaClient

  return { db, priceHistoryCreates, productUpdates }
}

describe("setPurchaseStatus RECEIVE — registro en PriceHistory al cambiar costPrice", () => {
  it("crea asiento en PriceHistory cuando el costo de recepción difiere del costPrice anterior", async () => {
    const { db, priceHistoryCreates, productUpdates } = buildMockDb(200)
    const res = await setPurchaseStatus(db, "staff-1", BIZ, "pur-1", {
      action: "RECEIVE",
      idempotencyKey: "op-purchase-ph-1",
    })

    expect(res.status).toBe("RECEIVED")
    expect(productUpdates).toContainEqual({ costPrice: 245 })
    expect(priceHistoryCreates).toEqual([
      {
        businessId: BIZ,
        productId: "prod-1",
        field: "costPrice",
        oldValue: 200,
        newValue: 245,
        changedById: "staff-1",
      },
    ])
  })

  it("no duplica asiento en PriceHistory cuando el costo recibido es idéntico al actual", async () => {
    const { db, priceHistoryCreates } = buildMockDb(245)
    await setPurchaseStatus(db, "staff-1", BIZ, "pur-1", {
      action: "RECEIVE",
      idempotencyKey: "op-purchase-ph-2",
    })

    expect(priceHistoryCreates).toHaveLength(0)
  })
})
