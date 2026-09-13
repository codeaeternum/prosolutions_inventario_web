import type { CountStatus, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema, resolveBranch } from "./operations"

/** Folio público de un conteo físico: CC-000001. */
export function countFolio(number: number): string {
  return `CC-${String(number).padStart(6, "0")}`
}

const createSchema = z.object({
  idempotencyKey: operationKeySchema,
  branchId: z.string().min(1),
  notes: z.string().trim().max(1000).optional(),
})

/**
 * Abre una sesión de conteo físico en una sucursal. Solo puede haber una OPEN
 * por sucursal a la vez (además del check, la BD tiene el índice único parcial
 * "InventoryCount_one_open" como red de seguridad).
 */
export async function createCount(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = createSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "COUNT_CREATE", permission: "staff", payload: input }, async tx => {
    const branch = await resolveBranch(tx, input.branchId, businessId)
    const open = await tx.inventoryCount.findFirst({
      where: { businessId, branchId: branch.id, status: "OPEN" },
      select: { number: true },
    })
    if (open) {
      throw new BusinessError(`Ya hay un conteo abierto (${countFolio(open.number)}) en ${branch.name}. Aplícalo o cancélalo antes de iniciar otro.`, 409)
    }
    const count = await tx.inventoryCount.create({
      data: { businessId, branchId: branch.id, notes: input.notes || null, createdById: actorId },
      include: { branch: { select: { id: true, name: true } } },
    })
    return { count, folio: countFolio(count.number) }
  })
}

const countItemSchema = z.object({
  productId: z.string().min(1),
  countedQty: z.number().int().min(0).max(1000000),
})
const itemsSchema = z.object({
  idempotencyKey: operationKeySchema,
  items: z.array(countItemSchema).min(1).max(500),
})

/**
 * Captura/actualiza lo contado por producto. expectedQty se toma del
 * BranchStock actual EN EL MOMENTO de capturar (0 si no hay fila): es la foto
 * de "lo que decía el sistema" contra la que se compara lo físico.
 */
export async function setCountItems(db: PrismaClient, actorId: string, businessId: string, countId: string, raw: unknown) {
  const input = itemsSchema.parse(raw)
  // Si el mismo producto llega repetido, gana la última captura.
  const merged = new Map<string, number>()
  for (const row of input.items) merged.set(row.productId, row.countedQty)
  const items = [...merged.entries()].map(([productId, countedQty]) => ({ productId, countedQty }))
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "COUNT_ITEMS", permission: "staff", payload: { countId, items } }, async tx => {
    const count = await tx.inventoryCount.findFirst({ where: { id: countId, businessId }, select: { id: true, status: true, branchId: true } })
    if (!count) throw new BusinessError("Conteo no encontrado.", 404)
    if (count.status !== "OPEN") throw new BusinessError("El conteo ya no está abierto.", 409)
    const saved = []
    for (const item of items) {
      const product = await tx.product.findFirst({ where: { id: item.productId, businessId }, select: { id: true } })
      if (!product) throw new BusinessError("Un producto del conteo no existe en este negocio.", 404)
      const stock = await tx.branchStock.findUnique({
        where: { productId_branchId: { productId: product.id, branchId: count.branchId } },
        select: { quantity: true },
      })
      const expectedQty = stock?.quantity ?? 0
      saved.push(await tx.inventoryCountItem.upsert({
        where: { countId_productId: { countId: count.id, productId: product.id } },
        create: { businessId, countId: count.id, productId: product.id, expectedQty, countedQty: item.countedQty },
        update: { expectedQty, countedQty: item.countedQty },
      }))
    }
    return { countId: count.id, saved: saved.length }
  })
}

const actionSchema = z.object({ idempotencyKey: operationKeySchema })

/**
 * Aplica el conteo: por cada producto con diferencia ajusta el stock de la
 * sucursal al valor contado (absoluto), mueve Product.stock por la diferencia
 * real y deja un InventoryMovement ADJUSTMENT auditado.
 *
 * La diferencia se calcula contra el stock VIVO al aplicar (pudo moverse por
 * ventas/traspasos durante la captura); expectedQty se re-sincroniza a ese
 * valor para que el registro siempre satisfaga diff = countedQty - expectedQty.
 */
