import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema, type Transaction } from "./operations"
import { recordAudit } from "../audit"

/**
 * Encargos de clientes: pieza que el cliente pide y el negocio no tiene en
 * stock. A diferencia de la lista de compras (shopping.ts — "qué debo
 * comprar"), el encargo lleva cliente, anticipo y seguimiento de entrega.
 *
 * Flujo feliz: PENDING → ORDERED → READY → DELIVERED. CANCELLED se alcanza
 * desde cualquier estado (incluso uno ya entregado: el cliente puede
 * arrepentirse o devolver; el anticipo se ajusta a mano en caja).
 * ORDERED puede nacer de un proveedor propio o de una solicitud al aliado
 * del mercado (marketplaceRequestId).
 */

export const ENCARGO_STATUSES = ["PENDING", "ORDERED", "READY", "DELIVERED", "CANCELLED"] as const
export type EncargoStatus = (typeof ENCARGO_STATUSES)[number]
export function isEncargoStatus(value: string): value is EncargoStatus {
  return (ENCARGO_STATUSES as readonly string[]).includes(value)
}

const ENCARGO_STATUS_LABELS: Record<EncargoStatus, string> = {
  PENDING: "pendiente",
  ORDERED: "pedida",
  READY: "lista",
  DELIVERED: "entregada",
  CANCELLED: "cancelada",
}
export const encargoStatusLabel = (status: string): string =>
  ENCARGO_STATUS_LABELS[status as EncargoStatus] ?? status.toLowerCase()

// Siguientes estados permitidos por estado actual.
const ENCARGO_NEXT: Record<EncargoStatus, readonly EncargoStatus[]> = {
  PENDING: ["ORDERED", "CANCELLED"],
  ORDERED: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["CANCELLED"],
  CANCELLED: [],
}

export function canTransitionEncargo(from: string, to: string): boolean {
  return (ENCARGO_NEXT[from as EncargoStatus] ?? []).includes(to as EncargoStatus)
}

/** Lanza BusinessError 409 si el salto de estado no está permitido. */
export function assertEncargoTransition(from: string, to: string): void {
  if (!isEncargoStatus(to)) throw new BusinessError("Estado destino inválido.", 400)
  if (from === to) throw new BusinessError(`El encargo ya está ${encargoStatusLabel(from)}.`, 409)
  if (!canTransitionEncargo(from, to)) {
    throw new BusinessError(`No se puede pasar un encargo de "${encargoStatusLabel(from)}" a "${encargoStatusLabel(to)}".`, 409, "ENCARGO_BAD_TRANSITION")
  }
}

/**
 * Sucursal del encargo. El EMPLEADO siempre registra en su sucursal base
 * (homeBranchId): pedir otra es 403. El ADMIN elige cualquiera activa del
 * negocio; sin selección cae a la primera activa (la pieza siempre llega a
 * un local concreto).
 */
export async function resolveEncargoBranch(
  tx: Transaction,
  actor: { role: string; homeBranchId: string | null },
  requestedBranchId: string | null | undefined,
  businessId: string,
) {
  const homeId = actor.role === "EMPLOYEE" ? actor.homeBranchId : null
  if (homeId && requestedBranchId && requestedBranchId !== homeId) {
    throw new BusinessError("Solo puedes registrar encargos en tu sucursal.", 403)
  }
  const branchId = homeId ?? requestedBranchId ?? null
  const branch = branchId
    ? await tx.branch.findFirst({ where: { id: branchId, businessId, isActive: true } })
    : await tx.branch.findFirst({ where: { businessId, isActive: true }, orderBy: { createdAt: "asc" } })
  if (!branch) {
    throw new BusinessError(
      branchId ? "La sucursal seleccionada no está activa." : "No hay sucursales activas para registrar el encargo.",
      409,
    )
  }
  return branch
}

const encargoInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  product: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} as const

// Activos primero (pendiente → por entregar → en camino), cerrados al final.
const LIST_RANK: Record<EncargoStatus, number> = { PENDING: 0, READY: 1, ORDERED: 2, DELIVERED: 3, CANCELLED: 4 }

