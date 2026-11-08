import { Skeleton } from "@/components/ui/skeleton"

/**
 * Replica la estructura de /admin/reportes: encabezado con acciones, tarjeta
 * de filtros, rejilla de métricas y bloques de gráficas. Evita el salto de
 * layout spinner → contenido al entrar a la ruta.
 */
export default function ReportesLoading() {
    return (
        <div className="space-y-6" role="status" aria-label="Cargando reportes">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-2">
                    <Skeleton className="h-9 w-40" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    <Skeleton className="h-9 flex-1 sm:flex-initial sm:w-28" />
                    <Skeleton className="h-9 flex-1 sm:flex-initial sm:w-36" />
                </div>
            </div>

            {/* Tarjeta de filtros de periodo/fecha */}
            <div className="rounded-xl border bg-card p-6 space-y-4">
                <Skeleton className="h-5 w-56" />
                <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-20" />
                    ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex gap-4">
                    <Skeleton className="h-10 lg:w-40" />
                    <Skeleton className="h-10 lg:w-40" />
                    <Skeleton className="h-10 w-24" />
                </div>
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-7 w-16" />
                    </div>
                ))}
            </div>

            {/* Gráficas */}
            <div className="grid lg:grid-cols-2 gap-4">
                {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="rounded-xl border bg-card p-6 space-y-3">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-48 w-full" />
                    </div>
                ))}
            </div>
        </div>
    )
}
