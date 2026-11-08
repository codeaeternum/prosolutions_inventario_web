"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { BoardPhaseId } from "@/lib/taller-board"
import type { BoardDrag, BoardDropResult } from "@/components/admin/taller/use-board-drag"

type DropColumnProps = {
  /** Fase del tablero que esta columna representa (target del drop). */
  phaseId: BoardPhaseId
  /** Estado/handlers del drag: el retorno de useBoardDrag(). */
  hook: BoardDrag
  /** id del wrapper: la PhaseNav lo usa como ancla de scroll. */
  id?: string
  className?: string
  /** Recibe el payload listo para el PATCH cuando el drop fue válido. */
  onDropResult?: (result: BoardDropResult) => void
  children: ReactNode
}

/**
 * Envoltorio drop-target de una columna del tablero por fases. Cablea los
 * eventos nativos de DnD contra useBoardDrag:
 * - onDragOver solo hace preventDefault cuando el drop está permitido, así
 *   el cursor muestra "move" en columnas válidas y "prohibido" en las demás;
 * - onDragLeave ignora las salidas falsas (entrar a un hijo también dispara
 *   dragleave) comparando relatedTarget;
 * - el highlight es un ring sobre la columna mientras dragOverPhaseId ===
 *   phaseId (el hook solo lo fija cuando el drop es válido ahí).
 */
export function DropColumn({ phaseId, hook, id, className, onDropResult, children }: DropColumnProps) {
  const highlighted = hook.dragOverPhaseId === phaseId
  return <div
    id={id}
    data-phase={phaseId}
    onDragOver={event => {
      if (hook.onColumnDragOver(phaseId)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
      }
    }}
    onDragLeave={event => {
      // Salir hacia un descendiente no es salir de la columna: el dragleave
      // dispara al cruzar cualquier hijo (tarjetas, badges, ...).
      const next = event.relatedTarget as Node | null
      if (!next || !event.currentTarget.contains(next)) {
        hook.onColumnDragLeave(phaseId)
      }
    }}
    onDrop={event => {
      event.preventDefault()
      const result = hook.onColumnDrop(phaseId)
      if (result) onDropResult?.(result)
    }}
    className={cn(
      className,
      highlighted && "ring-2 ring-primary ring-offset-2 ring-offset-background",
    )}
  >
    {children}
  </div>
}
