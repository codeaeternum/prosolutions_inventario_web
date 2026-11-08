// Skeleton con la forma real de la página (header + filtros + grid de
// productos) en vez del spinner genérico: evita el salto visual al entrar.
export default function CatalogoLoading() {
  return (
    <div className="min-h-screen bg-background" role="status" aria-busy="true">
      <span className="sr-only">Cargando catálogo…</span>

      <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background">
        <div className="container mx-auto max-w-7xl flex h-14 items-center justify-between px-4 gap-2 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-muted" />
            <div className="h-5 w-16 rounded bg-muted hidden sm:block" />
          </div>
          <div className="hidden md:block h-9 flex-1 max-w-md mx-4 rounded-md bg-muted" />
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-muted" />
            <div className="h-9 w-9 rounded-md bg-muted" />
            <div className="h-9 w-20 rounded-md bg-muted hidden sm:block" />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-7xl px-4 py-4 animate-pulse">
        {/* Buscador móvil */}
        <div className="md:hidden flex gap-2 mb-4">
          <div className="h-9 flex-1 rounded-md bg-muted" />
          <div className="h-9 w-9 rounded-md bg-muted" />
        </div>

        <div className="flex gap-6">
          {/* Sidebar de filtros (desktop) */}
          <aside className="hidden md:block w-64 shrink-0">
            <div className="rounded-xl border bg-card p-4 space-y-5">
              <div className="h-5 w-24 rounded bg-muted" />
              <div className="h-9 w-full rounded-md bg-muted" />
              <div className="space-y-2">
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="flex flex-wrap gap-2">
                  {[56, 80, 64, 72].map((w) => (
                    <div key={w} className="h-8 rounded-md bg-muted" style={{ width: w }} />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="h-4 w-16 rounded bg-muted" />
                <div className="flex flex-wrap gap-2">
                  {[64, 72, 56].map((w) => (
                    <div key={w} className="h-8 rounded-md bg-muted" style={{ width: w }} />
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* Grid de productos */}
          <div className="flex-1">
            <div className="h-4 w-24 rounded bg-muted mb-4" />
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="rounded-xl border bg-card overflow-hidden">
                  <div className="aspect-square bg-muted" />
                  <div className="p-3 space-y-2">
                    <div className="h-3 w-1/2 rounded bg-muted" />
                    <div className="h-4 w-full rounded bg-muted" />
                    <div className="h-3 w-2/3 rounded bg-muted" />
                    <div className="h-5 w-1/3 rounded bg-muted mt-2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
