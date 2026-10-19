import type { PaymentMethod, PrismaClient, Reservation } from "@prisma/client"
import { z } from "zod"
import { isOwnedPaymentProof } from "../payment-proofs"
import { actor, addDebt, amount, BusinessError, cents, itemsSchema, mergeItems, openRegister, operation, operationKeySchema, releaseStock, resolveBranch, takeStock, transaction, type Transaction } from "./operations"
import { collectLowStockIds, syncLowStockAlerts } from "../low-stock"

export const ACTIVE_RESERVATIONS = ["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"] as const
export const TERMINAL_RESERVATIONS = ["COMPLETED", "CANCELLED", "REJECTED", "EXPIRED"] as const
const active = (value: string) => (ACTIVE_RESERVATIONS as readonly string[]).includes(value)

export const reservationRequestSchema = z.object({
  idempotencyKey: operationKeySchema,
  items: itemsSchema.optional(),
  productId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  type: z.enum(["TEMPORARY", "DEPOSIT"]).default("TEMPORARY"),
  paymentMethod: z.enum(["STORE", "TRANSFER", "CREDIT"]).optional(),
  paymentProofUrl: z.string().max(2000).optional(),
  branchId: z.string().min(1).optional(),
}).refine(value => Boolean(value.items) !== Boolean(value.productId), "Envía items o productId.")

async function settings(tx: Transaction, businessId: string) {
  const row = await tx.settings.findFirst({ where: { businessId } })
  return z.object({
    tempReservationMinutes: z.number().int().min(1).max(10080),
    depositPercentage: z.number().int().min(1).max(100),
    pendingVerificationHours: z.number().int().min(1).max(8760),
    depositReservationHours: z.number().int().min(1).max(8760),
  }).parse(row ?? { tempReservationMinutes: 30, depositPercentage: 50, pendingVerificationHours: 24, depositReservationHours: 48 })
}

export async function createReservations(db: PrismaClient, userId: string, businessId: string, raw: unknown) {
  const input = reservationRequestSchema.parse(raw)
  const items = mergeItems(input.items ?? [{ productId: input.productId!, quantity: input.quantity ?? 1 }])
  const method = input.paymentMethod ?? (input.type === "DEPOSIT" ? "TRANSFER" : "STORE")
  const type = method === "TRANSFER" ? "DEPOSIT" : input.type
  if (type === "DEPOSIT" && method !== "TRANSFER") throw new BusinessError("El anticipo requiere transferencia y comprobante.")
  if (method === "TRANSFER" && (!input.paymentProofUrl || !await isOwnedPaymentProof(input.paymentProofUrl, userId))) {
    throw new BusinessError("Sube un comprobante privado desde tu cuenta antes de reservar.", 400, "PAYMENT_PROOF_REQUIRED")
  }
  const payload = { items, type, method, proof: method === "TRANSFER" ? input.paymentProofUrl : null }
  const result = await operation(db, { key: input.idempotencyKey, actorId: userId, businessId, kind: "RESERVATION_CREATE", payload }, async tx => {
    const user = await actor(tx, userId, "customer", businessId)
    const config = await settings(tx, businessId)
    const expiresAt = new Date(Date.now() + (type === "DEPOSIT" ? config.pendingVerificationHours * 3600000 : config.tempReservationMinutes * 60000))
    const reservations = []
    let totalCents = 0
    for (const item of items) {
      const { product, branch } = await takeStock(tx, { productId: item.productId, quantity: item.quantity, branchId: input.branchId, businessId })
      // Lista de taller para clientes taller/negocio: la misma regla que el
      // POS (sell: kind WORKSHOP → precio wholesale para STORE y TECHNICIAN)
      // y los snapshots de documents.ts. Antes el técnico pagaba retail solo
      // en reserva web y mayoreo en mostrador — inconsistente.
      const wholesale = user.customerType === "STORE" || user.customerType === "TECHNICIAN"
      const lineCents = cents(wholesale ? product.wholesalePrice : product.retailPrice) * item.quantity
      cents(amount(lineCents))
      const reservation = await tx.reservation.create({ data: {
        businessId, userId, productId: item.productId, quantity: item.quantity, totalPrice: amount(lineCents),
        depositAmount: type === "DEPOSIT" ? amount(Math.round(lineCents * config.depositPercentage / 100)) : null,
        type, paymentMethod: method, paymentProofUrl: payload.proof, status: type === "DEPOSIT" ? "PENDING_PAYMENT" : "PENDING",
        expiresAt, businessVersion: 1, branchId: branch.id,
      } })
      await tx.inventoryMovement.create({ data: {
        businessId, productId: item.productId, userId, type: "OUT", quantity: item.quantity, branchId: branch.id,
        previousStock: product.stock, newStock: product.stock - item.quantity,
        reason: `Reserva #${reservation.id}`, notes: "Compromiso de existencias; todavía no es una entrega.",
      } })
      if (method === "CREDIT") await addDebt(tx, userId, lineCents, { type: "RESERVATION", id: reservation.id, notes: `Cargo de reserva #${reservation.id}` }, businessId)
      totalCents += lineCents
      reservations.push({ ...reservation, product: { id: product.id, name: product.name }, user: { name: user.name } })
    }
    return { reservations, total: amount(totalCents) }
  })
  // Post-commit: la alerta de stock bajo nunca corre dentro de la transacción.
  await syncLowStockAlerts(db, businessId, collectLowStockIds(items))
  return result
}

