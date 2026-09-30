"use client"

import { repairLabels, type RepairStage } from "@/lib/workshop-labels"

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
// NOT_AUTHORIZED también son cierre — no llevan semáforo.
const terminalSemaforo: readonly RepairStage[] = ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"]

const DAY_MS = 24 * 60 * 60 * 1000
// Sin fecha promesa, más de 72 h en la misma etapa cuenta como orden atorada.
const STUCK_MS = 3 * DAY_MS

/** Semáforo de antigüedad de la orden. null en cierres (no aplica), "rojo"
 *  con la promesa vencida, "ambar" si vence en ≤24 h o lleva >72 h sin
 *  moverse sin fecha promesa, "verde" para el resto. */
export function semaforo(order: SemaforoOrder, now: Date = new Date()): SemaforoColor | null {
  if (terminalSemaforo.includes(order.status)) return null
  if (order.promisedAt) {
    const remaining = new Date(order.promisedAt).getTime() - now.getTime()
    if (remaining < 0) return "rojo"
    if (remaining <= DAY_MS) return "ambar"
    return "verde"
  }
  const lastMove = new Date(order.updatedAt ?? order.createdAt).getTime()
  return now.getTime() - lastMove > STUCK_MS ? "ambar" : "verde"
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
export function SemaforoBadge({ order, className }: { order: SemaforoOrder; className?: string }) {
  const now = new Date()
  const color = semaforo(order, now)
  if (!color) return null
  const style = semaforoStyles[color]
  const title = order.promisedAt
    ? `Entrega prometida: ${new Date(order.promisedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`
    : "Sin fecha de entrega prometida"
  return <span title={title} className={`inline-flex items-center gap-1 ${style.text} ${className ?? ""}`}>
    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
    {semaforoLabel(order, color, now)}
  </span>
}
