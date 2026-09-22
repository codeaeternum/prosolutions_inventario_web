import type { PrismaClient, RepairStatus } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema, resolveBranch } from "./operations"
import { DEFAULT_FOLIO_DIGITS, repairFolio } from "../workshop-labels"

// Mismo folio que purchaseFolio (purchasing.ts). Se declara local porque
// importar purchasing.ts arrastra ../low-stock → ruta SSE → next-auth, y esa
// cadena no resuelve bajo el entorno node de vitest.
function purchaseFolio(number: number): string {
  return `OC-${String(number).padStart(6, "0")}`
}

/**
 * Lista de encargos ("qué debo comprar"). Junta tres fuentes de demanda:
 *  a) refacciones ligadas a producto pedidas por órdenes de reparación abiertas
 *     (se calcula en vivo desde RepairPart — nunca queda desactualizada),
 *  b) productos activos por debajo de su stock mínimo,
 *  c) insumos manuales capturados en ShoppingItem.
 */

// Órdenes que ya no necesitan refacciones: misma frontera que
// PART_CLOSED_STATUSES de workshop.ts.
const TERMINAL_ORDER_STATUSES: RepairStatus[] = ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"]
// La pieza pedida por el técnico (REQUESTED) y la ya autorizada (APPROVED)
// cuentan como demanda de compra; REJECTED no.
const OPEN_PART_STATUSES = ["REQUESTED", "APPROVED"] as const

const moneyCents = z.number().int().min(0).max(100000000)

export interface PartsShortageRow {
  productId: string
  name: string
  needed: number
  available: number
  shortage: number
  costPrice: number | null
  orders: { orderId: string; number: number; qty: number; folio: string }[]
}

export interface LowStockRow {
  productId: string
  name: string
  stock: number
  minStock: number
  suggested: number
  costPrice: number | null
}

/**
 * Demanda de compra del negocio. Con branchId, `available` de las refacciones
 * es el stock de ESA sucursal (BranchStock); sin él, el total (Product.stock).
 * `folioDigits` es el largo del folio impreso del negocio (order_folio_digits,
 * 4–8): el llamador lo resuelve con getOrderFolioDigits (la capa de dominio no
 * importa lib/settings para no arrastrar el cliente prisma a los tests).
 */
