import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, BusinessError, cents, openRegister, operation, operationKeySchema, registerCashCents, type Transaction } from "./operations"
import { recordAudit } from "../audit"

/**
 * Encargos de clientes: pieza que el cliente pide y el negocio no tiene en
 * stock. A diferencia de la lista de compras (shopping.ts — "qué debo
 * comprar"), el encargo lleva cliente, anticipo y seguimiento de entrega.
 *
 * Flujo feliz: PENDING → ORDERED → READY → DELIVERED (vía venta POS).
 * CANCELLED solo se alcanza antes de entregar (PENDING, ORDERED, READY);
 * una pieza ya entregada se devuelve por devolución de venta.
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
// DELIVERED y CANCELLED son terminales: una pieza ya entregada se devuelve
// por devolución de su venta en POS, nunca cancelando el encargo.
const ENCARGO_NEXT: Record<EncargoStatus, readonly EncargoStatus[]> = {
  PENDING: ["ORDERED", "CANCELLED"],
  ORDERED: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
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

// Medios de cobro/devolución del anticipo y de pago al proveedor (mismo
// vocabulario que Payment.method y SupplierPayment.method).
const ENCARGO_MONEY_METHODS = ["CASH", "CARD", "TRANSFER"] as const

const createSchema = z.object({
  idempotencyKey: operationKeySchema,
  description: z.string().trim().max(300).optional().default(""),
  quantity: z.number().int().min(1).max(9999).default(1),
  // Anticipo en pesos (Float histórico del esquema), máximo 2 decimales.
  deposit: z.number().min(0).max(100000000).default(0),
  // Medio del anticipo; omitido = CASH (mostrador). Con deposit > 0 el
  // anticipo asienta su Payment — y su CashMovement IN cuando es efectivo.
  depositMethod: z.enum(ENCARGO_MONEY_METHODS).optional(),
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
  // El anticipo nunca supera lo cotizado: /api/pedidos muestra ambos montos
  // y un anticipo mayor sería un cargo fantasma para el cliente. La
  // comparación va en centavos: deposit/priceQuoted son Float en pesos.
  if (input.priceQuoted !== undefined && cents(input.deposit, true) > cents(input.priceQuoted, true)) {
    throw new BusinessError("El anticipo no puede ser mayor que el precio cotizado.", 400)
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

    // El anticipo es dinero real del cliente y queda en el ledger: siempre
    // deja su Payment (comprobante); cuando es efectivo además entra como
    // CashMovement IN a la caja de la sucursal del encargo — misma regla
    // que los cobros de taller: efectivo exige caja abierta, tarjeta y
    // transferencia no pasan por el cajón.
    let depositPaymentId: string | null = null
    if (input.deposit > 0) {
      const method = input.depositMethod ?? "CASH"
      const register = method === "CASH" ? await openRegister(tx, branch.id, businessId) : null
      const payment = await tx.payment.create({
        data: {
          businessId, encargoId: encargo.id, purpose: "ADVANCE", method,
          amount: input.deposit, createdById: actorId,
          notes: `Anticipo de encargo: ${description}`,
        },
        select: { id: true },
      })
      depositPaymentId = payment.id
      if (register) {
        const movement = await tx.cashMovement.create({
          data: {
            businessId, registerId: register.id, userId: actorId, type: "IN",
            amount: input.deposit, description: `Encargo · anticipo — ${description}`,
            referenceType: "ENCARGO_DEPOSIT", referenceId: payment.id,
          },
          select: { id: true },
        })
        await tx.payment.update({ where: { id: payment.id }, data: { cashMovementId: movement.id } })
      }
    }

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

    return { encargo, depositPaymentId }
  })
}

export type EncargoAction = "ORDERED" | "READY" | "DELIVERED" | "CANCELLED"

const transitionSchema = z.object({
  idempotencyKey: operationKeySchema,
  action: z.enum(["ORDERED", "READY", "DELIVERED", "CANCELLED"]),
  marketplaceRequestId: z.string().min(1).nullish(),
  supplierNote: z.string().trim().max(500).optional(),
  // Motivo de cancelación o de entrega directa sin cobro autorizada por ADMIN.
  reason: z.string().trim().max(500).optional(),
  // Medio para devolver el anticipo al cancelar; omitido se usa el método
  // del anticipo registrado (o CASH en encargos anteriores al ledger).
  refundMethod: z.enum(ENCARGO_MONEY_METHODS).optional(),
  // Pago al proveedor al marcar ORDERED (mismo patrón que paySupplier):
  // solo ADMIN lo asienta; CASH documenta la salida salvo que se declare
  // cashFromRegister, que la asienta como CashMovement OUT del cajón.
  supplierId: z.string().min(1).nullish(),
  supplierAmountCents: z.number().int().min(1).max(100000000).optional(),
  supplierMethod: z.enum(ENCARGO_MONEY_METHODS).optional(),
  cashFromRegister: z.boolean().optional(),
})

/**
 * Anticipo neto retenido del encargo en centavos (anticipos ADVANCE menos
 * devoluciones REFUND previas; sin asientos en el ledger cae al `deposit`
 * de la ficha para encargos históricos).
 */
