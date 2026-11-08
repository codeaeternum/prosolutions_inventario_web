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

// ---------------------------------------------------------------------------
// Drag & drop entre fases.
//
// El drop no apunta a una etapa suelta sino a la fase completa: cada fase
// tiene una etapa destino canónica (PHASE_TARGET_STAGE) y el servidor sigue
// validando la transición concreta (repairNextStages + expectedVersion), así
// que el board solo decide si el movimiento "tiene sentido" para ofrecer el
// drop — no si es legal.

/** Id de fase del tablero (atajo de `BoardPhase["id"]`). */
export type BoardPhaseId = BoardPhase["id"]

/** Etapa destino canónica al soltar una orden sobre cada fase del tablero. */
export const PHASE_TARGET_STAGE: Record<BoardPhaseId, RepairStage> = {
  entrada: "RECEIVED",
  espera: "WAITING_APPROVAL",
  reparacion: "IN_REPAIR",
  listas: "READY",
  cerradas: "DELIVERED",
}

// Orden de avance del pipeline para isForwardMove. Replica ALL_BOARD_STAGES
// (activas en orden de flujo, cerradas al final); el orden interno de las
// cerradas no importa porque el drop bloquea casi todos sus movimientos.
const FORWARD_STAGE_ORDER: readonly RepairStage[] = [
  "RECEIVED",
  "DIAGNOSIS",
  "WAITING_APPROVAL",
  "WAITING_PARTS",
  "EXTERNAL_LAB",
  "IN_REPAIR",
  "QUALITY_CHECK",
  "READY",
  "DELIVERED",
  "NOT_REPAIRED",
  "NOT_AUTHORIZED",
  "CANCELLED",
  "WARRANTY",
]

/**
 * ¿`to` está después que `from` en el pipeline? Compara posiciones en
 * FORWARD_STAGE_ORDER; etapas null/desconocidas o iguales cuentan como "no
 * avanza". Lo usa la UI para distinguir drops de avance de retrocesos.
 */
export function isForwardMove(
  from: RepairStage | null | undefined,
  to: RepairStage | null | undefined,
): boolean {
  if (!from || !to || from === to) return false
  const fromIndex = FORWARD_STAGE_ORDER.indexOf(from)
  return fromIndex >= 0 && FORWARD_STAGE_ORDER.indexOf(to) > fromIndex
}

/**
 * Etapa destino al soltar en `phaseId` una orden que está en `orderStatus`;
 * null cuando el drop no tiene sentido y la columna no debe ofrecerse:
 * - soltar en la misma fase de la orden no mueve nada;
 * - salir de "cerradas" reabre la orden → va por el flujo de detalle;
 * - entrar a "cerradas" solo desde READY (entrega directa); los demás
 *   cierres llevan detalle obligatorio (motivo, cobro, etc.).
 * El resto de movimientos —incluso los que van "hacia atrás"— devuelven la
 * etapa canónica de la fase: la validez fina la decide el servidor.
 * Tolerante a null/undefined en ambos argumentos.
 */
export function dropTargetForPhase(
  orderStatus: RepairStage | null | undefined,
  phaseId: BoardPhaseId | null | undefined,
): RepairStage | null {
  if (!orderStatus || !phaseId) return null
  const sourcePhase = phaseOfStage(orderStatus)
  if (!sourcePhase || sourcePhase.id === phaseId || sourcePhase.id === "cerradas") return null
  if (phaseId === "cerradas") return orderStatus === "READY" ? "DELIVERED" : null
  return PHASE_TARGET_STAGE[phaseId] ?? null
}
