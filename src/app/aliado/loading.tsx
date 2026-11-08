import { Skeleton } from "@/components/ui/skeleton"

/**
 * Replica la estructura de /aliado: tarjeta de captura (form) y tarjeta
 * "Mis envíos" con filas de órdenes.
 */
export default function AliadoLoading() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Cargando portal de aliado">
      <span className="sr-only">Cargando…</span>

      <div className="space-y-5 rounded-xl border bg-card p-6 shadow-sm" aria-hidden>
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map(i => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>

      <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm" aria-hidden>
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="space-y-1.5">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  )
}