export async function encargoHeldCents(
  tx: Transaction,
  encargo: { id: string; deposit: number },
): Promise<{ heldCents: number; depositMethod: (typeof ENCARGO_MONEY_METHODS)[number] | null }> {
  if (encargo.deposit <= 0) return { heldCents: 0, depositMethod: null }
  const [advanceRows, priorRefunds] = await Promise.all([
    tx.payment.findMany({ where: { encargoId: encargo.id, purpose: "ADVANCE" }, select: { method: true, amount: true, status: true } }),
    tx.payment.findMany({ where: { encargoId: encargo.id, purpose: "REFUND" }, select: { amount: true } }),
  ])
  // Solo los anticipos CONFIRMED retienen dinero: un ADVANCE VOIDED (venta
  // anulada por el camino viejo) ya no representa efectivo del cliente —
  // contarlo inflaría lo retenido. Los REFUND se guardan con amount negativo:
  // el retenido = anticipos + devoluciones (ya vienen en negativo). Sin ledger
  // (ni una sola fila ADVANCE), cae al deposit — encargos históricos.
  // Cada fila se convierte a centavos ANTES de sumar: sumar Float pesos y
  // redondear al final deja escapar el epsilon acumulado.
  const advances = advanceRows.filter(p => p.status === "CONFIRMED")
  const rawHeld = advanceRows.length
    ? advances.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) + priorRefunds.reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
    : Math.round(encargo.deposit * 100)
  const heldCents = Math.max(0, rawHeld)
  const depositMethod = heldCents > 0 ? ((advances[0]?.method as (typeof ENCARGO_MONEY_METHODS)[number] | undefined) ?? "CASH") : null
  return { heldCents, depositMethod }
}

/**
 * Núcleo de la transición DENTRO de un tx ya abierto: valida que el encargo
 * pertenezca al negocio y que el salto de estado esté permitido, asienta el
 * cambio con guard de concurrencia (updateMany por estado previo) y deja el
 * rastro en la bitácora.
 *
 * Lo comparten transitionEncargo() —que lo envuelve en operation() con
 * recibo propio—, la liquidación de encargo en POS (sales.ts / documents.ts)
 * y el pedido atómico al aliado de marketplace.ts, donde la solicitud al
 * mercado y el pase a ORDERED confirman o revierten juntos.
 */
