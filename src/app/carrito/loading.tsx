// Skeleton con la forma real del carrito (header + items + card de reserva)
// en vez del spinner genérico.
export default function CarritoLoading() {
  return (
    <div className="min-h-screen bg-muted/40" role="status" aria-busy="true">
      <span className="sr-only">Cargando carrito…</span>

      <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 px-4 h-14 flex items-center justify-between animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-md bg-muted" />
          <div className="h-5 w-28 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-muted" />
          <div className="h-8 w-16 rounded-md bg-muted" />
        </div>
      </header>

      <main className="container max-w-lg mx-auto p-4 space-y-6 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-3 flex gap-3">
            <div className="h-20 w-20 rounded-md bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="flex items-center justify-between pt-1">
                <div className="h-9 w-28 rounded-md bg-muted" />
                <div className="h-9 w-9 rounded-md bg-muted" />
              </div>
            </div>
          </div>
        ))}

        <div className="rounded-xl border bg-card p-4 space-y-4">
          <div className="h-5 w-32 rounded bg-muted" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-20 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
          </div>
          <div className="border-t pt-4 flex items-center justify-between">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-6 w-24 rounded bg-muted" />
          </div>
          <div className="h-12 w-full rounded-md bg-muted" />
        </div>
      </main>
    </div>
  )
}
