"use client"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Keyboard } from "lucide-react"

const HINTS: [string, string][] = [
    ["F2 / Ctrl+Enter", "Cobrar"],
    ["/", "Ir al buscador"],
    ["F4", "Tickets / Devoluciones"],
    ["F9", "Suspender"],
    ["Esc", "Cerrar / limpiar búsqueda"],
    ["+ / −", "Cantidad en línea enfocada"],
    ["?", "Todos los atajos"],
]

const GROUPS: { title: string; items: [string, string][] }[] = [
    {
        title: "Cobrar",
        items: [
            ["F2 o Ctrl+Enter", "Abrir el diálogo de cobro"],
            ["Enter (en el cobro)", "Confirmar venta / documento"],
            ["Esc", "Cerrar el diálogo"],
        ],
    },
    {
        title: "Capturar productos",
        items: [
            ["/", "Enfocar el buscador"],
            ["Enter (en el buscador)", "Agregar por código exacto"],
            ["5*código o 5x código", "Agregar 5 piezas en un escaneo"],
        ],
    },
    {
        title: "Líneas del ticket",
        items: [
            ["Tab", "Llevar el foco a una línea"],
            ["↑ / ↓", "Mover el foco entre líneas"],
            ["+ / −", "Subir / bajar la cantidad"],
            ["Supr", "Quitar la línea enfocada"],
        ],
    },
    {
        title: "Turno",
        items: [
            ["F9", "Suspender el ticket"],
            ["F4", "Tickets y devoluciones"],
            ["?", "Esta ayuda"],
        ],
    },
]

function Kbd({ children }: { children: string }) {
    return <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px] whitespace-nowrap">{children}</kbd>
}

/** Barra de ayuda de atajos de teclado del mostrador. */
export function ShortcutHints() {
    return (
        <p className="hidden lg:flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5 shrink-0" />
            {HINTS.map(([keys, action]) => (
                <span key={keys}>
                    <Kbd>{keys}</Kbd>
                    {" "}{action}
                </span>
            ))}
        </p>
    )
}

/** Panel "?" con todos los atajos — también accesible desde el botón del encabezado. */
export function ShortcutsHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Keyboard className="h-5 w-5" />
                        Atajos del mostrador
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    {GROUPS.map(group => (
                        <div key={group.title} className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
                            <ul className="divide-y rounded-lg border">
                                {group.items.map(([keys, action]) => (
                                    <li key={keys} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                        <span className="text-muted-foreground">{action}</span>
                                        <Kbd>{keys}</Kbd>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                        Una pistola de códigos funciona directo en el buscador: teclea el código y manda Enter.
                    </p>
                </div>
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
            </DialogContent>
        </Dialog>
    )
}
