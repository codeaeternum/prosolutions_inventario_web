"use client"

import { cn } from "@/lib/utils"

/** Fase del tablero tal como la ve la barra de navegación. `color` es el par
 *  { dot, badge } que ya usan `phaseStyles`, `stageStyles` y
 *  `closedColumnStyle`: el punto marca el color de la fase y el badge de
 *  conteo lleva el mismo tinte, igual que la cabecera de cada columna. */
export type PhaseNavPhase = {
  id: string
  label: string
  count: number
  color: { dot: string; badge: string }
}

export type PhaseNavProps = {
  phases: PhaseNavPhase[]
  /** Fase activa (chip resaltado); ninguna cuando la columna no aplica. */
  activeId?: string
  onSelect(id: string): void
}

/** Barra de chips para saltar entre fases en pantallas angostas, donde las 5
 *  columnas del tablero quedan fuera del viewport y el snap-x obliga a
 *  hojear. Cada chip replica la cabecera de su columna (punto + nombre +
 *  conteo) en formato compacto h-7. Es presentacional: `onSelect` decide si
 *  hace scroll a la columna, filtra, etc. La fila hace scroll horizontal si
 *  los chips no caben — mismo patrón aria-pressed que el grupo de vistas. */
export function PhaseNav({ phases, activeId, onSelect }: PhaseNavProps) {
  return (
    <nav aria-label="Saltar a fase" className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {phases.map(phase => {
        const active = phase.id === activeId
        return (
          <button
            key={phase.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(phase.id)}
            className={cn(
              "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-primary",
              active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", phase.color.dot)} />
            {phase.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none",
                active ? "bg-primary-foreground/20 text-primary-foreground" : phase.color.badge,
              )}
            >
              {phase.count}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