/** A reversal offsets the debt ledger only; it is never a cash payment. */
async function reverseReservationDebt(tx: Transaction, reservation: Reservation) {
  if (reservation.paymentMethod !== "CREDIT") return
  if (reservation.businessVersion < 1) throw new BusinessError("La reserva pertenece al historial anterior. Un administrador debe conciliar su crédito antes de cancelarla.", 409, "LEGACY_CREDIT_REVIEW")
  const entries = await tx.creditMovement.findMany({ where: { referenceType: "RESERVATION", referenceId: reservation.id, userId: reservation.userId } })
  const reversalCents = entries.reduce((sum, entry) => sum + (entry.type === "DEBT" ? 1 : -1) * cents(entry.amount), 0)
  if (reversalCents <= 0) return
  const user = await tx.user.findUniqueOrThrow({ where: { id: reservation.userId, businessId: reservation.businessId } })
  const balanceCents = cents(user.creditBalance, true)
  if (balanceCents < reversalCents) throw new BusinessError("Existen abonos que requieren conciliar un saldo a favor. No se modificó la reserva ni el inventario.", 409, "CREDIT_REFUND_REVIEW")
  await tx.user.update({ where: { id: user.id }, data: { creditBalance: amount(balanceCents - reversalCents) } })
  await tx.creditMovement.create({ data: { businessId: reservation.businessId, userId: user.id, amount: amount(reversalCents), type: "REVERSAL", referenceType: "RESERVATION", referenceId: reservation.id, notes: "REVERSIÓN DE DEUDA por cancelación/expiración. No es un abono recibido ni un ingreso de caja." } })
}

const actionSchema = z.object({
  action: z.enum(["cancel", "reject", "approve", "verify_deposit", "pay", "complete", "deliver", "expire"]),
  finalPaymentMethod: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDIT"]).optional(),
  adminNotes: z.string().max(1000).optional(),
})
export type ReservationAction = z.infer<typeof actionSchema>

// Tokens del contrato de reserva → enum de BD (Payment.method). El contrato
// de entrega usa "CREDIT" (a diferencia del "CREDITO" del POS) y el anticipo
// web guarda "TRANSFER"/"STORE"/"CREDIT" del alta.
const DELIVERY_METHOD: Record<string, PaymentMethod> = { EFECTIVO: "CASH", TARJETA: "CARD", TRANSFERENCIA: "TRANSFER", CREDIT: "CREDIT" }
const DEPOSIT_METHOD: Record<string, PaymentMethod> = { STORE: "CASH", TRANSFER: "TRANSFER", CREDIT: "CREDIT", ...DELIVERY_METHOD }