export async function listShoppingNeeds(db: PrismaClient, businessId: string, branchId?: string, folioDigits: number = DEFAULT_FOLIO_DIGITS) {
  // a) Refacciones pedidas/autorizadas en órdenes no terminales.
  const parts = await db.repairPart.findMany({
    where: {
      businessId,
      productId: { not: null },
      status: { in: [...OPEN_PART_STATUSES] },
      order: { status: { notIn: TERMINAL_ORDER_STATUSES } },
    },
    select: {
      productId: true,
      qty: true,
      orderId: true,
      order: { select: { number: true } },
      product: { select: { id: true, name: true, stock: true, costPrice: true } },
    },
  })

  const productIds = [...new Set(parts.map(part => part.productId).filter((id): id is string => Boolean(id)))]
  const branchRows = branchId && productIds.length
    ? await db.branchStock.findMany({
      where: { businessId, branchId, productId: { in: productIds } },
      select: { productId: true, quantity: true },
    })
    : []
  const branchQty = new Map(branchRows.map(row => [row.productId, row.quantity]))

  const grouped = new Map<string, PartsShortageRow & { ordersById: Map<string, { orderId: string; number: number; qty: number; folio: string }> }>()
  for (const part of parts) {
    if (!part.productId || !part.product) continue
    const entry = grouped.get(part.productId) ?? {
      productId: part.productId,
      name: part.product.name,
      needed: 0,
      available: branchId ? (branchQty.get(part.productId) ?? 0) : part.product.stock,
      shortage: 0,
      costPrice: part.product.costPrice,
      orders: [],
      ordersById: new Map(),
    }
    entry.needed += part.qty
    const order = entry.ordersById.get(part.orderId) ?? { orderId: part.orderId, number: part.order.number, qty: 0, folio: repairFolio(part.order.number, folioDigits) }
    order.qty += part.qty
    entry.ordersById.set(part.orderId, order)
    grouped.set(part.productId, entry)
  }
  // Solo lo que falta: needed > available, aunque haya stock parcial.
  const partsShortage: PartsShortageRow[] = [...grouped.values()]
    .map(({ ordersById, ...entry }) => ({
      ...entry,
      orders: [...ordersById.values()].sort((a, b) => a.number - b.number),
      shortage: Math.max(0, entry.needed - entry.available),
    }))
    .filter(entry => entry.shortage > 0)
    .sort((a, b) => b.shortage - a.shortage)
    .slice(0, 100)

  // b) Stock bajo: Prisma no compara dos columnas, así que el umbral
  //    stock <= minStock se filtra en JS.
  const products = await db.product.findMany({
    where: { businessId, isActive: true },
    select: { id: true, name: true, stock: true, minStock: true, costPrice: true },
  })
  const lowStock: LowStockRow[] = products
    .filter(product => product.stock <= product.minStock)
    .map(product => ({
      productId: product.id,
      name: product.name,
      stock: product.stock,
      minStock: product.minStock,
      // Reabastecer hasta el doble del mínimo (al menos 1 pieza).
      suggested: Math.max(1, product.minStock * 2 - product.stock),
      costPrice: product.costPrice,
    }))
    .sort((a, b) => (b.minStock - b.stock) - (a.minStock - a.stock) || a.name.localeCompare(b.name))
    .slice(0, 200)

  // c) Insumos capturados a mano, pendientes de compra.
  const manual = await db.shoppingItem.findMany({
    where: { businessId, status: "PENDING" },
    include: {
      product: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      purchase: { select: { id: true, number: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  })

  return { partsShortage, lowStock, manual }
}

const addSchema = z.object({
  idempotencyKey: operationKeySchema,
  // Con productId puede venir vacía: se copia el nombre del producto.
  description: z.string().trim().max(200).optional().default(""),
  quantity: z.number().int().min(1).max(9999).default(1),
  unitCostCents: moneyCents.default(0),
  productId: z.string().min(1).nullish(),
  notes: z.string().trim().max(500).optional(),
})

/** Agrega un insumo manual a la lista de encargos. */
export async function addShoppingItem(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = addSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SHOPPING_ITEM_ADD", permission: "staff", payload: input }, async tx => {
    const product = input.productId
      ? await tx.product.findFirst({ where: { id: input.productId, businessId } })
      : null
    if (input.productId && !product) throw new BusinessError("Producto no encontrado en este negocio.", 404)

    const description = input.description || product?.name || ""
    if (!description) throw new BusinessError("Describe qué hay que comprar.", 400)

    const item = await tx.shoppingItem.create({
      data: {
        businessId,
        productId: product?.id ?? null,
        description,
        quantity: input.quantity,
        unitCostCents: input.unitCostCents,
        notes: input.notes || null,
        createdById: actorId,
      },
      include: {
        product: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })
    return { item }
  })
}

const resolveSchema = z.object({
  idempotencyKey: operationKeySchema,
  action: z.enum(["PURCHASED", "CANCELLED"]),
})

/** Marca un encargo pendiente como comprado o cancelado. */
export async function resolveShoppingItem(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = resolveSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SHOPPING_ITEM_RESOLVE", permission: "staff", payload: { id, ...input } }, async tx => {
    const item = await tx.shoppingItem.findFirst({ where: { id, businessId } })
    if (!item) throw new BusinessError("Encargo no encontrado.", 404)
    if (item.status !== "PENDING") throw new BusinessError("El encargo ya fue resuelto.", 409)
    const changed = await tx.shoppingItem.updateMany({
      where: { id: item.id, status: "PENDING" },
      data: { status: input.action, resolvedById: actorId, resolvedAt: new Date() },
    })
    if (changed.count !== 1) throw new BusinessError("El encargo cambió durante la operación; reintenta.", 409)
    return { itemId: item.id, status: input.action }
  })
}

const fromNeedsItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(100000),
  unitCostCents: moneyCents,
})
const fromNeedsSchema = z.object({
  idempotencyKey: operationKeySchema,
  branchId: z.string().min(1),
  supplierId: z.string().min(1).nullish(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(fromNeedsItemSchema).min(1).max(200),
  manualItemIds: z.array(z.string().min(1)).max(200).optional().default([]),
})

/**
 * Genera la orden de compra en DRAFT a partir de la lista de encargos y, en la
 * MISMA transacción, marca los ShoppingItem manuales seleccionados como
 * PURCHASED ligados a la OC. Se replica el cuerpo de createPurchase (en vez de
 * llamarlo) porque createPurchase abre su propio operation()/transacción:
 * hacerlo en dos operaciones dejaría la ventana de una OC creada con encargos
 * sin marcar (o encargos marcados sin OC si falla la primera). Aquí o entra
 * todo junto o no entra nada.
 */
export async function createPurchaseFromNeeds(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = fromNeedsSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "PURCHASE_FROM_NEEDS", permission: "staff", payload: input }, async tx => {
    const branch = await resolveBranch(tx, input.branchId, businessId)
    if (branch.businessId !== businessId) throw new BusinessError("La sucursal no pertenece a este negocio.", 409)
    const supplier = input.supplierId
      ? await tx.supplier.findFirst({ where: { id: input.supplierId, businessId, isActive: true } })
      : null
    if (input.supplierId && !supplier) throw new BusinessError("Proveedor no encontrado o inactivo.", 404)

    // El mismo producto puede venir tildado en refacciones y en stock bajo:
    // una sola línea en la OC con la mayor cantidad pedida.
    const merged = new Map<string, z.infer<typeof fromNeedsItemSchema>>()
    for (const item of input.items) {
      const prev = merged.get(item.productId)
      merged.set(item.productId, prev
        ? { productId: item.productId, quantity: Math.max(prev.quantity, item.quantity), unitCostCents: Math.max(prev.unitCostCents, item.unitCostCents) }
        : item)
    }

    const lines = []
    let totalCents = 0
    for (const item of merged.values()) {
      const product = await tx.product.findFirst({ where: { id: item.productId, businessId } })
      if (!product || !product.isActive) throw new BusinessError("Un producto de la compra no está disponible.", 409)
      lines.push({ businessId, productId: product.id, quantity: item.quantity, unitCostCents: item.unitCostCents })
      totalCents += item.unitCostCents * item.quantity
    }

    // Los encargos manuales ligados deben seguir PENDING y ser del negocio.
    const manualIds = [...new Set(input.manualItemIds)]
    const manualItems = manualIds.length
      ? await tx.shoppingItem.findMany({ where: { id: { in: manualIds }, businessId } })
      : []
    if (manualItems.length !== manualIds.length) throw new BusinessError("Un encargo de la lista ya no existe.", 404)
    if (manualItems.some(item => item.status !== "PENDING")) {
      throw new BusinessError("Un encargo de la lista ya fue resuelto. Recarga y genera la orden de nuevo.", 409)
    }

    const purchase = await tx.purchase.create({
      data: {
        businessId,
        branchId: branch.id,
        supplierId: supplier?.id ?? null,
        notes: input.notes || null,
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

    let linkedManualItems = 0
    if (manualItems.length) {
      const linked = await tx.shoppingItem.updateMany({
        where: { id: { in: manualIds }, status: "PENDING" },
        data: { status: "PURCHASED", purchaseId: purchase.id, resolvedById: actorId, resolvedAt: new Date() },
      })
      if (linked.count !== manualIds.length) throw new BusinessError("Los encargos cambiaron durante la operación; reintenta.", 409)
      linkedManualItems = linked.count
    }

    return { purchase, folio: purchaseFolio(purchase.number), linkedManualItems }
  })
}
