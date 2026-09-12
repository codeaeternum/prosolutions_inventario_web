"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  Wrench, Search, Loader2, PackageSearch, FileText, Ticket, Phone, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  OrderResult,
  sanitizeFolio,
  sanitizePhone4,
  type BusinessInfo,
  type PublicOrder,
} from "@/components/public/order-result"

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; order: PublicOrder; business: BusinessInfo }
  | { kind: "notfound" }
  | { kind: "error"; message: string }

export default function SeguimientoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex flex-col">
      {/* Header — mismo estilo que la landing */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 safe-area-sticky z-50">
        <div className="container mx-auto max-w-6xl flex h-14 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Wrench className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">Reficio</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">Inicio</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1" role="main">
        <Suspense fallback={
          <div className="container mx-auto max-w-2xl px-4 pt-14 pb-20">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
          </div>
        }>
          <SeguimientoContent />
        </Suspense>
      </main>

      {/* Footer — mismo estilo que la landing */}
      <footer className="border-t py-8">
        <div className="container mx-auto max-w-6xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-primary flex items-center justify-center">
              <Wrench className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-semibold text-foreground">Reficio</span>
            <span>· reficio.app</span>
          </div>
          <p>© {new Date().getFullYear()} Reficio. Software para talleres de reparación.</p>
        </div>
      </footer>
    </div>
  )
}

function SeguimientoContent() {
  const searchParams = useSearchParams()
  // ?folio= prellena la orden y ?t= los últimos 4 dígitos: los links que el
  // taller comparte por WhatsApp llegan casi listos para consultar.
  const [folio, setFolio] = useState(() => sanitizeFolio(searchParams.get("folio")))
  const [phone, setPhone] = useState(() => sanitizePhone4(searchParams.get("t")))
  const [result, setResult] = useState<Result>({ kind: "idle" })

  const canSubmit = folio.trim().length > 0 && /^\d{4}$/.test(phone) && result.kind !== "loading"

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setResult({ kind: "loading" })
    try {
      const res = await fetch(`/api/seguimiento?folio=${encodeURIComponent(folio.trim())}&phone=${encodeURIComponent(phone)}`)
      if (res.status === 404) {
        setResult({ kind: "notfound" })
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setResult({ kind: "error", message: data?.error ?? "No pudimos consultar la orden. Intenta más tarde." })
        return
      }
      const data = await res.json()
      setResult({
        kind: "found",
        order: data.order,
        business: data.business ?? { name: null, phone: null },
      })
    } catch {
      setResult({ kind: "error", message: "Sin conexión. Revisa tu internet e intenta de nuevo." })
    }
  }

  return (
    <section className="container mx-auto max-w-2xl px-4 pt-12 pb-20">
      {/* Hero compacto */}
      <div className="text-center space-y-4 mb-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
          <PackageSearch className="h-4 w-4" />
          Seguimiento en línea
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Rastrea tu reparación</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Consulta el estado de tu equipo en tiempo real con el folio de tu ticket — sin cuenta ni llamadas.
        </p>
      </div>

      {/* Formulario */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border bg-card p-6 space-y-4 shadow-sm"
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="folio" className="text-sm font-medium">Folio de la orden</label>
            <Input
              id="folio"
              value={folio}
              onChange={e => setFolio(e.target.value.toUpperCase())}
              placeholder="OT-000001"
              autoComplete="off"
              autoCapitalize="characters"
              className="h-11"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="phone" className="text-sm font-medium">Últimos 4 dígitos del teléfono</label>
            <Input
              id="phone"
              value={phone}
              onChange={e => setPhone(sanitizePhone4(e.target.value))}
              placeholder="Ej. 5678"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              className="h-11"
              required
            />
          </div>
        </div>
        <Button type="submit" size="lg" className="w-full gap-2" disabled={!canSubmit}>
          {result.kind === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {result.kind === "loading" ? "Consultando…" : "Consultar"}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          El folio aparece en tu ticket de recepción con formato OT-000001.
        </p>
      </form>

      {/* Guía inicial: dónde encontrar los datos en el ticket */}
      {result.kind === "idle" && (
        <div className="mt-6 rounded-2xl border bg-card/60 p-6 space-y-4">
          <h2 className="text-sm font-semibold">¿Dónde encuentro estos datos?</h2>
          <ol className="space-y-3.5">
            {[
              { icon: Ticket, text: "Busca el ticket que te entregaron al dejar tu equipo en la sucursal." },
              { icon: FileText, text: "El folio está en la parte superior, con formato OT-000001." },
              { icon: Phone, text: "Escribe los últimos 4 dígitos del teléfono que registraste en recepción." },
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground pt-1.5 leading-relaxed">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Cargando: skeleton con la forma del resultado */}
      {result.kind === "loading" && (
        <div
          className="mt-6 rounded-2xl border bg-card p-6 sm:p-7 space-y-7 animate-pulse"
          role="status"
          aria-busy="true"
        >
          <span className="sr-only">Consultando tu orden…</span>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2.5">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-8 w-36 rounded bg-muted" />
              <div className="h-4 w-44 rounded bg-muted" />
            </div>
            <div className="h-8 w-28 rounded-full bg-muted" />
          </div>
          <div className="space-y-5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-8 w-8 rounded-full bg-muted" />
                <div className="h-4 rounded bg-muted" style={{ width: `${38 - i * 5}%` }} />
              </div>
            ))}
          </div>
          <div className="h-20 rounded-xl bg-muted" />
        </div>
      )}

      {/* No encontrada */}
      {result.kind === "notfound" && (
        <div className="mt-6 rounded-2xl border border-dashed p-8 text-center space-y-3">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
          <h2 className="font-semibold text-lg">No encontramos una orden con esos datos</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Verifica el folio y los últimos 4 dígitos del teléfono tal como aparecen en tu ticket de recepción.
            Si el problema continúa, acude a la sucursal donde dejaste tu equipo.
          </p>
        </div>
      )}

      {/* Error */}
      {result.kind === "error" && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center" role="alert">
          <p className="text-sm font-medium">{result.message}</p>
        </div>
      )}

      {/* Resultado */}
      {result.kind === "found" && <OrderResult order={result.order} business={result.business} />}
    </section>
  )
}