export async function changeReservation(db: PrismaClient, actorId: string | null, businessId: string, id: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  if (actorId === null && input.action !== "expire") throw new BusinessError("Acción no autorizada.", 403)
  if (actorId !== null && input.action === "expire") throw new BusinessError("La expiración se ejecuta desde el proceso del sistema.", 403)
  // Producto repuesto al cancelar/rechazar/expirar: la alerta se sincroniza post-commit.
  const touchedProductIds = new Set<string>()
  const result = await transaction(db, async tx => {
    // Gestión en mostrador (aprobar, verificar anticipo, entregar, rechazar):
    // staff = admin|empleado. "cancel" queda como acción de cliente y la
    // pertencia se valida abajo; staff puede cancelar cualquier reserva.
    const user = actorId ? await actor(tx, actorId, input.action === "cancel" ? "customer" : "staff", businessId) : null
    const reservation = await tx.reservation.findUnique({ where: { id }, include: { product: { select: { id: true, name: true } } } })
    if (!reservation || reservation.businessId !== businessId) throw new BusinessError("Reserva no encontrada.", 404)
    if (user && !["ADMIN", "EMPLOYEE"].includes(user.role) && reservation.userId !== user.id) throw new BusinessError("No autorizado.", 403)
    const target = input.action === "cancel" ? "CANCELLED" : input.action === "reject" ? "REJECTED" : input.action === "expire" ? "EXPIRED" : input.action === "approve" ? "APPROVED" : ["pay", "verify_deposit"].includes(input.action) ? "DEPOSIT_VERIFIED" : "COMPLETED"
    if (reservation.status === target) return { reservation, changed: false, requiresRefund: target === "CANCELLED" && reservation.depositPaid, saleId: null as string | null }
    if (!active(reservation.status)) throw new BusinessError("La reserva ya tiene un estado final y no admite esta acción.", 409, "TERMINAL_RESERVATION")
    const expired = reservation.expiresAt.getTime() <= Date.now()
    if (input.action === "expire" && !expired) throw new BusinessError("La reserva todavía no ha expirado.", 409)
    if (expired && !["cancel", "reject", "expire"].includes(input.action)) throw new BusinessError("La reserva expiró. No puede entregarse ni aprobarse.", 409)

    const config = await settings(tx, businessId)
    let requiresRefund = false
    let deliveredSaleId: string | null = null
    const notes = user && ["ADMIN", "EMPLOYEE"].includes(user.role) ? input.adminNotes : undefined
    let data: Parameters<typeof tx.reservation.update>[0]["data"] = { status: target, ...(notes !== undefined ? { adminNotes: notes } : {}) }

    if (["CANCELLED", "REJECTED", "EXPIRED"].includes(target)) {
      await reverseReservationDebt(tx, reservation)
      const branch = await releaseStock(tx, { productId: reservation.productId, quantity: reservation.quantity, branchId: reservation.branchId, businessId })
      touchedProductIds.add(reservation.productId)
      const product = await tx.product.findUniqueOrThrow({ where: { id: reservation.productId } })
      await tx.inventoryMovement.create({ data: { businessId, productId: product.id, userId: actorId, type: "IN", quantity: reservation.quantity, branchId: branch.id, previousStock: product.stock - reservation.quantity, newStock: product.stock, reason: `Liberación de reserva #${id}: ${target}` } })
      requiresRefund = reservation.depositPaid && (reservation.depositAmount ?? 0) > 0
      if (requiresRefund) data.adminNotes = [notes ?? reservation.adminNotes, "Anticipo pendiente de devolución o conciliación; esta acción no reembolsó dinero."].filter(Boolean).join("\n")
    } else if (target === "DEPOSIT_VERIFIED") {
      if (!["PENDING_PAYMENT", "PENDING"].includes(reservation.status) || !reservation.paymentProofUrl || reservation.type !== "DEPOSIT") throw new BusinessError("Esta reserva no tiene un anticipo pendiente de validar.", 409)
      data = { ...data, depositPaid: true, expiresAt: new Date(Date.now() + config.depositReservationHours * 3600000) }
    } else if (target === "APPROVED") {
      if (reservation.type === "DEPOSIT" && !reservation.depositPaid) throw new BusinessError("Valida primero el anticipo.", 409)
    } else {
      if (reservation.type === "DEPOSIT" && !reservation.depositPaid) throw new BusinessError("Valida primero el anticipo.", 409)
      if (reservation.status === "PENDING_PAYMENT") throw new BusinessError("El pago todavía no está validado.", 409)
      const totalCents = cents(reservation.totalPrice)
      const paidCents = reservation.depositPaid ? cents(reservation.depositAmount ?? reservation.totalPrice, true) : 0
      const dueCents = Math.max(0, totalCents - paidCents)
      const method = reservation.paymentMethod === "CREDIT" ? "CREDIT" : input.finalPaymentMethod
      if (reservation.paymentMethod === "CREDIT" && input.finalPaymentMethod && input.finalPaymentMethod !== "CREDIT") throw new BusinessError("Registra el abono en Crédito; entregar no cambia una deuda a otro medio.", 409)
      if (dueCents > 0 && !method) throw new BusinessError("Selecciona el medio de pago al entregar.")
      const branch = await resolveBranch(tx, reservation.branchId, businessId)
      let cashIn: { id: string } | null = null
      if (method === "CREDIT" && reservation.paymentMethod !== "CREDIT") {
        if (reservation.businessVersion < 1) throw new BusinessError("Revisa manualmente el historial antes de convertir esta reserva a crédito.", 409)
        await addDebt(tx, reservation.userId, dueCents, { type: "RESERVATION", id, notes: `Saldo a crédito al entregar reserva #${id}` }, businessId)
      } else if (method === "EFECTIVO" && dueCents > 0) {
        const register = await openRegister(tx, branch.id, businessId)
        cashIn = await tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId!, type: "IN", amount: amount(dueCents), referenceType: "RESERVATION", referenceId: id, description: `Saldo en efectivo de reserva #${id}` } })
      }
      if (method) data.paymentMethod = method
      // Capa documental de la entrega: la reserva ya movió su stock al nacer
      // ("Compromiso") y el dinero quedó en su ledger (cashMovement / addDebt
      // arriba). Lo que faltaba era el documento — sin Sale la venta del
      // apartado era invisible a folios V-*, reportes y cobros por medio.
      // NO se usa sell(): eso volvería a descontar stock y a cobrar de nuevo.
      const sale = await tx.sale.create({ data: {
        businessId, branchId: branch.id, sellerId: actorId!, customerId: reservation.userId,
        kind: "RETAIL", status: "COMPLETED", total: reservation.totalPrice, discountCents: 0,
      } })
      await tx.saleItem.create({ data: {
        businessId, saleId: sale.id, productId: reservation.productId, quantity: reservation.quantity,
        unitPrice: reservation.totalPrice / reservation.quantity, totalPrice: reservation.totalPrice,
      } })
      // Un Payment por cada bolsa de dinero que realmente se movió: el
      // anticipo verificado (transferencia con comprobante, cobrada antes) y
      // el saldo cobrado al entregar. `reference` apunta a la reserva — es la
      // ligadura sin tocar el esquema.
      if (reservation.depositPaid && paidCents > 0) {
        await tx.payment.create({ data: {
          businessId, saleId: sale.id, purpose: "RESERVATION", reference: reservation.id,
          method: DEPOSIT_METHOD[reservation.paymentMethod ?? ""] ?? "TRANSFER",
          amount: amount(paidCents), status: "CONFIRMED", proofUrl: reservation.paymentProofUrl,
          createdById: actorId!, notes: `Anticipo verificado de reserva #${id}`,
        } })
      }
      if (dueCents > 0 && method) {
        await tx.payment.create({ data: {
          businessId, saleId: sale.id, purpose: "RESERVATION", reference: reservation.id,
          method: DELIVERY_METHOD[method], amount: amount(dueCents), status: "CONFIRMED",
          cashMovementId: cashIn?.id ?? null,
          createdById: actorId!, notes: `Liquidación de reserva #${id}`,
        } })
      }
      deliveredSaleId = sale.id
    }
    const changed = await tx.reservation.updateMany({ where: { id, status: reservation.status }, data })
    if (changed.count !== 1) throw new BusinessError("La reserva cambió durante la operación; reintenta.", 409)
    const updated = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { product: { select: { id: true, name: true } } } })
    return { reservation: updated, changed: true, requiresRefund, saleId: deliveredSaleId }
  })
  await syncLowStockAlerts(db, businessId, [...touchedProductIds])
  return result
}

export async function expireReservations(db: PrismaClient) {
  const expired = await db.reservation.findMany({ where: { status: { in: [...ACTIVE_RESERVATIONS] }, expiresAt: { lte: new Date() } }, select: { id: true, businessId: true }, take: 100, orderBy: { expiresAt: "asc" } })
  let changed = 0
  let reviewRequired = 0
  for (const row of expired) {
    try { if ((await changeReservation(db, null, row.businessId, row.id, { action: "expire" })).changed) changed++ }
    catch (error) {
      if (error instanceof BusinessError) reviewRequired++
      else throw error
    }
  }
  return { examined: expired.length, expired: changed, reviewRequired }
}
