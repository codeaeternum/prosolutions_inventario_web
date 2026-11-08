"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

// Sección colapsable para la ficha de orden del taller. Usa <details>/<summary>
// nativo — el mismo patrón que ya usa page.tsx — con estado interno inicializado
// por `defaultOpen` (solo fija el arranque; el usuario siempre puede abrir y
// cerrar a mano). `badge` muestra un conteo junto al título y `actions` lleva
// botones de header; sus clics se detienen para no togglear el <details>.
export function CollapsibleSection(props: {
    title: ReactNode
    /** Conteo o etiqueta breve junto al título (p. ej. "3 fotos", saldo). */
    badge?: ReactNode
    /** Botones/enlaces del header, alineados a la derecha. */
    actions?: ReactNode
    /** Estado inicial; default true. */
    defaultOpen?: boolean
    children: ReactNode
    className?: string
}) {
    const [open, setOpen] = useState(props.defaultOpen ?? true)
    return (
        <details
            open={open}
            onToggle={event => setOpen(event.currentTarget.open)}
            className={cn("group rounded-xl border bg-card", props.className)}
        >
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-4 text-sm font-semibold outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                <span className="flex-1">{props.title}</span>
                {props.badge && (
                    <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground">
                        {props.badge}
                    </span>
                )}
                {props.actions && (
                    // Los botones del header no deben togglear el <details>: el
                    // clic se detiene antes de que llegue al <summary>.
                    <span className="flex shrink-0 items-center gap-2 font-normal" onClick={event => event.stopPropagation()}>
                        {props.actions}
                    </span>
                )}
            </summary>
            <div className="space-y-3 p-4 pt-0">{props.children}</div>
        </details>
    )
}
