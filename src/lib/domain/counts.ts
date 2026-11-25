import type { CountStatus, PrismaClient } from "@/generated/prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema, resolveBranch } from "./operations"
import { nextCountNumber } from "./tenant-sequence"
import { syncLowStockAlerts } from "../low-stock"

/** Folio público de un conteo físico: CC-000001. */
export function countFolio(number: number): string {
  return `CC-${String(number).padStart(6, "0")}`
}

const createSchema = z.object({
  idempotencyKey: operationKeySchema,
  branchId: z.string().min(1),
  notes: z.string().trim().max(1000).optional(),
  // Conteo ciego: el capturador no ve la existencia esperada hasta aplicar.
  blind: z.boolean().optional(),
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
    // Folio por negocio (no global): nextCountNumber() lo reserva desde
    // BusinessCounter con un upsert atómico dentro de esta tx serializable
    // (mismo patrón que ventas y órdenes); @@unique([businessId, number]) es
    // la red de seguridad y el autoincrement del schema queda inerte.
    const number = await nextCountNumber(tx, businessId)
    const count = await tx.inventoryCount.create({
      data: { businessId, number, branchId: branch.id, notes: input.notes || null, blind: input.blind ?? false, createdById: actorId },
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
 * Aplica el conteo: por cada producto con varianza ajusta el stock de la
 * sucursal de forma RELATIVA, mueve Product.stock por la misma diferencia y
 * deja un InventoryMovement ADJUSTMENT auditado.
 *
 * La varianza es la capturada en su momento: delta = countedQty − expectedQty
 * (expectedQty es la foto del sistema AL CAPTURAR y ya no se re-sincroniza —
 * queda como registro histórico de contra qué se comparó lo físico). El ajuste
 * se aplica sobre el stock VIVO al aplicar: newQty = stockVigente + delta.
 *
 * Por qué relativo y no absoluto: entre captura y aplicación pueden ocurrir
 * ventas, recepciones o traspasos legítimos. Si el conteo cuadraba al capturar
 * (delta 0) no hay merma que ajustar y esos movimientos se conservan — fijar
 * countedQty como absoluto "resucitaría" piezas vendidas en el interim. La
 * varianza sí se conserva: una merma de 2 detectada al capturar sigue siendo
 * una merma de 2 aunque el stock se mueva antes de aplicar.
 *
 * Guard de consistencia física: si el delta llevaría la existencia a negativo
 * (BranchStock_quantity_nonnegative lo prohíbe además en BD), la captura y los
 * movimientos posteriores se contradicen — la operación falla con 409 para que
 * el usuario vuelva a capturar ese producto con la existencia actual (la
 * recaptura renueva expectedQty y con él la base del delta).
 */
export async function applyCount(db: PrismaClient, actorId: string, businessId: string, countId: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  // Productos con ajuste real: la alerta de stock bajo se sincroniza post-commit.
  const adjustedProductIds: string[] = []
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "COUNT_APPLY", permission: "staff", payload: { countId } }, async tx => {
    const count = await tx.inventoryCount.findFirst({
      where: { id: countId, businessId },
      include: { items: { include: { product: { select: { name: true } } } }, branch: { select: { id: true, name: true } } },
    })
    if (!count) throw new BusinessError("Conteo no encontrado.", 404)
    if (count.status !== "OPEN") throw new BusinessError("El conteo ya no está abierto.", 409)

    // Separación de funciones (auditoría): un EMPLOYEE no puede crear Y aplicar
    // el mismo conteo — ajustaría el stock sin que un segundo usuario lo
    // revisara. Un ADMIN sí puede auto-aplicar: los negocios chicos operan
    // con un solo administrador.
    const applier = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } })
    if (applier?.role === "EMPLOYEE" && count.createdById === actorId) {
      throw new BusinessError("Otro usuario debe aplicar el conteo: quien lo creó no puede aplicarlo.", 403)
    }

    if (count.items.length === 0) throw new BusinessError("El conteo no tiene productos capturados.", 409)

    const folio = countFolio(count.number)
    const movements = []
    for (const item of count.items) {
      // Varianza de la captura: countedQty contra lo que el sistema decía EN
      // ESE momento. Sin varianza no hay nada que ajustar — aunque el stock se
      // haya movido después por operación normal, esos movimientos son legítimos.
      const delta = item.countedQty - item.expectedQty
      if (delta === 0) continue
      const stock = await tx.branchStock.findUnique({
        where: { productId_branchId: { productId: item.productId, branchId: count.branchId } },
        select: { quantity: true },
      })
      const current = stock?.quantity ?? 0
      const newQty = current + delta
      if (newQty < 0) {
        throw new BusinessError(
          `"${item.product.name}": el faltante del conteo (${delta}) excede la existencia vigente (${current}); hubo ventas o movimientos después de capturar que el conteo no explica. Vuelve a capturar ese producto antes de aplicar.`,
          409,
        )
      }
      adjustedProductIds.push(item.productId)
      await tx.branchStock.upsert({
        where: { productId_branchId: { productId: item.productId, branchId: count.branchId } },
        create: { businessId, productId: item.productId, branchId: count.branchId, quantity: newQty },
        update: { quantity: newQty },
      })
      const updated = await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: delta } } })
      movements.push(await tx.inventoryMovement.create({
        data: {
          businessId,
          productId: item.productId,
          userId: actorId,
          // El enum de BD solo tiene ADJUSTMENT; la dirección queda en el
          // delta de previousStock/newStock y en notes.
          type: "ADJUSTMENT",
          quantity: Math.abs(delta),
          previousStock: updated.stock - delta,
          newStock: updated.stock,
          reason: `Conteo físico ${folio}`,
          notes: `Contado ${item.countedQty} vs ${item.expectedQty} en sistema al capturar (${delta > 0 ? "+" : ""}${delta}); existencia ${current} → ${newQty} al aplicar.`,
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
    // El recibo (BusinessOperation.response) nombra a ambos actores para
    // trazabilidad: quién creó el conteo vs quién lo aplicó. No hay columna
    // appliedById en el schema ni se agrega: el actor ya queda en
    // BusinessOperation.actorId y en InventoryMovement.userId.
    return {
      countId: count.id,
      folio,
      status: "APPLIED" as const,
      adjustments: movements.length,
      branchName: count.branch.name,
      createdById: count.createdById,
      appliedById: actorId,
    }
  })
  await syncLowStockAlerts(db, businessId, adjustedProductIds)
  return result
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

export function listCounts(db: PrismaClient, businessId: string, filter: { status?: CountStatus; branchId?: string | { in: string[] } } = {}) {
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

/**
 * Versión del conteo segura para el cliente: en un conteo CIEGO aún OPEN la
 * cantidad esperada sale como null para no contaminar la captura. Al aplicar
 * (o cancelar) el conteo, expectedQty vuelve a ser visible en los resultados.
 * El cálculo de ajustes no se ve afectado: trabaja sobre la fila en BD.
 */
export function countForClient<T extends { status: CountStatus; blind: boolean; items: { expectedQty: number }[] }>(count: T) {
  const hideExpected = count.blind && count.status === "OPEN"
  return {
    ...count,
    items: count.items.map(item => ({ ...item, expectedQty: hideExpected ? null : item.expectedQty })),
  }
}
