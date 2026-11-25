import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PrismaClient } from "@/generated/prisma/client"

vi.mock("@/lib/low-stock", () => ({
  syncLowStockAlerts: vi.fn(async () => undefined),
}))

import { setPurchaseStatus } from "@/lib/domain/purchasing"

/**
 * Guard de cancelación de OC (auditoría D3): una orden ORDERED con recepciones
 * parciales ya metió stock al inventario y una con abonos vigentes ya
 * comprometió dinero — cancelarla como transición de estado pura no revierte
 * ni uno ni otro: el stock queda inflado sin rastro y el pasivo sale de la
 * cuenta por pagar sin resolverse. El dominio bloquea con 409 y orienta la
 * salida operativa (devolución a proveedor como salida de inventario /
 * anulación de abonos). Los borradores nunca tienen recepciones ni abonos, así
 * que su cancelación sigue libre.
 */
const BIZ = "biz-purchase-cancel"
let seq = 0
const key = () => `purchase-cancel-${++seq}`

interface PurchaseFixture {
  status: "DRAFT" | "ORDERED"
  receivedQty?: number
  paidCents?: number
}

function buildMockDb(fixture: PurchaseFixture) {
  const tx = {
    user: {
      findUnique: vi.fn(async () => ({ id: "admin-1", role: "ADMIN", status: "APPROVED", businessId: BIZ })),
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
        status: fixture.status,
        branchId: "branch-1",
        totalCents: 25000,
        paidCents: fixture.paidCents ?? 0,
        branch: { id: "branch-1", name: "Principal" },
        items: [
          {
            id: "pi-1",
            purchaseId: "pur-1",
            productId: "prod-1",
            quantity: 5,
            receivedQty: fixture.receivedQty ?? 0,
            unitCostCents: 5000,
          },
        ],
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    purchaseItem: { updateMany: vi.fn(async () => ({ count: 1 })) },
    branch: { findFirst: vi.fn(async () => ({ id: "branch-1", isActive: true, businessId: BIZ })) },
    branchStock: { upsert: vi.fn(async () => ({})) },
    product: {
      findFirst: vi.fn(async () => ({ id: "prod-1", businessId: BIZ })),
      findUnique: vi.fn(async () => ({ id: "prod-1", businessId: BIZ, costPrice: 0 })),
      update: vi.fn(async () => ({ id: "prod-1", stock: 5 })),
    },
    priceHistory: { create: vi.fn(async () => ({})) },
    inventoryMovement: { create: vi.fn(async () => ({ id: "mov-1" })) },
  }
  const db = {
    $transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx),
  } as unknown as PrismaClient
  return { db, tx }
}

const cancel = (db: PrismaClient) =>
  setPurchaseStatus(db, "admin-1", BIZ, "pur-1", { action: "CANCEL", idempotencyKey: key() })

describe("setPurchaseStatus CANCEL — guard de OC comprometida", () => {
  beforeEach(() => vi.clearAllMocks())

  it("bloquea cancelar una OC con recepciones parciales: el stock ya entró al inventario", async () => {
    const { db, tx } = buildMockDb({ status: "ORDERED", receivedQty: 2 })

    await expect(cancel(db)).rejects.toMatchObject({
      name: "BusinessError",
      status: 409,
      message: expect.stringContaining("2 unidades recibidas"),
    })
    // La orden NO cambió de estado y nada tocó inventario.
    expect(tx.purchase.updateMany).not.toHaveBeenCalled()
    expect(tx.branchStock.upsert).not.toHaveBeenCalled()
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
  })

  it("el mensaje orienta la salida operativa (devolución al proveedor como salida de inventario)", async () => {
    const { db } = buildMockDb({ status: "ORDERED", receivedQty: 2 })

    await expect(cancel(db)).rejects.toMatchObject({
      message: expect.stringContaining("devolución al proveedor"),
    })
  })

  it("bloquea cancelar una OC con abonos vigentes aunque no haya recepciones", async () => {
    const { db, tx } = buildMockDb({ status: "ORDERED", receivedQty: 0, paidCents: 5000 })

    await expect(cancel(db)).rejects.toMatchObject({
      name: "BusinessError",
      status: 409,
      message: expect.stringContaining("abonos vigentes por 50.00"),
    })
    expect(tx.purchase.updateMany).not.toHaveBeenCalled()
  })

  it("el mensaje de abonos indica que deben anularse primero", async () => {
    const { db } = buildMockDb({ status: "ORDERED", receivedQty: 0, paidCents: 5000 })

    await expect(cancel(db)).rejects.toMatchObject({
      message: expect.stringContaining("Anúlalos primero"),
    })
  })

  it("permite cancelar una OC ORDERED limpia (sin recepciones ni abonos)", async () => {
    const { db, tx } = buildMockDb({ status: "ORDERED" })

    const result = await cancel(db)
    expect(result.status).toBe("CANCELLED")
    expect(tx.purchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED" }),
    }))
    // Cancelar nunca movió stock: sin recepciones no hay movimientos IN.
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
    expect(tx.branchStock.upsert).not.toHaveBeenCalled()
  })

  it("la cancelación de borradores sigue libre (un DRAFT no puede tener recepciones ni abonos)", async () => {
    const { db } = buildMockDb({ status: "DRAFT", receivedQty: 0, paidCents: 0 })

    const result = await cancel(db)
    expect(result.status).toBe("CANCELLED")
  })

  it("el guard usa la suma de TODAS las líneas, no solo la primera", async () => {
    const { db, tx } = buildMockDb({ status: "ORDERED", receivedQty: 0 })
    // Segunda línea con recepción parcial: la primera en 0 no debe esconderla.
    tx.purchase.findFirst = vi.fn(async () => ({
      id: "pur-1",
      businessId: BIZ,
      number: 7,
      status: "ORDERED",
      branchId: "branch-1",
      totalCents: 25000,
      paidCents: 0,
      branch: { id: "branch-1", name: "Principal" },
      items: [
        { id: "pi-1", purchaseId: "pur-1", productId: "prod-1", quantity: 5, receivedQty: 0, unitCostCents: 5000 },
        { id: "pi-2", purchaseId: "pur-1", productId: "prod-2", quantity: 4, receivedQty: 1, unitCostCents: 5000 },
      ],
    }))

    await expect(cancel(db)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("1 unidad recibida"),
    })
    expect(tx.purchase.updateMany).not.toHaveBeenCalled()
  })
})
