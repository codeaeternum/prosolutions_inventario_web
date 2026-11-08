/**
 * Helpers puros del tour guiado (spotlight del primer login del staff).
 *
 * El componente `components/admin/guided-tour.tsx` resuelve el elemento
 * objetivo en el DOM y delega aquí el cálculo de dónde cae el tooltip sin
 * salirse del viewport — la misma división que usa command-palette.tsx:
 * helpers puros y testeables en ambiente node.
 */

// Key versionada: se muestra una sola vez por navegador ("done" | "skipped").
// Subir a v2 re-inicia el tour para todos (p. ej. si cambian los pasos).
export const TOUR_STORAGE_KEY = "reficio:tour:v1"

export type TourResult = "done" | "skipped"

export interface TourRect {
  top: number
  left: number
  width: number
  height: number
}

export interface TourSize {
  width: number
  height: number
}

export interface TooltipPosition {
  top: number
  left: number
  // Dónde quedó el tooltip respecto al objetivo ("center" = sin objetivo).
  placement: "top" | "bottom" | "center"
  // Desplazamiento horizontal desde el borde izquierdo del tooltip hasta el
  // centro del objetivo: dónde dibujar la flecha. null en "center".
  arrowLeft: number | null
}

// Aire entre el objetivo y el tooltip.
export const TOUR_GAP = 12
// Margen mínimo del tooltip a los bordes del viewport.
export const TOUR_MARGIN = 12
// Padding visual del "hueco" del overlay alrededor del elemento objetivo.
export const SPOTLIGHT_PADDING = 8
// La flecha no puede caer en la esquina redondeada del tooltip.
const ARROW_MIN_INSET = 20

export function clamp(value: number, min: number, max: number): number {
  // Si max < min (viewport más chico que el tooltip) el margen mínimo gana.
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Posición del tooltip: preferencia por debajo del objetivo; si no cabe,
 * arriba; si no cabe completo en ninguna de las dos, se queda del lado con
 * más espacio y se clampea al viewport. Sin objetivo → tarjeta centrada.
 */
export function positionTooltip(
  target: TourRect | null,
  tip: TourSize,
  viewport: TourSize
): TooltipPosition {
  const maxLeft = Math.max(TOUR_MARGIN, viewport.width - tip.width - TOUR_MARGIN)
  const maxTop = Math.max(TOUR_MARGIN, viewport.height - tip.height - TOUR_MARGIN)

  if (!target) {
    return {
      top: clamp(Math.round((viewport.height - tip.height) / 2), TOUR_MARGIN, maxTop),
      left: clamp(Math.round((viewport.width - tip.width) / 2), TOUR_MARGIN, maxLeft),
      placement: "center",
      arrowLeft: null,
    }
  }

  const centerX = target.left + target.width / 2
  const left = clamp(Math.round(centerX - tip.width / 2), TOUR_MARGIN, maxLeft)

  const belowTop = target.top + target.height + TOUR_GAP
  const aboveTop = target.top - TOUR_GAP - tip.height
  const fitsBelow = belowTop + tip.height <= viewport.height - TOUR_MARGIN
  const fitsAbove = aboveTop >= TOUR_MARGIN

  let placement: "top" | "bottom"
  let top: number
  if (fitsBelow || (!fitsAbove && target.top + target.height / 2 < viewport.height / 2)) {
    placement = "bottom"
    top = belowTop
  } else {
    placement = "top"
    top = aboveTop
  }
  top = clamp(Math.round(top), TOUR_MARGIN, maxTop)

  const arrowLeft = clamp(
    Math.round(centerX - left),
    ARROW_MIN_INSET,
    Math.max(ARROW_MIN_INSET, tip.width - ARROW_MIN_INSET)
  )

  return { top, left, placement, arrowLeft }
}
