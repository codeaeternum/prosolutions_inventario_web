export const repairLabels = {
  RECEIVED: "Recibido", DIAGNOSIS: "En diagnóstico", WAITING_APPROVAL: "Esperando autorización",
  WAITING_PARTS: "Esperando refacción", IN_REPAIR: "En reparación", QUALITY_CHECK: "En revisión final",
  READY: "Listo para entregar", DELIVERED: "Entregado", CANCELLED: "Cancelado",
  NOT_REPAIRED: "No quedó", NOT_AUTHORIZED: "No autorizado", EXTERNAL_LAB: "Laboratorio externo",
  WARRANTY: "En garantía",
} as const
export type RepairStage = keyof typeof repairLabels
// DELIVERED no aparece como destino: la entrega física solo ocurre por la
// acción SETTLE_DELIVER, que cobra el saldo y libera las refacciones. Un
// STATUS→DELIVERED directo entregaría sin cobrar ni reponer inventario.
export const repairNextStages: Record<RepairStage, RepairStage[]> = {
  RECEIVED: ["DIAGNOSIS", "CANCELLED"], DIAGNOSIS: ["EXTERNAL_LAB", "CANCELLED"],
  WAITING_APPROVAL: ["DIAGNOSIS", "NOT_AUTHORIZED", "CANCELLED"],
  WAITING_PARTS: ["IN_REPAIR", "EXTERNAL_LAB", "CANCELLED"],
  IN_REPAIR: ["WAITING_PARTS", "EXTERNAL_LAB", "QUALITY_CHECK", "NOT_REPAIRED", "CANCELLED"],
  EXTERNAL_LAB: ["IN_REPAIR", "QUALITY_CHECK", "NOT_REPAIRED"],
  QUALITY_CHECK: ["IN_REPAIR", "READY", "NOT_REPAIRED"],
  READY: ["QUALITY_CHECK"],
  NOT_REPAIRED: [], NOT_AUTHORIZED: ["DIAGNOSIS"],
  DELIVERED: ["WARRANTY"], WARRANTY: ["IN_REPAIR", "NOT_REPAIRED"],
  CANCELLED: [],
}
/** Etapas desde las que SETTLE_DELIVER puede entregar el equipo (con cobro y
 *  cierre de refacciones): lista para entregar, cierre sin reparación, o el
 *  reingreso por garantía que se devuelve — esa entrega cierra el ciclo de
 *  garantía (warrantyUntil queda en null, warrantyCount conserva la N). */
export const repairDeliverableStages: readonly RepairStage[] = ["READY", "NOT_REPAIRED", "NOT_AUTHORIZED", "WARRANTY"]
// Vigencia de la garantía: SystemSettings["warranty_days"] del negocio fija
// los días al reabrir una orden entregada (STATUS→WARRANTY en domain/workshop);
// sin la llave o con un valor inválido rige el default. Se edita desde
// /admin/configuracion (api/workshop-config).
export const WARRANTY_DAYS_KEY = "warranty_days"
export const DEFAULT_WARRANTY_DAYS = 30
export const MAX_WARRANTY_DAYS = 3650
/** Prefijo de folio por defecto; el negocio lo cambia con el ajuste
 *  `order_prefix` de SystemSettings (p. ej. "PS" → PS-000001). */
export const DEFAULT_ORDER_PREFIX = "OT"
/** Ajuste SystemSettings `order_folio_digits`: largo del consecutivo impreso
 *  (4–8 dígitos, default 6 → OT-000123 vs OT-0123). */
export const ORDER_FOLIO_DIGITS_KEY = "order_folio_digits"
export const DEFAULT_FOLIO_DIGITS = 6
export const MIN_FOLIO_DIGITS = 4
export const MAX_FOLIO_DIGITS = 8
/** Acota el ajuste al rango soportado; lo no numérico cae al default. */
export const clampFolioDigits = (digits: number | null | undefined): number =>
  typeof digits === "number" && Number.isFinite(digits)
    ? Math.min(MAX_FOLIO_DIGITS, Math.max(MIN_FOLIO_DIGITS, Math.trunc(digits)))
    : DEFAULT_FOLIO_DIGITS
/** Interpreta el valor crudo de SystemSettings (texto) como dígitos de folio. */
export const parseFolioDigits = (value: string | null | undefined): number =>
  clampFolioDigits(value == null || value.trim() === "" ? undefined : Number(value))
/** Folio impreso con prefijo configurable: solo letras/dígitos, máx. 8.
 *  `digits` fija el largo del consecutivo (4–8; default 6). */
export const formatFolio = (prefix: string | null | undefined, number: number, digits?: number) => {
  const clean = (prefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
  return `${clean || DEFAULT_ORDER_PREFIX}-${String(number).padStart(clampFolioDigits(digits), "0")}`
}
export const repairFolio = (number: number, digits?: number) => formatFolio(DEFAULT_ORDER_PREFIX, number, digits)
