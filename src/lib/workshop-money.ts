// Dinero del taller — módulo puro (sin Prisma ni Node): lo usan el dominio
// (src/lib/domain/workshop.ts), las rutas API y los componentes de cliente.
//
// Convención confirmada por el dueño:
//   quoteCents / approvedQuoteCents = SOLO mano de obra.
//   Las RepairPart con status APPROVED se cobran ADEMÁS de la mano de obra.
//   En cierres sin reparación (NOT_AUTHORIZED / NOT_REPAIRED) la cotización
//   no se cobra: solo aplica diagnosticFeeCents (las refacciones tampoco).
//
// Payment.amount es Float en pesos (legado); las cuentas se hacen en centavos.

export type PartLike = { qty: number; unitCostCents: number; unitPriceCents: number; status?: string | null }

/** Solo las refacciones autorizadas suman a costo/precio; REQUESTED y REJECTED son bitácora.
 *  `status` ausente se trata como APPROVED (registros anteriores al flujo de autorización). */
export function approvedParts<T extends { status?: string | null }>(parts: readonly T[]): T[] {
  return parts.filter(part => part.status === undefined || part.status === null || part.status === "APPROVED")
}

/** Totales en centavos de las refacciones autorizadas: costo, precio y margen. */
export function approvedPartsTotal(parts: readonly PartLike[]) {
  const list = approvedParts(parts)
  const costCents = list.reduce((sum, part) => sum + part.unitCostCents * part.qty, 0)
  const priceCents = list.reduce((sum, part) => sum + part.unitPriceCents * part.qty, 0)
  return { costCents, priceCents, marginCents: priceCents - costCents }
}

export type OrderMoneyLike = {
  status?: string | null
  quoteCents: number | null
  approvedQuoteCents: number | null
  diagnosticFeeCents?: number | null
}

/** Estados donde la orden se entrega sin reparación: no se cobra la
 *  cotización ni las refacciones aprobadas, solo el cargo de diagnóstico. */
const NO_REPAIR_STATUSES: readonly string[] = ["NOT_AUTHORIZED", "NOT_REPAIRED"]

/** Total a cobrar de la orden en centavos (mano de obra + refacciones
 *  autorizadas; o solo el cargo de diagnóstico en cierres sin reparación;
 *  0 en CANCELLED: una orden cancelada no genera cargo).
 *  ÚNICA fuente de verdad para "cuánto cuesta la orden". */
export function orderTotalCents(order: OrderMoneyLike, parts: readonly PartLike[] = []): number {
  if (order.status === "CANCELLED") return 0
  if (order.status !== null && order.status !== undefined && NO_REPAIR_STATUSES.includes(order.status)) {
    return order.diagnosticFeeCents ?? 0
  }
  return (order.approvedQuoteCents ?? order.quoteCents ?? 0) + approvedPartsTotal(parts).priceCents
}

/** Pagos que cuentan como dinero en mano: CONFIRMED suman y las filas
 *  REFUNDED (reembolsos, amount negativo — misma convención que ventas) restan.
 *  PENDING_REVIEW y VOIDED no mueven el saldo. */
export type PaymentLike = { amount: number; status?: string | null }

/** Dinero retenido por el negocio en centavos (neto de reembolsos). */
export function orderHeldCents(payments: readonly PaymentLike[] = []): number {
  const cents = payments.reduce((sum, payment) => {
    if (payment.status !== undefined && payment.status !== null && payment.status !== "CONFIRMED" && payment.status !== "REFUNDED") return sum
    return sum + payment.amount
  }, 0)
  return Math.round(cents * 100)
}

/** Saldo pendiente de cobro en centavos (nunca negativo: el excedente es
 *  dinero a favor del cliente, ver orderOverpaidCents). */
export function orderBalanceCents(order: OrderMoneyLike, parts: readonly PartLike[] = [], payments: readonly PaymentLike[] = []): number {
  return Math.max(0, orderTotalCents(order, parts) - orderHeldCents(payments))
}

/** Excedente a devolver al cliente en centavos (pagó de más). */
export function orderOverpaidCents(order: OrderMoneyLike, parts: readonly PartLike[] = [], payments: readonly PaymentLike[] = []): number {
  return Math.max(0, orderHeldCents(payments) - orderTotalCents(order, parts))
}
