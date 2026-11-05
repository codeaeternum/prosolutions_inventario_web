export default function MercadoLoading() {
  return (
    <div
      className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Cargando…</span>

      <header className="border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto max-w-4xl flex h-14 items-center justify-between px-4 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-muted" />
            <div className="h-5 w-24 rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 rounded-md bg-muted" />
            <div className="h-8 w-8 rounded-md bg-muted" />
          </div>
        </div>
      </header>

      <main className="flex-1 animate-pulse">
        <section className="container mx-auto max-w-4xl px-4 pt-14 pb-10 text-center space-y-5">
          <div className="mx-auto h-8 w-56 rounded-full bg-muted" />
          <div className="mx-auto h-12 w-96 max-w-full rounded-lg bg-muted" />
          <div className="mx-auto h-5 w-80 max-w-full rounded bg-muted" />
        </section>

        <section className="container mx-auto max-w-5xl px-4 pb-16 space-y-8">
          <div className="mx-auto max-w-2xl h-12 rounded-xl bg-muted" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="rounded-xl border bg-card p-5 space-y-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-muted shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-32 rounded bg-muted" />
                    <div className="h-3 w-20 rounded bg-muted" />
                  </div>
                </div>
                <div className="h-3 w-full rounded bg-muted" />
                <div className="h-3 w-2/3 rounded bg-muted" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
