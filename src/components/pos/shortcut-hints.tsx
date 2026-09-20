import { Keyboard } from "lucide-react"

const HINTS: [string, string][] = [
    ["F2 / Ctrl+Enter", "Cobrar"],
    ["Esc", "Cerrar / limpiar búsqueda"],
    ["+ / −", "Cantidad en línea enfocada"],
    ["Supr", "Quitar línea enfocada"],
]

/** Barra de ayuda de atajos de teclado del mostrador. */
export function ShortcutHints() {
    return (
        <p className="hidden lg:flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5 shrink-0" />
            {HINTS.map(([keys, action]) => (
                <span key={keys}>
                    <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">{keys}</kbd>
                    {" "}{action}
                </span>
            ))}
        </p>
    )
}