export async function listEncargos(db: PrismaClient, businessId: string, filters: { status?: string; branchId?: string } = {}) {
  const encargos = await db.encargo.findMany({
    where: {
      businessId,
      ...(filters.status && isEncargoStatus(filters.status) ? { status: filters.status } : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
    },
    include: encargoInclude,
    orderBy: { createdAt: "desc" },
    take: 300,
  })
  encargos.sort((a, b) => (LIST_RANK[a.status as EncargoStatus] ?? 9) - (LIST_RANK[b.status as EncargoStatus] ?? 9))
  return encargos
}

const createSchema = z.object({
  idempotencyKey: operationKeySchema,
  description: z.string().trim().max(300).optional().default(""),
  quantity: z.number().int().min(1).max(9999).default(1),
  // Anticipo en pesos (Float histórico del esquema), máximo 2 decimales.
  deposit: z.number().min(0).max(100000000).default(0),
  // Precio cotizado al cliente en pesos; opcional — se puede registrar sin precio.
  priceQuoted: z.number().min(0).max(100000000).optional(),
  customerId: z.string().min(1).nullish(),
  productId: z.string().min(1).nullish(),
  branchId: z.string().min(1).nullish(),
  supplierNote: z.string().trim().max(500).optional(),
})

/** Registra un encargo de cliente. Idempotente vía operation(). */
export async function createEncargo(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = createSchema.parse(raw)
  if (Math.abs(input.deposit * 100 - Math.round(input.deposit * 100)) > 0.000001) {
    throw new BusinessError("El anticipo admite como máximo dos decimales.", 400)
  }
  if (input.priceQuoted !== undefined && Math.abs(input.priceQuoted * 100 - Math.round(input.priceQuoted * 100)) > 0.000001) {
    throw new BusinessError("El precio cotizado admite como máximo dos decimales.", 400)
  }
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "ENCARGO_CREATE", permission: "staff", payload: input }, async tx => {
    const me = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, homeBranchId: true } })
    // operation() ya validó al actor; si aquí no aparece, algo va mal — no
    // resolver como si fuera admin (eso saltaría el guard de sucursal).
    if (!me) throw new BusinessError("La cuenta no está autorizada para operar.", 403, "ACCOUNT_NOT_APPROVED")
    const branch = await resolveEncargoBranch(tx, me, input.branchId, businessId)

    const customer = input.customerId
      ? await tx.user.findFirst({ where: { id: input.customerId, businessId, role: "CUSTOMER" } })
      : null
    if (input.customerId && !customer) throw new BusinessError("Cliente no encontrado en este negocio.", 404)

    const product = input.productId
      ? await tx.product.findFirst({ where: { id: input.productId, businessId, isActive: true } })
      : null
    if (input.productId && !product) throw new BusinessError("Producto no encontrado en este negocio.", 404)

    const description = input.description || product?.name || ""
    if (!description) throw new BusinessError("Describe la pieza que encarga el cliente.", 400)

    const encargo = await tx.encargo.create({
      data: {
        businessId,
        branchId: branch.id,
        customerId: customer?.id ?? null,
        productId: product?.id ?? null,
        description,
        quantity: input.quantity,
        deposit: input.deposit,
        priceQuoted: input.priceQuoted ?? null,
        supplierNote: input.supplierNote || null,
        createdById: actorId,
      },
      include: encargoInclude,
    })

    await recordAudit(tx, {
      businessId,
      actorId,
      action: "ENCARGO_CREATE",
      entity: "encargo",
      entityId: encargo.id,
      entityName: description,
      summary: `Encargo registrado: ${description}${input.quantity > 1 ? ` ×${input.quantity}` : ""}${input.deposit > 0 ? ` (anticipo $${input.deposit.toFixed(2)})` : ""}${input.priceQuoted != null ? ` (cotizado $${input.priceQuoted.toFixed(2)})` : ""}`,
      // Solo se audita cuando viene cotización: un null → null ensucia el diff.
      ...(input.priceQuoted != null ? { changes: { priceQuoted: { before: null, after: input.priceQuoted } } } : {}),
    })

    return { encargo }
  })
}

const transitionSchema = z.object({
  idempotencyKey: operationKeySchema,
  action: z.enum(["ORDERED", "READY", "DELIVERED", "CANCELLED"]),
  marketplaceRequestId: z.string().min(1).nullish(),
  supplierNote: z.string().trim().max(500).optional(),
})

/**
 * Transición de estado del encargo. Devuelve lo necesario para que la ruta
 * avise al staff cuando la pieza llega (READY): descripción, sucursal y folio
 * de la solicitud al aliado si aplica.
 */
export async function transitionEncargo(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = transitionSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "ENCARGO_STATUS", permission: "staff", payload: { id, ...input } }, async tx => {
    const encargo = await tx.encargo.findFirst({ where: { id, businessId }, include: encargoInclude })
    if (!encargo) throw new BusinessError("Encargo no encontrado.", 404)
    assertEncargoTransition(encargo.status, input.action)

    const terminal = input.action === "DELIVERED" || input.action === "CANCELLED"
    const changed = await tx.encargo.updateMany({
      where: { id: encargo.id, status: encargo.status },
      data: {
        status: input.action,
        ...(terminal ? { resolvedById: actorId } : {}),
        ...(input.action === "ORDERED" && input.marketplaceRequestId ? { marketplaceRequestId: input.marketplaceRequestId } : {}),
        ...(input.supplierNote !== undefined ? { supplierNote: input.supplierNote || null } : {}),
      },
    })
    if (changed.count !== 1) throw new BusinessError("El encargo cambió durante la operación; reintenta.", 409)

    await recordAudit(tx, {
      businessId,
      actorId,
      action: "ENCARGO_STATUS",
      entity: "encargo",
      entityId: encargo.id,
      entityName: encargo.description,
      summary: `Encargo "${encargo.description}": ${encargoStatusLabel(encargo.status)} → ${encargoStatusLabel(input.action)}`,
      changes: { status: { before: encargo.status, after: input.action } },
    })

    return {
      encargoId: encargo.id,
      status: input.action,
      previousStatus: encargo.status,
      description: encargo.description,
      branchId: encargo.branchId,
      branchName: encargo.branch?.name ?? null,
      customerName: encargo.customer?.name ?? null,
      // El aviso al cliente (Telegram) lo dispara la ruta post-commit con
      // este id; null = encargo sin cuenta, no hay a quién escribir.
      customerId: encargo.customerId,
      marketplaceRequestId: input.action === "ORDERED" ? (input.marketplaceRequestId ?? encargo.marketplaceRequestId) : encargo.marketplaceRequestId,
    }
  })
}
