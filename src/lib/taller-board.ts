import type { RepairStage } from "./workshop-labels"

// Modelo puro del tablero de taller agrupado por fases.
//
// ¿Por qué fases? El kanban actual renderiza 9 columnas (8 activas + la
// combinada de cerradas) y en pantalla normal eso obliga a scroll
// horizontal — el técnico no ve el flujo completo. Agrupar las 13 etapas en
// 5 fases (Entrada → En espera → En reparación → Listas → Cerradas) deja el
// pipeline entero visible sin scroll; el detalle por etapa se resuelve con
// tooltips/desglose dentro de cada fase, no con una columna por etapa.

/** Etapas con trabajo en curso (las 8 columnas activas del tablero actual). */
export const ACTIVE_BOARD_STAGES: readonly RepairStage[] = [
  "RECEIVED",
  "DIAGNOSIS",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "EXTERNAL_LAB",
  "IN_REPAIR",
  "QUALITY_CHECK",
  "READY",
]

/** Etapas terminales/cerradas (hoy una sola columna combinada). */
export const CLOSED_BOARD_STAGES: readonly RepairStage[] = [
  "DELIVERED",
  "NOT_REPAIRED",
  "NOT_AUTHORIZED",
  "CANCELLED",
  "WARRANTY",
]

/** Todas las etapas que aparecen en el tablero, en orden de pipeline. */
export const ALL_BOARD_STAGES: readonly RepairStage[] = [
  ...ACTIVE_BOARD_STAGES,
  ...CLOSED_BOARD_STAGES,
]

export type BoardPhase = {
  id: "entrada" | "espera" | "reparacion" | "listas" | "cerradas"
  /** Nombre visible de la fase (español). */
  label: string
  /** Etapas de la fase en orden de pipeline (define el orden de las tarjetas). */
  stages: readonly RepairStage[]
}

/**
 * Las 5 columnas del tablero por fases. `stages` de cada fase es la
 * partición de ALL_BOARD_STAGES: cada etapa del board pertenece a
 * exactamente una fase (lo verifica el test de partición).
 */
export const BOARD_PHASES: readonly BoardPhase[] = [
  { id: "entrada", label: "Entrada", stages: ["RECEIVED", "DIAGNOSIS"] },
  { id: "espera", label: "En espera", stages: ["WAITING_APPROVAL", "WAITING_PARTS", "EXTERNAL_LAB"] },
  { id: "reparacion", label: "En reparación", stages: ["IN_REPAIR", "QUALITY_CHECK"] },
  { id: "listas", label: "Listas", stages: ["READY"] },
  { id: "cerradas", label: "Cerradas", stages: ["DELIVERED", "NOT_REPAIRED", "NOT_AUTHORIZED", "CANCELLED", "WARRANTY"] },
]

/** Fase a la que pertenece una etapa del board; undefined si no está mapeada. */
export function phaseOfStage(stage: RepairStage): BoardPhase | undefined {
  return BOARD_PHASES.find(phase => phase.stages.includes(stage))
}

/**
 * Índice de `stage` dentro de `phase.stages` (posición en el pipeline de la
 * fase). -1 si la etapa no pertenece a la fase.
 */
export function stageIndexInPhase(phase: BoardPhase, stage: RepairStage): number {
  return phase.stages.indexOf(stage)
}

/**
 * Órdenes de la fase: junta las listas de sus etapas y las ordena primero
 * por posición de la etapa en el pipeline de la fase, luego por createdAt
 * ASC — la orden más vieja primero, porque es la más urgente. Tolerante a
 * `orders` null/undefined y a etapas sin entrada en el record (?? []); no
 * muta el input (el sort va sobre el arreglo nuevo de flatMap).
 */
export function phaseOrders<T extends { status: RepairStage; createdAt: string }>(
  phase: BoardPhase,
  orders: Record<RepairStage, T[]> | null | undefined,
): T[] {
  return phase.stages
    .flatMap(stage => orders?.[stage] ?? [])
    .sort((a, b) => {
      const stageDelta = stageIndexInPhase(phase, a.status) - stageIndexInPhase(phase, b.status)
      // ISO 8601 ordena igual por código de carácter que por fecha.
      return stageDelta !== 0 ? stageDelta : a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
    })
}

/** Total de órdenes de la fase: suma de `totals` de sus etapas. */
export function phaseTotal(
  phase: BoardPhase,
  totals: Record<RepairStage, number> | null | undefined,
): number {
  return phase.stages.reduce((sum, stage) => sum + (totals?.[stage] ?? 0), 0)
}

/**
 * Desglose por etapa para el tooltip de la fase ("2 recibidos ·
 * 3 diagnóstico"): solo etapas con count > 0, en el orden de
 * `phase.stages`.
 */
export function phaseStageCounts(
  phase: BoardPhase,
  totals: Record<RepairStage, number> | null | undefined,
): { stage: RepairStage; count: number }[] {
  return phase.stages
    .map(stage => ({ stage, count: totals?.[stage] ?? 0 }))
    .filter(entry => entry.count > 0)
}
