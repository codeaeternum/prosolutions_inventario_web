export const repairLabels = {
  RECEIVED: "Recibido", DIAGNOSIS: "En diagnóstico", WAITING_APPROVAL: "Esperando autorización",
  WAITING_PARTS: "Esperando refacción", IN_REPAIR: "En reparación", QUALITY_CHECK: "En revisión final",
  READY: "Listo para entregar", DELIVERED: "Entregado", CANCELLED: "Cancelado",
} as const
export type RepairStage = keyof typeof repairLabels
export const repairNextStages: Record<RepairStage, RepairStage[]> = {
  RECEIVED: ["DIAGNOSIS", "CANCELLED"], DIAGNOSIS: ["CANCELLED"],
  WAITING_APPROVAL: ["DIAGNOSIS", "CANCELLED"], WAITING_PARTS: ["IN_REPAIR", "CANCELLED"],
  IN_REPAIR: ["WAITING_PARTS", "QUALITY_CHECK", "CANCELLED"],
  QUALITY_CHECK: ["IN_REPAIR", "READY"], READY: ["QUALITY_CHECK", "DELIVERED"],
  DELIVERED: [], CANCELLED: [],
}
export const repairFolio = (number: number) => `OT-${String(number).padStart(6, "0")}`
