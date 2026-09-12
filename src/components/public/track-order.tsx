"use client"

/**
 * Formulario de rastreo + resultado para /<slug>/order-status — la vitrina de
 * cada negocio o taller aliado. El resultado usa OrderResult, el mismo diseño
 * pulido de /seguimiento; si esa página mejora, esta mejora sola.
 * Debe renderizarse dentro de <Suspense> (useSearchParams).
 */
import { useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle, FileText, Loader2, PackageSearch, Phone, Search, Ticket,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export function TrackOrder({ brandName }: { brandName: string }) {
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
        // El negocio que opera la orden es quien recibe el WhatsApp; el slug
        // del taller solo brandea la página.
        business: data.business ?? { name: brandName, phone: null },
      })
    } catch {
      setResult({ kind: "error", message: "Sin conexión. Revisa tu internet e intenta de nuevo." })
    }
  }

  return (
    <section className="container mx-auto max-w-2xl px-4 pt-12 pb-16">
      <div className="text-center space-y-4 mb-10">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
          <PackageSearch className="h-4 w-4" />
          Seguimiento en línea
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Rastrea tu reparación</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Ingresa el folio de tu ticket de {brandName} y los últimos 4 dígitos del teléfono que registraste al dejar tu equipo.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-2xl border bg-card p-6 space-y-4 shadow-sm">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="folio" className="text-sm font-medium">Folio de la orden</label>
            <Input
              id="folio"
              value={folio}
              onChange={e => setFolio(sanitizeFolio(e.target.value))}
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

      {result.kind === "idle" && (
        <div className="mt-6 rounded-2xl border bg-card/60 p-6 space-y-4">
          <h2 className="text-sm font-semibold">¿Dónde encuentro estos datos?</h2>
          <ol className="space-y-3.5">
            {[
              { icon: Ticket, text: "Busca el ticket que te entregaron al dejar tu equipo en el taller." },
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

      {result.kind === "loading" && (
        <div className="mt-6 rounded-2xl border bg-card p-6 sm:p-7 space-y-7 animate-pulse" role="status">
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

      {result.kind === "error" && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-center" role="alert">
          <p className="text-sm font-medium">{result.message}</p>
        </div>
      )}

      {result.kind === "found" && <OrderResult order={result.order} business={result.business} />}
    </section>
  )
}
