import type { RepairStage } from "./workshop-labels"

// SLA por etapa del taller: horas máximas que una orden puede permanecer en
// una etapa sin moverse antes de que el semáforo la declare atrasada. Se
// guarda en SystemSettings["workshop_sla_hours"] como JSON { etapa: horas }
// y se edita desde /admin/configuracion (api/workshop-config).
//
// Solo las etapas activas del flujo interno llevan reloj: los cierres no
// aplican, EXTERNAL_LAB se mide del lado del taller asociado por la orden
// espejo y WARRANTY hereda el reloj de la etapa a la que reingresa.
export const SLA_HOURS_KEY = "workshop_sla_hours"
export const SLA_STAGES = ["RECEIVED", "DIAGNOSIS", "WAITING_APPROVAL", "WAITING_PARTS", "IN_REPAIR", "QUALITY_CHECK", "READY"] as const satisfies readonly RepairStage[]
export type SlaStage = (typeof SLA_STAGES)[number]
export type SlaHours = Record<SlaStage, number>
export const DEFAULT_SLA_HOURS: SlaHours = {
  RECEIVED: 24, DIAGNOSIS: 24, WAITING_APPROVAL: 48, WAITING_PARTS: 120,
  IN_REPAIR: 48, QUALITY_CHECK: 24, READY: 72,
}

/** Lee el mapa de SLA desde el valor crudo de SystemSettings (JSON en texto)
 *  o desde la respuesta de GET /api/workshop-config: las etapas ausentes o
 *  con un valor inválido quedan en su default. */
export function readSlaHours(value: unknown): SlaHours {
  let source: unknown = value
  if (typeof source === "string") {
    try { source = JSON.parse(source) } catch { source = undefined }
  }
  const hours: SlaHours = { ...DEFAULT_SLA_HOURS }
  if (source !== null && typeof source === "object" && !Array.isArray(source)) {
    for (const stage of SLA_STAGES) {
      const raw = (source as Record<string, unknown>)[stage]
      if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) hours[stage] = raw
    }
  }
  return hours
}
