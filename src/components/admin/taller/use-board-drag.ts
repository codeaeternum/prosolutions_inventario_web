"use client"

import { useCallback, useRef, useState, type DragEvent } from "react"
import { dropTargetForPhase, type BoardPhaseId } from "@/lib/taller-board"
import { repairLabels, type RepairStage } from "@/lib/workshop-labels"

// MIME propio del payload del arrastre (JSON con {id,status,version}).
// setData además es lo que "arma" el drag en Firefox: sin él, el dragstart
// ni siquiera inicia el gesto.
export const ORDER_DRAG_MIME = "application/x-reficio-order"

/** Lo que la tarjeta arrastrable debe exponer para que el drop arme el PATCH
 *  de status (concurrencia optimista con `version`). La Order completa de la
 *  página lo satisface por tipado estructural. */
export type DraggableBoardOrder = {
  id: string
  status: RepairStage
  version: number
}

/** Resultado del drop para el caller: PATCH /api/workshop/[id] con
 *  { action: "STATUS", expectedVersion, status: targetStage }. */
export type BoardDropResult = {
  orderId: string
  targetStage: RepairStage
  expectedVersion: number
}

export type BoardDrag = {
  /** Id de la orden en arrastre (para atenuar su tarjeta); null fuera de drag. */
  draggingOrderId: string | null
  /** Fase bajo el cursor cuando el drop ahí está permitido (highlight). */
  dragOverPhaseId: BoardPhaseId | null
  /** Factory del onDragStart de la tarjeta: `onDragStart={drag.onCardDragStart(order)}`. */
  onCardDragStart(order: DraggableBoardOrder): (event: DragEvent<HTMLElement>) => void
  /** onDragEnd de la tarjeta; limpia el estado aunque el drop no cayó en columna. */
  onCardDragEnd(): void
  /**
   * Llamar en el onDragOver de la columna: true si el drop ahí está
   * permitido — el llamador debe hacer preventDefault para que el drop
   * ocurra (y el cursor muestre "move" en vez de prohibido).
   */
  onColumnDragOver(phaseId: BoardPhaseId): boolean
  /** Limpia el highlight al salir de la columna. */
  onColumnDragLeave(phaseId: BoardPhaseId): void
  /** Ejecuta el drop: devuelve el payload para el PATCH o null si no aplica. */
  onColumnDrop(phaseId: BoardPhaseId): BoardDropResult | null
}

/**
 * Imagen de arrastre ligera: un div con "folio · etiqueta de etapa" en vez
 * del snapshot de la tarjeta completa (que arrastra semáforo, chips y el
 * botón "Avisar" → ghost ruidoso y ancho). El folio sale del <strong> de la
 * tarjeta y la etapa del payload; si falta alguno cae al textContent plano
 * (≤60 chars). Se monta fuera de pantalla —setDragImage exige nodo en el
 * documento y renderizado— y se quita en el siguiente frame: el navegador
 * ya lo rasterizó al procesar el dragstart.
 */
function createDragGhost(source: HTMLElement, order: DraggableBoardOrder): HTMLDivElement {
  const ghost = document.createElement("div")
  const folio = source.querySelector("strong")?.textContent?.trim()
  const stage = repairLabels[order.status]
  const plain = (source.textContent ?? "").replace(/\s+/g, " ").trim()
  const base = folio || plain
  ghost.textContent = (base ? `${base} · ${stage}` : stage).slice(0, 60)
  ghost.setAttribute("aria-hidden", "true")
  Object.assign(ghost.style, {
    position: "absolute",
    left: "-1000px",
    top: "0",
    maxWidth: "260px",
    padding: "8px 12px",
    border: "1px solid #3f3f46",
    borderRadius: "8px",
    background: "#18181b",
    color: "#fafafa",
    font: "500 12px/1.4 system-ui, sans-serif",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
    pointerEvents: "none",
  })
  return ghost
}

/**
 * Estado del drag & drop del tablero por fases con DnD nativo de HTML5
 * (atributo draggable + dataTransfer).
 *
 * El dataTransfer no se puede leer durante dragover (el estándar lo protege
 * hasta el drop), así que el payload de la orden se guarda en un ref al
 * hacer dragstart y es lo que consultan dragover/drop; el JSON en
 * dataTransfer viaja para que el gesto sea un drag válido y para cualquier
 * listener externo.
 */
export function useBoardDrag(): BoardDrag {
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null)
  const [dragOverPhaseId, setDragOverPhaseId] = useState<BoardPhaseId | null>(null)
  const payloadRef = useRef<DraggableBoardOrder | null>(null)

  const reset = useCallback(() => {
    payloadRef.current = null
    setDraggingOrderId(null)
    setDragOverPhaseId(null)
  }, [])

  const onCardDragStart = useCallback(
    (order: DraggableBoardOrder) => (event: DragEvent<HTMLElement>) => {
      const payload = { id: order.id, status: order.status, version: order.version }
      event.dataTransfer.setData(ORDER_DRAG_MIME, JSON.stringify(payload))
      event.dataTransfer.effectAllowed = "move"
      try {
        const ghost = createDragGhost(event.currentTarget, order)
        document.body.appendChild(ghost)
        // La remoción va antes del setDragImage: si este lanza, el rAF ya
        // programado limpia el nodo igual.
        requestAnimationFrame(() => ghost.remove())
        event.dataTransfer.setDragImage(ghost, 16, 16)
      } catch {
        // Sin ghost propio: el navegador usa la imagen por defecto.
      }
      payloadRef.current = payload
      setDraggingOrderId(order.id)
    },
    [],
  )

  const onCardDragEnd = useCallback(() => {
    reset()
  }, [reset])

  const onColumnDragOver = useCallback((phaseId: BoardPhaseId): boolean => {
    const allowed =
      payloadRef.current !== null &&
      dropTargetForPhase(payloadRef.current.status, phaseId) !== null
    // Solo resalta la fase que acepta el drop; setState con el mismo valor es
    // no-op, así que el dragover repetido no re-renderiza en balde.
    setDragOverPhaseId(current => (allowed ? phaseId : current === phaseId ? null : current))
    return allowed
  }, [])

  const onColumnDragLeave = useCallback((phaseId: BoardPhaseId) => {
    setDragOverPhaseId(current => (current === phaseId ? null : current))
  }, [])

  const onColumnDrop = useCallback(
    (phaseId: BoardPhaseId): BoardDropResult | null => {
      const payload = payloadRef.current
      const targetStage = payload ? dropTargetForPhase(payload.status, phaseId) : null
      reset()
      if (!payload || !targetStage) return null
      return { orderId: payload.id, targetStage, expectedVersion: payload.version }
    },
    [reset],
  )

  return {
    draggingOrderId,
    dragOverPhaseId,
    onCardDragStart,
    onCardDragEnd,
    onColumnDragOver,
    onColumnDragLeave,
    onColumnDrop,
  }
}
