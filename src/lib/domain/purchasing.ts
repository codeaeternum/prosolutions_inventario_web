import { createHash } from "node:crypto"
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
    const branch = await resolveBranch(tx, input.branchId, businessId)
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

    // Folio por negocio (no global): MAX(number) del tenant + 1. Seguro porque
    // operation() corre Serializable y reintenta ante conflicto; la restricción
    // @@unique([businessId, number]) es la red de seguridad. El autoincrement
    // del schema queda como fallback inerte para inserts que no fijen number.
    const agg = await tx.purchase.aggregate({ where: { businessId }, _max: { number: true } })
    const purchase = await tx.purchase.create({
      data: {
        businessId,
        number: (agg._max.number ?? 0) + 1,
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

const updateDraftSchema = createSchema.omit({ idempotencyKey: true })

/**
 * Edita una OC que sigue en DRAFT (items, proveedor, sucursal, notas, fecha
 * promesa). Antes solo se podía cancelar y recapturar, lo que ensuciaba folios
 * y dejaba OCs canceladas por errores de captura.
 */
export async function updatePurchaseDraft(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = updateDraftSchema.parse(raw)
  // La llave deriva del contenido: reenviar el mismo formulario (doble clic,
  // reintento de red) repite la misma edición una sola vez.
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)
  return operation(db, {
    key: `purchase-update:${id}:${digest}`,
    actorId, businessId, kind: "PURCHASE_UPDATE", permission: "staff", payload: { id, ...input },
  }, async tx => {
    const purchase = await tx.purchase.findFirst({ where: { id, businessId }, select: { id: true, status: true, number: true } })
    if (!purchase) throw new BusinessError("Orden de compra no encontrada.", 404)
    if (purchase.status !== "DRAFT") throw new BusinessError("Solo se puede editar una orden en borrador.", 409)

    const branch = await resolveBranch(tx, input.branchId, businessId)
    if (branch.businessId !== businessId) throw new BusinessError("La sucursal no pertenece a este negocio.", 409)
    const supplier = input.supplierId
      ? await tx.supplier.findFirst({ where: { id: input.supplierId, businessId, isActive: true } })
      : null
    if (input.supplierId && !supplier) throw new BusinessError("Proveedor no encontrado o inactivo.", 404)

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

    const changed = await tx.purchase.updateMany({
      where: { id: purchase.id, status: "DRAFT" },
      data: { supplierId: supplier?.id ?? null, branchId: branch.id, notes: input.notes || null, dueAt, totalCents },
    })
    if (changed.count !== 1) throw new BusinessError("La compra cambió durante la operación; reintenta.", 409)
    await tx.purchaseItem.deleteMany({ where: { purchaseId: purchase.id } })
    await tx.purchaseItem.createMany({ data: lines.map(l => ({ ...l, purchaseId: purchase.id })) })
    return { purchaseId: purchase.id, folio: purchaseFolio(purchase.number), totalCents }
  })
}

const receiveLineSchema = z.object({
  purchaseItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(100000),
})
const statusSchema = z.object({
  action: z.enum(["ORDER", "RECEIVE", "RECEIVE_PARTIAL", "CANCEL"]),
  idempotencyKey: operationKeySchema,
  // Solo RECEIVE_PARTIAL: líneas y unidades que llegaron en esta entrega.
  items: z.array(receiveLineSchema).min(1).max(200).nullish(),
})
const TARGET: Record<Exclude<z.infer<typeof statusSchema>["action"], "RECEIVE_PARTIAL">, PurchaseStatus> = {
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
 * RECEIVE cubre todo lo pendiente de todas las líneas; RECEIVE_PARTIAL recibe
 * solo lo capturado por línea y la OC sigue ORDERED hasta completarse (la UI
 * deriva "parcial" de receivedQty vs quantity, no hay estado extra).
 */
export async function setPurchaseStatus(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = statusSchema.parse(raw)
  const partial = input.action === "RECEIVE_PARTIAL"
  if (partial && !input.items?.length) {
    throw new BusinessError("Indica las líneas y cantidades que llegaron del proveedor.", 400)
  }
  const target = input.action === "RECEIVE_PARTIAL" ? null : TARGET[input.action]
  // Productos que entran al recibir: la alerta de stock bajo se sincroniza
  // post-commit (subir stock también sirve para limpiar flags y rearmarla).
  const receivedProductIds: string[] = []
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: partial ? "PURCHASE_RECEIVE" : "PURCHASE_STATUS", permission: "staff", payload: { id, ...input } }, async tx => {
    const purchase = await tx.purchase.findFirst({
      where: { id, businessId },
      include: { items: true, branch: { select: { id: true, name: true } } },
    })
    if (!purchase) throw new BusinessError("Orden de compra no encontrada.", 404)
    if (partial) {
      // Recibir parcial solo aplica a una OC pedida al proveedor; cuando la
      // entrega la completa termina en RECEIVED dentro de esta misma acción.
      if (purchase.status !== "ORDERED") {
        throw new BusinessError(`No se puede recibir mercancía: la compra está en estado ${STATUS_LABEL[purchase.status]}.`, 409)
      }
    } else if (target === null || !ALLOWED[purchase.status].includes(target)) {
      throw new BusinessError(`No se puede aplicar la acción: la compra está en estado ${STATUS_LABEL[purchase.status]}.`, 409)
    }

    const folio = purchaseFolio(purchase.number)
    // Líneas a recibir { item, qty }: RECEIVE cubre lo pendiente de todas las
    // líneas; RECEIVE_PARTIAL solo lo capturado, validado contra lo pendiente.
    let lines: { item: (typeof purchase.items)[number]; qty: number }[] = []
    if (partial) {
      const byId = new Map(purchase.items.map(i => [i.id, i]))
      const merged = new Map<string, number>()
      for (const line of input.items ?? []) {
        if (!byId.has(line.purchaseItemId)) {
          throw new BusinessError("Una línea de la entrega no pertenece a esta orden de compra.", 409)
        }
        merged.set(line.purchaseItemId, (merged.get(line.purchaseItemId) ?? 0) + line.quantity)
      }
      lines = [...merged].map(([itemId, qty]) => {
        const item = byId.get(itemId)!
        const pendingQty = item.quantity - item.receivedQty
        if (qty > pendingQty) {
          throw new BusinessError(`La cantidad a recibir excede lo pendiente de una línea (${pendingQty} pendiente${pendingQty === 1 ? "" : "s"}).`, 409)
        }
        return { item, qty }
      })
    } else if (target === "RECEIVED") {
      lines = purchase.items
        .map(item => ({ item, qty: item.quantity - item.receivedQty }))
        .filter(l => l.qty > 0)
    }

    const qtyByItem = new Map(lines.map(l => [l.item.id, l.qty]))
    const pendingAfter = (item: (typeof purchase.items)[number]) => item.quantity - (item.receivedQty + (qtyByItem.get(item.id) ?? 0))
    const complete = purchase.items.every(i => pendingAfter(i) <= 0)
    const reason = `Compra ${folio}${partial && !complete ? " (parcial)" : ""}`

    for (const { item, qty } of lines) {
      // Guardia anti sobre-recibo: solo incrementa si sigue habiendo pendiente.
      const claimed = await tx.purchaseItem.updateMany({
        where: { id: item.id, purchaseId: purchase.id, receivedQty: { lte: item.quantity - qty } },
        data: { receivedQty: { increment: qty } },
      })
      if (claimed.count !== 1) throw new BusinessError("Las cantidades recibidas cambiaron durante la operación; reintenta.", 409)
      await releaseStock(tx, { productId: item.productId, quantity: qty, branchId: purchase.branchId, businessId })
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
          quantity: qty,
          previousStock: updated.stock - qty,
          newStock: updated.stock,
          reason,
          unitPrice: amount(item.unitCostCents),
          totalPrice: amount(item.unitCostCents * qty),
          businessVersion: 1,
          branchId: purchase.branchId,
        },
      })
    }

    const finalStatus: PurchaseStatus = target ?? (complete ? "RECEIVED" : "ORDERED")
    const changed = await tx.purchase.updateMany({
      where: { id: purchase.id, status: purchase.status },
      data: { status: finalStatus, ...(finalStatus === "RECEIVED" ? { receivedAt: new Date() } : {}) },
    })
    if (changed.count !== 1) throw new BusinessError("La compra cambió durante la operación; reintenta.", 409)
    return {
      purchaseId: purchase.id,
      number: purchase.number,
      folio,
      status: finalStatus,
      branchName: purchase.branch.name,
      received: lines.map(l => ({ productId: l.item.productId, qty: l.qty })),
      remaining: purchase.items.reduce((sum, i) => sum + Math.max(pendingAfter(i), 0), 0),
      ...(partial && !complete
        ? {
            partial: true,
            pendingItems: purchase.items
              .filter(i => pendingAfter(i) > 0)
              .map(i => ({ purchaseItemId: i.id, productId: i.productId, pending: pendingAfter(i) })),
          }
        : {}),
    }
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
