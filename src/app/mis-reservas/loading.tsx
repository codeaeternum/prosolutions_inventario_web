// Skeleton con la forma real de Mis Reservas (header + pestañas + cards)
// en vez del spinner genérico.
export default function MisReservasLoading() {
  return (
    <div className="min-h-screen bg-background" role="status" aria-busy="true">
      <span className="sr-only">Cargando tus reservas…</span>

      <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background">
        <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-muted" />
            <div className="h-5 w-16 rounded bg-muted hidden sm:block" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-muted" />
            <div className="h-9 w-9 rounded-md bg-muted" />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 py-6 animate-pulse">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex gap-2">
            <div className="h-9 w-24 rounded-md bg-muted" />
            <div className="h-9 w-24 rounded-md bg-muted" />
          </div>
          <div className="h-8 w-20 rounded-md bg-muted" />
        </div>
        <div className="h-6 w-40 rounded bg-muted mb-6" />

        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-3 flex gap-3">
              <div className="h-[70px] w-[70px] rounded-lg bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-1/2 rounded bg-muted" />
                  <div className="h-5 w-16 rounded-full bg-muted" />
                </div>
                <div className="h-3 w-2/3 rounded bg-muted" />
                <div className="flex items-center gap-2 pt-1">
                  <div className="h-5 w-14 rounded-full bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
