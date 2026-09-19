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
/** Folio impreso con prefijo configurable: solo letras/dígitos, máx. 8. */
export const formatFolio = (prefix: string | null | undefined, number: number) => {
  const clean = (prefix ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)
  return `${clean || DEFAULT_ORDER_PREFIX}-${String(number).padStart(6, "0")}`
}
export const repairFolio = (number: number) => formatFolio(DEFAULT_ORDER_PREFIX, number)
