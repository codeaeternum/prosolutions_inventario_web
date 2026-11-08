import { Skeleton } from "@/components/ui/skeleton"

/**
 * Replica el layout POS de /admin/ventas: buscador con acciones, rejilla
 * del catálogo a la izquierda y panel del ticket a la derecha.
 */
export default function VentasLoading() {
    return (
        <div className="space-y-4" role="status" aria-label="Cargando punto de venta">
            <div className="flex items-center gap-2">
                <Skeleton className="h-10 flex-1" />
                <Skeleton className="h-10 w-10" />
                <Skeleton className="h-10 w-10" />
                <Skeleton className="h-10 w-10" />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                {/* Catálogo de productos */}
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="overflow-hidden rounded-xl border bg-card">
                            <Skeleton className="aspect-square w-full rounded-none" />
                            <div className="space-y-2 p-3">
                                <Skeleton className="h-4 w-full" />
                                <Skeleton className="h-4 w-16" />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Ticket */}
                <div className="hidden lg:block rounded-xl border bg-card p-4 space-y-3">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <div className="pt-4 space-y-2 border-t">
                        <Skeleton className="h-4 w-1/2" />
                        <Skeleton className="h-8 w-2/3" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                </div>
            </div>
        </div>
    )
}