export async function transitionEncargoTx(
  tx: Transaction,
  input: {
    actorId: string
    businessId: string
    id: string
    action: EncargoAction
    marketplaceRequestId?: string | null
    supplierNote?: string
    reason?: string
    refundMethod?: (typeof ENCARGO_MONEY_METHODS)[number]
    supplierId?: string | null
    supplierAmountCents?: number
    supplierMethod?: (typeof ENCARGO_MONEY_METHODS)[number]
    cashFromRegister?: boolean
    saleId?: string | null
  },
) {
  const encargo = await tx.encargo.findFirst({ where: { id: input.id, businessId: input.businessId }, include: encargoInclude })
  if (!encargo) throw new BusinessError("Encargo no encontrado.", 404)
  assertEncargoTransition(encargo.status, input.action)

  // READY → DELIVERED directo (sin venta POS): solo procede cuando el anticipo
  // ya cubrió el 100% del precio cotizado (priceQuoted > 0 y anticipo retenido
  // >= cotizado) o cuando un ADMIN autoriza entrega sin cobro con motivo
  // explícito (garantía / cortesía). Con saldo pendiente debe cobrarse en POS.
  if (input.action === "DELIVERED" && !input.saleId) {
    const quotedCents = encargo.priceQuoted != null ? Math.round(encargo.priceQuoted * 100) : 0
    const { heldCents } = quotedCents > 0 ? await encargoHeldCents(tx, encargo) : { heldCents: 0 }
    const fullyPrepaid = quotedCents > 0 && heldCents >= quotedCents
    if (!fullyPrepaid) {
      const me = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true } })
      const adminOverride = me?.role === "ADMIN" && Boolean(input.reason && input.reason.trim().length >= 3)
      if (!adminOverride) {
        throw new BusinessError(
          "El encargo debe cobrarse en el punto de venta antes de marcarlo como entregado.",
          409,
          "ENCARGO_REQUIRES_SALE",
        )
      }
    }
  }

  // Cancelar reembolsa anticipos (efectivo del cajón incluido): un EMPLOYEE
  // solo cancela encargos que él mismo registró (createdById); los ajenos
  // exigen ADMIN — misma regla que cancelDocument en documents.ts.
  if (input.action === "CANCELLED") {
    const me = await tx.user.findUnique({ where: { id: input.actorId }, select: { role: true } })
    const creatorId = encargo.createdById ?? encargo.createdBy?.id ?? null
    if (me?.role !== "ADMIN" && creatorId !== input.actorId) {
      throw new BusinessError("Cancelar el encargo de otra persona requiere un administrador.", 403)
    }
  }

  const terminal = input.action === "DELIVERED" || input.action === "CANCELLED"
  const changed = await tx.encargo.updateMany({
    where: { id: encargo.id, status: encargo.status },
    data: {
      status: input.action,
      ...(terminal ? { resolvedById: input.actorId } : {}),
      ...(input.action === "ORDERED" && input.marketplaceRequestId ? { marketplaceRequestId: input.marketplaceRequestId } : {}),
      ...(input.supplierNote !== undefined ? { supplierNote: input.supplierNote || null } : {}),
    },
  })
  if (changed.count !== 1) throw new BusinessError("El encargo cambió durante la operación; reintenta.", 409)

  // Pago al proveedor al pedir la pieza: queda como SupplierPayment a cuenta
  // general ligado al encargo. Registrar salidas de dinero del negocio es
  // decisión de ADMIN — misma regla que paySupplier (supplier-payments.ts).
  let supplierPaymentId: string | null = null
  if (input.action === "ORDERED" && (input.supplierId != null || input.supplierAmountCents != null || input.supplierMethod != null)) {
    if (!input.supplierId || input.supplierAmountCents == null || !input.supplierMethod) {
      throw new BusinessError("Captura proveedor, monto y método del pago.", 400)
    }
    const payer = await actor(tx, input.actorId, "admin", input.businessId)
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId: input.businessId } })
    if (!supplier) throw new BusinessError("Proveedor no encontrado.", 404)
    const payment = await tx.supplierPayment.create({
      data: {
        businessId: input.businessId, supplierId: supplier.id, encargoId: encargo.id,
        amountCents: input.supplierAmountCents, method: input.supplierMethod,
        notes: `Encargo: ${encargo.description}`, createdById: input.actorId,
      },
      select: { id: true },
    })
    supplierPaymentId = payment.id
    // Salida real del cajón: solo cuando el cobrador declara que el efectivo
    // sale de su caja (cashFromRegister) — igual que en paySupplier, el tope
    // es el efectivo disponible y el registro cae en SU sucursal base.
    if (input.supplierMethod === "CASH" && input.cashFromRegister) {
      const register = await openRegister(tx, payer.homeBranchId, input.businessId)
      const availableCents = await registerCashCents(tx, register.id)
      if (input.supplierAmountCents > availableCents) {
        throw new BusinessError(`El pago supera el efectivo en caja (${((input.supplierAmountCents - availableCents) / 100).toFixed(2)} faltantes).`, 409, "INSUFFICIENT_CASH")
      }
      await tx.cashMovement.create({
        data: {
          businessId: input.businessId, registerId: register.id, userId: input.actorId, type: "OUT",
          amount: input.supplierAmountCents / 100, referenceType: "SUPPLIER_PAYMENT", referenceId: payment.id,
          description: `Pago a proveedor ${supplier.name} (encargo: ${encargo.description})`,
        },
      })
    }
  }

  // Cancelación con anticipo: se devuelve lo que el cliente dejó — Payment
  // negativo con status REFUNDED y CashMovement OUT cuando es efectivo,
  // mismo patrón que el reembolso de taller. Encargos anteriores al ledger
  // no tienen asientos: se devuelve el `deposit` de la ficha con el método
  // pedido (default CASH). Un anticipo ya devuelto (REFUND previo) descuenta
  // del retenido — nunca se paga dos veces.
  let refundPaymentId: string | null = null
  if (input.action === "CANCELLED" && encargo.deposit > 0) {
    const { heldCents, depositMethod } = await encargoHeldCents(tx, encargo)
    if (heldCents > 0) {
      const method = input.refundMethod ?? depositMethod ?? "CASH"
      const reasonSuffix = input.reason?.trim() ? ` (${input.reason.trim()})` : ""
      const refund = await tx.payment.create({
        data: {
          businessId: input.businessId, encargoId: encargo.id, purpose: "REFUND", method,
          amount: -heldCents / 100, status: "REFUNDED", createdById: input.actorId,
          notes: `Devolución de anticipo por cancelación: ${encargo.description}${reasonSuffix}`,
        },
        select: { id: true },
      })
      refundPaymentId = refund.id
      if (method === "CASH") {
        const register = await openRegister(tx, encargo.branchId, input.businessId)
        // La caja no queda en negativo — igual que las devoluciones de venta.
        const availableCents = await registerCashCents(tx, register.id)
        if (heldCents > availableCents) {
          throw new BusinessError(`El efectivo en caja no alcanza para devolver el anticipo (${((heldCents - availableCents) / 100).toFixed(2)} faltantes).`, 409, "INSUFFICIENT_CASH")
        }
        const movement = await tx.cashMovement.create({
          data: {
            businessId: input.businessId, registerId: register.id, userId: input.actorId, type: "OUT",
            amount: heldCents / 100, description: `Encargo · devolución de anticipo — ${encargo.description}`,
            referenceType: "ENCARGO_REFUND", referenceId: refund.id,
          },
          select: { id: true },
        })
        await tx.payment.update({ where: { id: refund.id }, data: { cashMovementId: movement.id } })
      }
    }
  }

  const reasonNote = input.reason?.trim() ? ` · motivo: ${input.reason.trim()}` : ""
  await recordAudit(tx, {
    businessId: input.businessId,
    actorId: input.actorId,
    action: "ENCARGO_STATUS",
    entity: "encargo",
    entityId: encargo.id,
    entityName: encargo.description,
    summary: `Encargo "${encargo.description}": ${encargoStatusLabel(encargo.status)} → ${encargoStatusLabel(input.action)}${supplierPaymentId ? " · pago a proveedor registrado" : ""}${refundPaymentId ? " · anticipo devuelto" : ""}${reasonNote}`,
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
    supplierPaymentId,
    refundPaymentId,
  }
}

