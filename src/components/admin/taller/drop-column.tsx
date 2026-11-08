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
 * - el highlight (dragOverPhaseId === phaseId; el hook solo lo fija cuando
 *   el drop es válido ahí) suma tres pistas: ring sobre la columna, tinte
 *   bg-primary/5 que se transparenta por el bg-muted/40 de la sección hija
 *   y una tira punteada "Suelta para mover aquí" arriba del contenido —
 *   estática, sin animación, así que respeta prefers-reduced-motion.
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
      highlighted && "bg-primary/5 ring-2 ring-primary ring-offset-2 ring-offset-background",
    )}
  >
    {/* Tira de confirmación del drop: solo existe mientras la fase está
        resaltada, así que no desplaza el layout fuera del arrastre. El
        pointer-events-none evita que sea target de dragover propio. */}
    {highlighted && (
      <div className="pointer-events-none mb-1.5 rounded-md border border-dashed border-primary/50 bg-primary/10 px-3 py-1.5 text-center text-xs font-medium text-primary">
        Suelta para mover aquí
      </div>
    )}
    {children}
  </div>
}
