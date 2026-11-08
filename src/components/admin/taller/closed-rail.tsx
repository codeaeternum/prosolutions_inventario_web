"use client"

import { useState, type ReactNode } from "react"
import { PanelRightClose, PanelRightOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { closedColumnStyle } from "@/components/admin/taller/order-card"

/** Carril colapsable de la columna "Cerradas" del tablero por fases.
 *
 *  En pantallas angostas la 5ª columna casi nunca cabe: colapsada queda una
 *  tira vertical de ~48px con el título rotado y el conteo (las cerradas son
 *  archivo, no trabajo activo — basta saber cuántas hay). Expandida renderiza
 *  el área de contenido de una columna w-64 normal, con el mismo alto y scroll
 *  que BoardColumn. El estado es interno: `defaultCollapsed` solo fija el
 *  arranque y el usuario alterna con los botones (mismo patrón que
 *  CollapsibleSection con `defaultOpen`). El contenido llega por `children`
 *  porque las tarjetas las construye la página con sus handlers. */
export function ClosedRail(props: {
  /** Total de órdenes cerradas (badge del carril y de la cabecera). */
  count: number
  /** Arranca colapsado; default true. */
  defaultCollapsed?: boolean
  /** Persiste el estado en localStorage bajo esta clave. */
  storageKey?: string
  /** Tarjetas/estado vacío de la columna expandida. */
  children: ReactNode
}) {
  const [collapsed, setCollapsedRaw] = useState(() => {
    if (!props.storageKey || typeof window === "undefined") return props.defaultCollapsed ?? true
    const stored = window.localStorage.getItem(props.storageKey)
    return stored === null ? (props.defaultCollapsed ?? true) : stored === "1"
  })
  const setCollapsed = (next: boolean) => {
    setCollapsedRaw(next)
    if (props.storageKey) {
      try { window.localStorage.setItem(props.storageKey, next ? "1" : "0") } catch { /* sin storage */ }
    }
  }

  if (collapsed) {
    // La tira entera es el botón de expandir: en táctil un icono de 16px sería
    // un blanco pobre, y el rail no tiene otra acción posible.
    return (
      <section aria-label="Cerradas" className="w-12 shrink-0 snap-start">
        <button
          type="button"
          aria-label="Expandir cerradas"
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          className="flex w-full flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/40 px-1.5 py-3 opacity-70 transition hover:border-primary hover:opacity-100 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <PanelRightOpen size={16} aria-hidden className="shrink-0 text-muted-foreground" />
          {/* vertical-rl + rotate-180: el rótulo se lee de abajo hacia arriba,
              como los raíles laterales de kanban clásicos. */}
          <span className="rotate-180 text-xs font-semibold text-muted-foreground [writing-mode:vertical-rl]">
            Cerradas
          </span>
          <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-medium", closedColumnStyle.badge)}>
            {props.count}
          </span>
        </button>
      </section>
    )
  }

  return (
    <section
      aria-label="Cerradas"
      className="flex w-64 shrink-0 snap-start flex-col rounded-xl border border-dashed bg-muted/40 p-2.5 opacity-70"
    >
      <header className="mb-2 flex items-center gap-2 px-1">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", closedColumnStyle.dot)} />
        <h2 className="truncate text-sm font-semibold">Cerradas</h2>
        <button
          type="button"
          aria-label="Contraer cerradas"
          aria-expanded={true}
          onClick={() => setCollapsed(true)}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        >
          <PanelRightClose size={14} aria-hidden />
        </button>
        {/* El badge queda a la derecha del todo, como en el resto de columnas. */}
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", closedColumnStyle.badge)}>
          {props.count}
        </span>
      </header>
      <div className="max-h-[calc(100dvh-19rem)] space-y-1.5 overflow-y-auto pr-1">{props.children}</div>
    </section>
  )
}
