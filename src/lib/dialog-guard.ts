import type { Dispatch, SetStateAction } from "react"

/**
 * Guarda el cierre de un Dialog mientras una operación sigue en vuelo.
 *
 * Radix dispara onOpenChange(false) tanto por Escape como por clic fuera;
 * interceptar ahí cubre ambos caminos. Cerrar a mitad de un save desmontaba
 * el form y permitía reintentos con otra idempotency-key (doble operación).
 *
 * Uso:
 *   <Dialog open={open} onOpenChange={guardedClose(setOpen, saving)}>
 */
export function guardedClose(setOpen: Dispatch<SetStateAction<boolean>>, busy: boolean) {
    return (open: boolean) => {
        if (!open && busy) return
        setOpen(open)
    }
}
