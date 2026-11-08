"use client"

import { useEffect, type RefObject } from "react"

// Zona junto a cada borde que dispara el auto-scroll y velocidad por frame
// (8px × ~60fps ≈ 480px/s: una columna de 256px se recorre en ~½s).
const EDGE_ZONE_PX = 60
const SCROLL_STEP_PX = 8
// dragover deja de llegar si el puntero sale de la ventana; sin un evento
// reciente se frena aunque la última posición conocida estuviera en la zona.
const DRAGOVER_STALE_MS = 150

/**
 * Auto-scroll horizontal del contenedor del tablero durante un arrastre:
 * con el puntero a ≤60px del borde izquierdo/derecho avanza ~8px por frame
 * vía requestAnimationFrame. Solo horizontal — cada columna tiene su propio
 * scroll vertical y empujar ambos a la vez marea.
 *
 * `dragover` burbujea hasta document durante todo el gesto (Chrome lo
 * re-emite aunque el puntero esté quieto) y reporta clientX correcto, así
 * que basta un listener global; no hace falta preventDefault para seguir
 * recibiéndolo.
 *
 * `active` enciende/apaga: el caller pasa `drag.draggingOrderId !== null` y
 * el cleanup ocurre solo al terminar el drag (dragend → estado en null).
 *
 * Uso:
 *   const boardScrollRef = useRef<HTMLDivElement>(null)
 *   useBoardAutoScroll(boardScrollRef, boardDrag.draggingOrderId !== null)
 *   <div ref={boardScrollRef} className="… overflow-x-auto …">
 */
export function useBoardAutoScroll(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return

    let rafId = 0
    let direction = 0
    let lastDragOverAt = 0

    const onDragOver = (event: DragEvent) => {
      const container = containerRef.current
      if (!container) return
      lastDragOverAt = Date.now()
      const rect = container.getBoundingClientRect()
      if (event.clientX <= rect.left + EDGE_ZONE_PX) direction = -1
      else if (event.clientX >= rect.right - EDGE_ZONE_PX) direction = 1
      else direction = 0
    }

    const tick = () => {
      if (direction !== 0 && Date.now() - lastDragOverAt < DRAGOVER_STALE_MS) {
        const container = containerRef.current
        // scrollLeft se satura solo en los extremos; no hace falta clamp.
        if (container) container.scrollLeft += direction * SCROLL_STEP_PX
      }
      rafId = requestAnimationFrame(tick)
    }

    document.addEventListener("dragover", onDragOver)
    rafId = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener("dragover", onDragOver)
      cancelAnimationFrame(rafId)
    }
  }, [containerRef, active])
}
