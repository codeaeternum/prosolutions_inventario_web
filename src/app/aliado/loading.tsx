export default function AliadoLoading() {
  return (
    <div className="space-y-6 animate-pulse" role="status" aria-busy="true">
      <span className="sr-only">Cargando…</span>

      <div className="rounded-xl border bg-card p-6 space-y-5 shadow-sm">
        <div className="space-y-2">
          <div className="h-6 w-40 rounded bg-muted" />
          <div className="h-4 w-96 max-w-full rounded bg-muted" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-10 w-full rounded-md bg-muted" />
          </div>
          <div className="space-y-1.5">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-10 w-full rounded-md bg-muted" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-1.5">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-10 w-full rounded-md bg-muted" />
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-20 w-full rounded-md bg-muted" />
        </div>
        <div className="h-10 w-40 rounded-md bg-muted" />
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-8 w-24 rounded-md bg-muted" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-16 w-full rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  )
}
