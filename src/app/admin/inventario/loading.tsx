import { Skeleton } from "@/components/ui/skeleton"

/**
 * Replica /admin/inventario: encabezado, barra de pestañas y la tabla de
 * stock con su buscador.
 */
export default function InventarioLoading() {
    return (
        <div className="space-y-6" role="status" aria-label="Cargando inventario">
            <div className="space-y-2">
                <Skeleton className="h-9 w-44" />
                <Skeleton className="h-4 w-96 max-w-full" />
            </div>

            {/* Tabs */}
            <div className="grid w-full grid-cols-4 gap-1 sm:flex sm:w-auto">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 sm:w-28" />
                ))}
            </div>

            {/* Toolbar de la tabla */}
            <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-10 flex-1 min-w-48" />
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
            </div>

            {/* Filas de la tabla de stock */}
            <div className="rounded-xl border bg-card">
                <div className="border-b p-3">
                    <Skeleton className="h-4 w-full" />
                </div>
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 border-b p-3 last:border-0">
                        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="hidden sm:block h-4 w-24" />
                        <Skeleton className="hidden md:block h-4 w-20" />
                        <Skeleton className="h-4 w-14" />
                    </div>
                ))}
            </div>
        </div>
    )
}