/**
 * Valida que un encargo pueda liquidarse dentro de una venta POS (pertenece
 * al negocio y sucursal, y está en estado READY) y calcula el anticipo neto
 * ya cobrado que se descontará del importe exigible.
 */
export async function prepareEncargoForSaleTx(
  tx: Transaction,
  input: { encargoId: string; businessId: string; branchId: string },
) {
  const encargo = await tx.encargo.findFirst({
    where: { id: input.encargoId, businessId: input.businessId },
    include: encargoInclude,
  })
  if (!encargo) throw new BusinessError("Encargo no encontrado.", 404)
  if (encargo.status !== "READY") {
    throw new BusinessError(
      `El encargo debe estar listo para entregar antes de cobrarlo (estado actual: ${encargoStatusLabel(encargo.status)}).`,
      409,
      "ENCARGO_NOT_READY",
    )
  }
  if (encargo.branchId && encargo.branchId !== input.branchId) {
    throw new BusinessError("El encargo pertenece a otra sucursal.", 409)
  }
  const { heldCents, depositMethod } = await encargoHeldCents(tx, encargo)
  return { encargo, depositCents: heldCents, depositMethod }
}

/**
 * Cierra atómicamente el encargo al confirmar su venta POS: liga los pagos
 * de anticipo (ADVANCE) al `saleId` para que `Sale.payments` cuadre con el
 * total sin duplicar asientos en caja (conservan su `createdAt` y su
 * `CashMovement` del turno en que se recibió el anticipo) y transiciona el
 * encargo a DELIVERED dentro de la misma transacción.
 */
