export const repairLabels = {
  RECEIVED: "Recibido", DIAGNOSIS: "En diagnóstico", WAITING_APPROVAL: "Esperando autorización",
  WAITING_PARTS: "Esperando refacción", IN_REPAIR: "En reparación", QUALITY_CHECK: "En revisión final",
  READY: "Listo para entregar", DELIVERED: "Entregado", CANCELLED: "Cancelado",
  NOT_REPAIRED: "No quedó", NOT_AUTHORIZED: "No autorizado", EXTERNAL_LAB: "Laboratorio externo",
  WARRANTY: "En garantía",
} as const
export type RepairStage = keyof typeof repairLabels
export const repairNextStages: Record<RepairStage, RepairStage[]> = {
  RECEIVED: ["DIAGNOSIS", "CANCELLED"], DIAGNOSIS: ["EXTERNAL_LAB", "CANCELLED"],
  WAITING_APPROVAL: ["DIAGNOSIS", "NOT_AUTHORIZED", "CANCELLED"],
  WAITING_PARTS: ["IN_REPAIR", "EXTERNAL_LAB", "CANCELLED"],
  IN_REPAIR: ["WAITING_PARTS", "EXTERNAL_LAB", "QUALITY_CHECK", "NOT_REPAIRED", "CANCELLED"],
  EXTERNAL_LAB: ["IN_REPAIR", "QUALITY_CHECK", "NOT_REPAIRED"],
  QUALITY_CHECK: ["IN_REPAIR", "READY", "NOT_REPAIRED"],
  READY: ["QUALITY_CHECK", "DELIVERED"],
  NOT_REPAIRED: ["DELIVERED"], NOT_AUTHORIZED: ["DIAGNOSIS", "DELIVERED"],
  DELIVERED: ["WARRANTY"], WARRANTY: ["IN_REPAIR", "NOT_REPAIRED"],
  CANCELLED: [],
}
export const repairFolio = (number: number) => `OT-${String(number).padStart(6, "0")}`
