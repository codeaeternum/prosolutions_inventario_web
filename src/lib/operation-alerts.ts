import { escapeAlertHtml, notifyOwner } from "./audit-alerts"

/**
 * Alertas Telegram del dueño por OPERACIONES sensibles (complemento de
 * lib/audit-alerts, que cubre las ediciones administrativas).
 *
 * Los movimientos que aquí se alarman ya quedan en BusinessOperation — este
 * módulo solo decide cuáles además ameritan un grito inmediato al dueño
 * cuando los hace un NO-admin:
 *
 * - SALE_VOID / SALE_DOCUMENT_CANCEL — anular venta o documento con reembolso.
 * - SALE_RETURN — devolución que regresa dinero y stock.
 * - COUNT_APPLY — ajuste masivo de inventario tras conteo físico.
 * - DEBT / CREDIT_DEBT — cargo manual al crédito de un cliente.
 * - CREDIT_PAYMENT — abono que reduce deuda; con tarjeta/transferencia el
 *   folio queda en las notas del movimiento (rastro del dinero).
 * - SUPPLIER_PAYMENT — dinero que sale hacia un proveedor.
 * - SALE_DOCUMENT_CHECKOUT con descuento — la venta cobrada abajo del precio
 *   de catálogo (discountCents > 0 en la respuesta).
 * - SALE a lista de taller — toda venta cobrada a precio no-retail
 *   (priceTier "wholesale" en el recibo), sea cual sea el medio.
 *
 * Se llama fire-and-forget desde operation() DESPUÉS del commit y solo en la
 * ejecución real (un replay idempotente no vuelve a alertar). Nunca lanza:
 * la operación ya ocurrió y un fallo del aviso no debe propagarse.
 */

const ALERTED_OPERATIONS: ReadonlySet<string> = new Set([
  "SALE_VOID",
  "SALE_RETURN",
  "SALE_DOCUMENT_CANCEL",
  "COUNT_APPLY",
  "DEBT",
  "CREDIT_DEBT",
  "CREDIT_PAYMENT",
  "SUPPLIER_PAYMENT",
])

const OPERATION_HEADLINES: Record<string, string> = {
  SALE_VOID: "Anuló una venta",
  SALE_RETURN: "Registró una devolución",
  SALE_DOCUMENT_CANCEL: "Canceló un documento",
  COUNT_APPLY: "Aplicó un conteo físico",
  DEBT: "Cargó saldo a un crédito",
  CREDIT_DEBT: "Cargó saldo a un crédito",
  CREDIT_PAYMENT: "Registró un abono de crédito",
  SUPPLIER_PAYMENT: "Pagó a un proveedor",
}

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })

function moneyText(value: unknown): string | null {
  // Solo para campos *Cents: centavos → pesos al formatear.
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return mxn.format(value / 100)
}

function pesosText(value: unknown): string | null {
  // Campos Float en pesos (creditBalance, total, refunded, amount…).
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return mxn.format(value)
}

/** Detalle corto del recibo para el mensaje; null si no hay nada útil. */
function operationDetail(kind: string, response: Record<string, unknown>): string | null {
  const folio = typeof response.folio === "string" ? response.folio : null
  const number = typeof response.number === "number" ? response.number : null
  const folioText = folio ?? (number != null ? `V-${number}` : null)

  switch (kind) {
    case "SALE_VOID":
    case "SALE_DOCUMENT_CANCEL":
      return folioText
    case "SALE_RETURN": {
      const refunded = pesosText(response.refunded)
      return [folioText, refunded ? `reembolso ${refunded}` : null].filter(Boolean).join(" · ") || null
    }
    case "COUNT_APPLY": {
      const adjustments = typeof response.adjustments === "number" ? `${response.adjustments} ajuste(s)` : null
      const branch = typeof response.branchName === "string" ? response.branchName : null
      return [folioText, adjustments, branch].filter(Boolean).join(" · ") || null
    }
    case "SUPPLIER_PAYMENT": {
      const amount = moneyText(response.amountCents ?? (response.payment as Record<string, unknown> | undefined)?.amountCents)
      return [folioText, amount].filter(Boolean).join(" · ") || null
    }
    case "SALE": {
      // Venta a lista de taller: folio + total cobrado (el "descuento"
      // implícito de la lista no-retail lo refleja el total mismo).
      const total = pesosText(response.total)
      return [folioText, total ? `total ${total}` : null].filter(Boolean).join(" · ") || null
    }
    case "DEBT":
    case "CREDIT_DEBT":
    case "CREDIT_PAYMENT": {
      // El recibo trae el saldo resultante del cliente, no el cargo/abono.
      const balance = pesosText(response.creditBalance)
      return balance ? `saldo ${balance}` : null
    }
    default:
      return folioText
  }
}

/**
 * Evalúa una operación ya persistida y avisa al dueño si es sensible.
 * `executed` distingue ejecución real de replay idempotente.
 */
export async function alertSensitiveOperation(input: {
  businessId: string
  actorId: string
  kind: string
  response: unknown
  executed: boolean
}): Promise<void> {
  try {
    if (!input.executed) return
    const response = (input.response && typeof input.response === "object" ? input.response : {}) as Record<string, unknown>

    // Casos especiales fuera del set: un cobro con descuento autorizado y
    // toda venta cobrada a lista de taller (descuento implícito de la lista
    // no-retail — el precio bajo sin trámite de descuento).
    const isDiscountedCheckout = input.kind === "SALE_DOCUMENT_CHECKOUT"
      && typeof response.discountCents === "number" && response.discountCents > 0
    const isWholesaleSale = input.kind === "SALE" && response.priceTier === "wholesale"
    if (!ALERTED_OPERATIONS.has(input.kind) && !isDiscountedCheckout && !isWholesaleSale) return

    const headline = isDiscountedCheckout
      ? `Cobró con descuento (${mxn.format((response.discountCents as number) / 100)}${typeof response.discountReason === "string" ? `: ${response.discountReason}` : ""})`
      : isWholesaleSale
        ? "Cobró una venta a precio de taller"
        : OPERATION_HEADLINES[input.kind]
    if (!headline) return

    const detail = operationDetail(input.kind, response)
    const lines = [
      "⚠️ <b>Operación sensible</b>",
      `<b>{actor}</b> ${escapeAlertHtml(headline)}`,
    ]
    if (detail) lines.push(`📌 ${escapeAlertHtml(detail)}`)
    await notifyOwner(input.businessId, input.actorId, `op:${input.kind}`, lines)
  } catch (error) {
    console.error("[operation-alerts] alertSensitiveOperation falló:", error)
  }
}