export async function settleEncargoInSaleTx(
  tx: Transaction,
  input: {
    encargoId: string
    saleId: string
    actorId: string
    businessId: string
    depositCents: number
  },
) {
  if (input.depositCents > 0) {
    await tx.payment.updateMany({
      where: { encargoId: input.encargoId, purpose: "ADVANCE", status: "CONFIRMED" },
      data: { saleId: input.saleId },
    })
  }
  return transitionEncargoTx(tx, {
    actorId: input.actorId,
    businessId: input.businessId,
    id: input.encargoId,
    action: "DELIVERED",
    saleId: input.saleId,
  })
}

/**
 * Reversa de settleEncargoInSaleTx cuando la venta que entregó el encargo se
 * anula (voidSale): los anticipos ADVANCE vuelven al encargo (saleId = null —
 * el dinero queda retenido por el encargo, NO se reembolsa al cliente) y el
 * encargo regresa a READY, cobrable de nuevo o cancelable por su flujo propio.
 *
 * DELIVERED → READY no existe como transición de negocio: una entrega
 * consumada no se "des-entrega" desde el panel. Esto es la desactivación del
 * vínculo dentro de la misma anulación atómica — sin ella el encargo quedaba
 * terminal para siempre y el anticipo huérfano seguía contando como retenido.
 */
export async function releaseEncargoFromVoidedSaleTx(
  tx: Transaction,
  input: { encargoId: string; saleId: string; actorId: string; businessId: string; saleNumber: number },
) {
  await tx.payment.updateMany({
    where: { saleId: input.saleId, encargoId: input.encargoId, purpose: "ADVANCE", status: "CONFIRMED" },
    data: { saleId: null },
  })
  const reverted = await tx.encargo.updateMany({
    where: { id: input.encargoId, businessId: input.businessId, status: "DELIVERED" },
    data: { status: "READY", resolvedById: null },
  })
  if (reverted.count !== 1) throw new BusinessError("El encargo cambió durante la operación; reintenta.", 409)
  await recordAudit(tx, {
    businessId: input.businessId,
    actorId: input.actorId,
    action: "ENCARGO_STATUS",
    entity: "encargo",
    entityId: input.encargoId,
    summary: `Encargo devuelto a lista: la venta V-${input.saleNumber} que lo entregó fue anulada.`,
    changes: { status: { before: "DELIVERED", after: "READY" } },
  })
}

/**
 * Precio prometido del encargo aplicado a un renglón de venta.
 *
 * `priceQuoted` es el TOTAL del encargo — las `quantity` piezas juntas por
 * ese monto (el anticipo del cliente se pacta contra ese total: al crear el
 * encargo, deposit ≤ priceQuoted). Tratarlo como precio unitario cobraría de
 * más: quantity 3 cotizado en $3,000 facturaba $9,000.
 *
 * Devuelve los centavos del renglón cuando corresponde al encargo — mismo
 * producto, o encargo de texto libre en una venta de un solo renglón — y
 * null cuando no aplica. El renglón debe llevar EXACTAMENTE las piezas del
 * encargo: un encargo se liquida entero (READY → DELIVERED en la misma tx)
 * o no se liquida — entregar una fracción con todo el anticipo aplicado
 * sería dinero sin pieza y dejaría el resto del encargo sin cobrar.
 */
export function encargoQuotedLineCents(
  encargo: { productId: string | null; quantity: number; priceQuoted: number | null },
  line: { productId: string; quantity: number },
  lineCount: number,
): number | null {
  if (encargo.priceQuoted == null || encargo.priceQuoted <= 0) return null
  const applies = encargo.productId === line.productId || (!encargo.productId && lineCount === 1)
  if (!applies) return null
  if (line.quantity !== encargo.quantity) {
    throw new BusinessError(`El encargo es por ${encargo.quantity} pieza(s); su renglón en la venta debe llevar exactamente esa cantidad.`, 409)
  }
  return cents(encargo.priceQuoted, true)
}

/**
 * Transición de estado del encargo. Devuelve lo necesario para que la ruta
 * avise al staff cuando la pieza llega (READY): descripción, sucursal y folio
 * de la solicitud al aliado si aplica.
 */
export async function transitionEncargo(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = transitionSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "ENCARGO_STATUS", permission: "staff", payload: { id, ...input } },
    tx => transitionEncargoTx(tx, {
      actorId, businessId, id, action: input.action,
      marketplaceRequestId: input.marketplaceRequestId, supplierNote: input.supplierNote,
      reason: input.reason, refundMethod: input.refundMethod, supplierId: input.supplierId,
      supplierAmountCents: input.supplierAmountCents, supplierMethod: input.supplierMethod,
      cashFromRegister: input.cashFromRegister,
    }))
}