export async function applyCount(db: PrismaClient, actorId: string, businessId: string, countId: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "COUNT_APPLY", permission: "staff", payload: { countId } }, async tx => {
    const count = await tx.inventoryCount.findFirst({
      where: { id: countId, businessId },
      include: { items: true, branch: { select: { id: true, name: true } } },
    })
    if (!count) throw new BusinessError("Conteo no encontrado.", 404)
    if (count.status !== "OPEN") throw new BusinessError("El conteo ya no está abierto.", 409)
    if (count.items.length === 0) throw new BusinessError("El conteo no tiene productos capturados.", 409)

    const folio = countFolio(count.number)
    const movements = []
    for (const item of count.items) {
      const stock = await tx.branchStock.findUnique({
        where: { productId_branchId: { productId: item.productId, branchId: count.branchId } },
        select: { quantity: true },
      })
      const current = stock?.quantity ?? 0
      if (current !== item.expectedQty) {
        await tx.inventoryCountItem.update({ where: { id: item.id }, data: { expectedQty: current } })
      }
      const diff = item.countedQty - current
      if (diff === 0) continue
      await tx.branchStock.upsert({
        where: { productId_branchId: { productId: item.productId, branchId: count.branchId } },
        create: { businessId, productId: item.productId, branchId: count.branchId, quantity: item.countedQty },
        update: { quantity: item.countedQty },
      })
      const updated = await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: diff } } })
      movements.push(await tx.inventoryMovement.create({
        data: {
          businessId,
          productId: item.productId,
          userId: actorId,
          // El enum de BD solo tiene ADJUSTMENT; la dirección queda en el
          // delta de previousStock/newStock y en notes.
          type: "ADJUSTMENT",
          quantity: Math.abs(diff),
          previousStock: updated.stock - diff,
          newStock: updated.stock,
          reason: `Conteo físico ${folio}`,
          notes: `Contado ${item.countedQty}; sistema ${current} (${diff > 0 ? "+" : ""}${diff}).`,
          businessVersion: 1,
          branchId: count.branchId,
        },
      }))
    }
    const changed = await tx.inventoryCount.updateMany({
      where: { id: count.id, status: "OPEN" },
      data: { status: "APPLIED", appliedAt: new Date() },
    })
    if (changed.count !== 1) throw new BusinessError("El conteo cambió durante la operación; reintenta.", 409)
    return { countId: count.id, folio, status: "APPLIED" as const, adjustments: movements.length, branchName: count.branch.name }
  })
}

/** Cancela un conteo abierto sin tocar el inventario. */
export async function cancelCount(db: PrismaClient, actorId: string, businessId: string, countId: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "COUNT_CANCEL", permission: "staff", payload: { countId } }, async tx => {
    const count = await tx.inventoryCount.findFirst({ where: { id: countId, businessId }, select: { id: true, number: true, status: true } })
    if (!count) throw new BusinessError("Conteo no encontrado.", 404)
    if (count.status !== "OPEN") throw new BusinessError("Solo se puede cancelar un conteo abierto.", 409)
    const changed = await tx.inventoryCount.updateMany({
      where: { id: count.id, status: "OPEN" },
      data: { status: "CANCELLED" },
    })
    if (changed.count !== 1) throw new BusinessError("El conteo cambió durante la operación; reintenta.", 409)
    return { countId: count.id, folio: countFolio(count.number), status: "CANCELLED" as const }
  })
}

export function listCounts(db: PrismaClient, businessId: string, filter: { status?: CountStatus; branchId?: string } = {}) {
  return db.inventoryCount.findMany({
    where: {
      businessId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
    },
    include: {
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: { select: { expectedQty: true, countedQty: true } },
    },
    orderBy: [{ createdAt: "desc" }, { number: "desc" }],
    take: 100,
  })
}

export function getCount(db: PrismaClient, businessId: string, id: string) {
  return db.inventoryCount.findFirst({
    where: { id, businessId },
    include: {
      branch: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, barcode: true } } },
        orderBy: { product: { name: "asc" } },
      },
    },
  })
}
