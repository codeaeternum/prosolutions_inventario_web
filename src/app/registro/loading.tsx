export default function RegistroLoading() {
  return (
    <div
      className="min-h-screen grid lg:grid-cols-[45%_55%]"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Cargando…</span>

      <aside className="hidden lg:flex flex-col justify-between bg-primary p-12 text-primary-foreground">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-11 w-11 rounded-xl bg-white/15" />
          <div className="space-y-1.5">
            <div className="h-5 w-24 rounded bg-white/20" />
            <div className="h-3 w-16 rounded bg-white/15" />
          </div>
        </div>
        <div className="space-y-4 animate-pulse">
          <div className="h-9 w-64 rounded-lg bg-white/20" />
          <div className="h-4 w-72 rounded bg-white/15" />
          <div className="h-4 w-64 rounded bg-white/15" />
          <div className="h-4 w-60 rounded bg-white/15" />
        </div>
        <div className="h-16 w-full rounded-xl bg-white/10 animate-pulse" />
      </aside>

      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-8">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 sm:p-8 space-y-5 shadow-sm animate-pulse">
          <div className="space-y-2">
            <div className="h-7 w-48 rounded bg-muted" />
            <div className="h-4 w-72 max-w-full rounded bg-muted" />
          </div>
          <div className="space-y-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="space-y-1.5">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-10 w-full rounded-md bg-muted" />
              </div>
            ))}
          </div>
          <div className="h-11 w-full rounded-md bg-muted" />
        </div>
      </div>
    </div>
  )
}
