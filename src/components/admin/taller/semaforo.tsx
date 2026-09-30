"use client"

import { repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { DEFAULT_SLA_HOURS } from "@/lib/workshop-config"

export type SemaforoColor = "verde" | "ambar" | "rojo"

// Lo mínimo que necesita el semáforo: la Order del tablero cumple esta forma
// sin conversión. updatedAt es el proxy del último movimiento (el listado no
// trae historial y cambia con etapa, notas y pagos); createdAt es el respaldo.
export type SemaforoOrder = {
  status: RepairStage
  promisedAt: string | null
  updatedAt?: string | null
  createdAt: string
}

// Cierres definitivos: la orden ya no compite contra la fecha promesa ni se
// "atora" en una etapa. Más amplio que terminalStages de la página (que solo
// marca DELIVERED/CANCELLED para bloquear cobros): NOT_REPAIRED y
// NOT_AUTHORIZED también son cierre — no llevan semáforo. EXTERNAL_LAB
// tampoco: el equipo está fuera del taller y su espera la mide la orden
// espejo del taller asociado.
const terminalSemaforo: readonly RepairStage[] = ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED", "EXTERNAL_LAB"]

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Semáforo de antigüedad de la orden. null en cierres y laboratorio externo
 *  (no aplican), "rojo" con la promesa vencida o al superar el SLA de su etapa
 *  sin fecha promesa, "ambar" si la promesa vence en ≤24 h o la etapa entra en
 *  el último 20% de su SLA, "verde" para el resto. `slaHours` llega del ajuste
 *  workshop_sla_hours del negocio; sin él rige DEFAULT_SLA_HOURS. */
export function semaforo(order: SemaforoOrder, now: Date = new Date(), slaHours: Partial<Record<RepairStage, number>> = DEFAULT_SLA_HOURS): SemaforoColor | null {
  if (terminalSemaforo.includes(order.status)) return null
  if (order.promisedAt) {
    const remaining = new Date(order.promisedAt).getTime() - now.getTime()
    if (remaining < 0) return "rojo"
    if (remaining <= DAY_MS) return "ambar"
    return "verde"
  }
  // Sin fecha promesa el reloj lo pone el SLA de la etapa (updatedAt como
  // proxy del último movimiento). Las etapas sin SLA propio — WARRANTY, la
  // única activa fuera de SLA_STAGES — no llevan semáforo por antigüedad.
  const sla = slaHours[order.status]
  if (sla === undefined) return null
  const elapsed = now.getTime() - new Date(order.updatedAt ?? order.createdAt).getTime()
  const slaMs = sla * HOUR_MS
  if (elapsed > slaMs) return "rojo"
  if (elapsed >= slaMs * 0.8) return "ambar"
  return "verde"
}

// Leyenda compacta junto al punto: el color da la urgencia de un vistazo y el
// texto explica el porqué — "2d retraso", "vence hoy", "4d · Esperando
// refacción" cuando no hay fecha prometida.
export function semaforoLabel(order: SemaforoOrder, color: SemaforoColor, now: Date = new Date()): string {
  if (order.promisedAt) {
    const promised = new Date(order.promisedAt)
    if (color === "rojo") {
      const days = Math.floor((now.getTime() - promised.getTime()) / DAY_MS)
      return days === 0 ? "venció hoy" : `${days}d retraso`
    }
    if (color === "ambar") {
      // Dentro de la ventana de 24 h: si cae en el día calendario siguiente
      // es más claro decir "mañana" que un conteo de horas.
      const sameDay = promised.getFullYear() === now.getFullYear() && promised.getMonth() === now.getMonth() && promised.getDate() === now.getDate()
      return sameDay ? "vence hoy" : "vence mañana"
    }
    return "a tiempo"
  }
  const days = Math.max(0, Math.floor((now.getTime() - new Date(order.updatedAt ?? order.createdAt).getTime()) / DAY_MS))
  return `${days === 0 ? "hoy" : `${days}d`} · ${repairLabels[order.status]}`
}

const semaforoStyles: Record<SemaforoColor, { dot: string; text: string }> = {
  rojo: { dot: "bg-rose-500", text: "font-medium text-rose-600 dark:text-rose-400" },
  ambar: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  verde: { dot: "bg-emerald-500", text: "text-muted-foreground" },
}

/** Punto de color + leyenda de antigüedad, del tamaño de los items de la
 *  fila de metadatos de la tarjeta/lista (icono de 12px + texto xs). */
export function SemaforoBadge({ order, slaHours, className }: { order: SemaforoOrder; slaHours?: Partial<Record<RepairStage, number>>; className?: string }) {
  const now = new Date()
  const color = semaforo(order, now, slaHours)
  if (!color) return null
  const style = semaforoStyles[color]
  const sla = order.promisedAt ? undefined : slaHours?.[order.status]
  const title = order.promisedAt
    ? `Entrega prometida: ${new Date(order.promisedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`
    : sla === undefined ? "Sin fecha de entrega prometida" : `Sin fecha de entrega prometida · SLA de etapa: ${sla} h`
  return <span title={title} className={`inline-flex items-center gap-1 ${style.text} ${className ?? ""}`}>
    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
    {semaforoLabel(order, color, now)}
  </span>
}
