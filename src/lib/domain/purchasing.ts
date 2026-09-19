import type { PrismaClient, PurchaseStatus } from "@prisma/client"
import { z } from "zod"
import { amount, BusinessError, operation, operationKeySchema, releaseStock, resolveBranch } from "./operations"
import { syncLowStockAlerts } from "../low-stock"

/** Folio público de una orden de compra: OC-000001. */
export function purchaseFolio(number: number): string {
  return `OC-${String(number).padStart(6, "0")}`
}

const purchaseItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(100000),
  unitCostCents: z.number().int().min(0).max(100000000),
})
const createSchema = z.object({
  idempotencyKey: operationKeySchema,
  supplierId: z.string().min(1).nullish(),
  branchId: z.string().min(1),
  notes: z.string().trim().max(1000).optional(),
  // Fecha promesa de pago al proveedor, YYYY-MM-DD (como la emite <input type="date">).
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha promesa inválida").nullish(),
  items: z.array(purchaseItemSchema).min(1).max(200),
})

/** Crea una orden de compra en DRAFT. El total lo calcula el servidor. */
export async function createPurchase(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = createSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "PURCHASE_CREATE", permission: "staff", payload: input }, async tx => {
    const branch = await resolveBranch(tx, input.branchId)
    if (branch.businessId !== businessId) throw new BusinessError("La sucursal no pertenece a este negocio.", 409)
    const supplier = input.supplierId
      ? await tx.supplier.findFirst({ where: { id: input.supplierId, businessId, isActive: true } })
      : null
    if (input.supplierId && !supplier) throw new BusinessError("Proveedor no encontrado o inactivo.", 404)

    // Se guarda al mediodía UTC para que en cualquier zona horaria de México
    // (UTC-6 a UTC-8) la fecha mostrada sea la misma que capturó el usuario.
    const dueAt = input.dueAt ? new Date(`${input.dueAt}T12:00:00.000Z`) : null
    if (dueAt && Number.isNaN(dueAt.getTime())) throw new BusinessError("Fecha promesa inválida.", 400)

    const lines = []
    let totalCents = 0
    for (const item of input.items) {
      const product = await tx.product.findFirst({ where: { id: item.productId, businessId } })
      if (!product || !product.isActive) throw new BusinessError("Un producto de la compra no está disponible.", 409)
      lines.push({ businessId, productId: product.id, quantity: item.quantity, unitCostCents: item.unitCostCents })
      totalCents += item.unitCostCents * item.quantity
    }

    const purchase = await tx.purchase.create({
      data: {
        businessId,
        branchId: branch.id,
        supplierId: supplier?.id ?? null,
        notes: input.notes || null,
        dueAt,
        totalCents,
        createdById: actorId,
        items: { create: lines },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, barcode: true } } } },
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    })
    return { purchase, folio: purchaseFolio(purchase.number) }
  })
}

const statusSchema = z.object({
  action: z.enum(["ORDER", "RECEIVE", "CANCEL"]),
  idempotencyKey: operationKeySchema,
})
const TARGET: Record<z.infer<typeof statusSchema>["action"], PurchaseStatus> = {
  ORDER: "ORDERED",
  RECEIVE: "RECEIVED",
  CANCEL: "CANCELLED",
}
const ALLOWED: Record<PurchaseStatus, PurchaseStatus[]> = {
  DRAFT: ["ORDERED", "CANCELLED"],
  ORDERED: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
}
const STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: "borrador",
  ORDERED: "ordenada",
  RECEIVED: "recibida",
  CANCELLED: "cancelada",
}

/**
 * Avanza el estado de la orden: DRAFT→ORDERED→RECEIVED, o CANCEL desde
 * DRAFT/ORDERED. Al recibir entra el stock a purchase.branchId con el mismo
 * efecto que moveInventory IN y actualiza product.costPrice al último costo.
 */
export async function setPurchaseStatus(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = statusSchema.parse(raw)
  const target = TARGET[input.action]
  // Productos que entran al recibir: la alerta de stock bajo se sincroniza
  // post-commit (subir stock también sirve para limpiar flags y rearmarla).
  const receivedProductIds: string[] = []
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "PURCHASE_STATUS", permission: "staff", payload: { id, ...input } }, async tx => {
    const purchase = await tx.purchase.findFirst({
      where: { id, businessId },
      include: { items: true, branch: { select: { id: true, name: true } } },
    })
    if (!purchase) throw new BusinessError("Orden de compra no encontrada.", 404)
    if (!ALLOWED[purchase.status].includes(target)) {
      throw new BusinessError(`No se puede aplicar la acción: la compra está en estado ${STATUS_LABEL[purchase.status]}.`, 409)
    }

    if (target === "RECEIVED") {
      const folio = purchaseFolio(purchase.number)
      for (const item of purchase.items) {
        await releaseStock(tx, { productId: item.productId, quantity: item.quantity, branchId: purchase.branchId, businessId })
        receivedProductIds.push(item.productId)
        // costPrice existe en Product: queda como "último costo" conocido.
        const data: { costPrice?: number } = item.unitCostCents > 0 ? { costPrice: amount(item.unitCostCents) } : {}
        const updated = await tx.product.update({ where: { id: item.productId }, data })
        await tx.inventoryMovement.create({
          data: {
            businessId,
            productId: item.productId,
            userId: actorId,
            type: "IN",
            quantity: item.quantity,
            previousStock: updated.stock - item.quantity,
            newStock: updated.stock,
            reason: `Compra ${folio}`,
            unitPrice: amount(item.unitCostCents),
            totalPrice: amount(item.unitCostCents * item.quantity),
            businessVersion: 1,
            branchId: purchase.branchId,
          },
        })
      }
    }

    const changed = await tx.purchase.updateMany({
      where: { id: purchase.id, status: purchase.status },
      data: { status: target, ...(target === "RECEIVED" ? { receivedAt: new Date() } : {}) },
    })
    if (changed.count !== 1) throw new BusinessError("La compra cambió durante la operación; reintenta.", 409)
    return { purchaseId: purchase.id, number: purchase.number, folio: purchaseFolio(purchase.number), status: target, branchName: purchase.branch.name }
  })
  await syncLowStockAlerts(db, businessId, receivedProductIds)
  return result
}

export function listPurchases(db: PrismaClient, businessId: string, status?: PurchaseStatus) {
  return db.purchase.findMany({
    where: { businessId, ...(status ? { status } : {}) },
    include: {
      supplier: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true, barcode: true } } } },
      supplierPayments: {
        select: {
          id: true, amountCents: true, method: true, notes: true, createdAt: true,
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: [{ createdAt: "desc" }, { number: "desc" }],
    take: 200,
  })
}

export function listSuppliers(db: PrismaClient, businessId: string) {
  return db.supplier.findMany({
    where: { businessId },
    include: { _count: { select: { purchases: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  })
}
