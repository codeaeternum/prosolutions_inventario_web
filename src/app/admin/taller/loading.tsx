import { Skeleton } from "@/components/ui/skeleton"

/**
 * Replica el tablero kanban de /admin/taller: encabezado con acciones,
 * chips de vista, filtros y columnas de órdenes con tarjetas.
 */
export default function TallerLoading() {
    return (
        <div className="space-y-4" role="status" aria-label="Cargando órdenes del taller">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <Skeleton className="h-9 w-44" />
                <Skeleton className="h-9 w-40" />
            </div>

            {/* Chips de vista */}
            <div className="flex flex-wrap gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-24 rounded-full" />
                ))}
            </div>

            {/* Filtros */}
            <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ))}
            </div>

            {/* Columnas kanban */}
            <div className="flex items-start gap-3 overflow-hidden pb-2">
                {Array.from({ length: 4 }).map((_, col) => (
                    <section key={col} className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 p-3">
                        <header className="mb-3 flex items-center gap-2 px-1">
                            <Skeleton className="h-2.5 w-2.5 rounded-full" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="ml-auto h-5 w-8 rounded-full" />
                        </header>
                        <div className="space-y-2">
                            {Array.from({ length: col === 0 ? 3 : 2 }).map((_, card) => (
                                <div key={card} className="space-y-2 rounded-lg border bg-card p-3">
                                    <Skeleton className="h-3 w-16" />
                                    <Skeleton className="h-4 w-full" />
                                    <Skeleton className="h-3 w-28" />
                                    <Skeleton className="h-3 w-36" />
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    )
}
