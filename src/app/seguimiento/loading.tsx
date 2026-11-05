export default function SeguimientoLoading() {
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Cargando…</span>

      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto max-w-6xl flex h-14 items-center justify-between px-4 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-muted" />
            <div className="h-5 w-20 rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-muted" />
            <div className="h-8 w-16 rounded-md bg-muted" />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="container mx-auto max-w-2xl px-4 pt-12 pb-16 animate-pulse">
          <div className="text-center space-y-4 mb-10">
            <div className="mx-auto h-8 w-44 rounded-full bg-muted" />
            <div className="mx-auto h-10 w-72 rounded-lg bg-muted" />
            <div className="mx-auto h-4 w-80 max-w-full rounded bg-muted" />
          </div>

          <div className="rounded-2xl border bg-card p-6 space-y-4 shadow-sm">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="h-4 w-28 rounded bg-muted" />
                <div className="h-11 w-full rounded-md bg-muted" />
              </div>
              <div className="space-y-1.5">
                <div className="h-4 w-44 rounded bg-muted" />
                <div className="h-11 w-full rounded-md bg-muted" />
              </div>
            </div>
            <div className="h-11 w-full rounded-md bg-muted" />
            <div className="mx-auto h-3 w-64 max-w-full rounded bg-muted" />
          </div>
        </section>
      </main>
    </div>
  )
}
