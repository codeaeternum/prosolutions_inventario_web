"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  Wrench, Search, Check, Loader2, MapPin, CalendarClock,
  PackageSearch, FileText, History, AlertCircle, MessageSquare, Images,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ThemeToggle } from "@/components/theme-toggle"
import { repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { formatDate } from "@/lib/utils"

interface PublicEvent {
  id: string
  detail: string
  createdAt: string
  // MESSAGE: nota que el taller marcó como visible para el cliente.
  kind: "EVENT" | "MESSAGE"
}

interface PublicPhoto {
  id: string
  label: string | null
  createdAt: string
}

interface PublicOrder {
  folio: string
  status: RepairStage
  equipmentType: string
  brand: string | null
  model: string | null
  reportedIssue: string
  promisedAt: string | null
  createdAt: string
  branch: string | null
  photos: PublicPhoto[]
  events: PublicEvent[]
}

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; order: PublicOrder }
  | { kind: "notfound" }
  | { kind: "error"; message: string }

// Flujo feliz; las esperas se insertan donde ocurren en el pipeline.
const FLOW: RepairStage[] = ["RECEIVED", "DIAGNOSIS", "IN_REPAIR", "QUALITY_CHECK", "READY", "DELIVERED"]

const STATUS_NOTE: Partial<Record<RepairStage, string>> = {
  WAITING_APPROVAL: "Estamos esperando tu autorización del presupuesto. Acude a la sucursal o contáctanos.",
  WAITING_PARTS: "Estamos esperando una refacción para continuar con tu equipo.",
  READY: "Tu equipo está listo. Recógelo en la sucursal presentando tu ticket.",
  DELIVERED: "Equipo entregado. ¡Gracias por tu preferencia!",
  CANCELLED: "Esta orden fue cancelada. Si tienes dudas, acude a la sucursal con tu ticket.",
  NOT_REPAIRED: "No fue posible completar la reparación. Acude a la sucursal para recoger tu equipo.",
  NOT_AUTHORIZED: "El presupuesto no fue autorizado. Acude a la sucursal para recoger tu equipo o renegociar.",
  EXTERNAL_LAB: "Tu equipo fue enviado a un laboratorio especializado. Te avisaremos al regresar.",
  WARRANTY: "Tu equipo reingresó por garantía de la reparación anterior.",
}

const STATUS_VARIANT: Record<RepairStage, "default" | "secondary" | "destructive" | "success" | "warning"> = {
  RECEIVED: "secondary",
  DIAGNOSIS: "secondary",
  WAITING_APPROVAL: "warning",
  WAITING_PARTS: "warning",
  IN_REPAIR: "default",
  QUALITY_CHECK: "default",
  READY: "success",
  DELIVERED: "success",
  CANCELLED: "destructive",
  NOT_REPAIRED: "destructive",
  NOT_AUTHORIZED: "destructive",
  EXTERNAL_LAB: "secondary",
  WARRANTY: "warning",
}

const labelToStage = new Map<string, RepairStage>(
  (Object.entries(repairLabels) as [RepairStage, string][]).map(([stage, label]) => [label, stage]),
)

function buildTimeline(order: PublicOrder): { stages: RepairStage[]; current: number; doneThrough: number } {
  const stages = [...FLOW]
  if (order.status === "WAITING_APPROVAL") {
    stages.splice(2, 0, "WAITING_APPROVAL")
    return { stages, current: 2, doneThrough: 2 }
  }
  if (order.status === "WAITING_PARTS") {
    stages.splice(3, 0, "WAITING_PARTS")
    return { stages, current: 3, doneThrough: 3 }
  }
  if (order.status === "CANCELLED") {
    // Hasta dónde llegó: última transición "→ Etiqueta" del historial.
    let reached = 0
    for (const e of order.events) {
      const target = /→\s*([^.\n]+)/.exec(e.detail)?.[1]?.trim()
      const stage = target ? labelToStage.get(target) : undefined
      if (stage && FLOW.includes(stage)) reached = Math.max(reached, FLOW.indexOf(stage))
    }
    return { stages, current: -1, doneThrough: reached }
  }
  const current = stages.indexOf(order.status)
  return { stages, current, doneThrough: current }
}

// Folios válidos: "OT-000001", "000001" o "1" (ver /api/seguimiento).
const sanitizeFolio = (value: string | null) =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12)

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
  const [folio, setFolio] = useState(() => sanitizeFolio(searchParams.get("folio")))
  const [phone, setPhone] = useState("")
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
      setResult({ kind: "found", order: data.order })
    } catch {
      setResult({ kind: "error", message: "Sin conexión. Revisa tu internet e intenta de nuevo." })
    }
  }

  return (
    <section className="container mx-auto max-w-2xl px-4 pt-14 pb-20">
          {/* Hero compacto */}
          <div className="text-center space-y-4 mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
              <PackageSearch className="h-4 w-4" />
              Seguimiento en línea
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Rastrea tu reparación</h1>
            <p className="text-muted-foreground max-w-md mx-auto">
              Ingresa el folio de tu ticket y los últimos 4 dígitos del teléfono que registraste al dejar tu equipo.
            </p>
          </div>

          {/* Formulario */}
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border bg-card p-6 space-y-4 shadow-sm"
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
                  onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 4))}
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
              Consultar
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              El folio aparece en tu ticket de recepción con formato OT-000001.
            </p>
          </form>

          {/* No encontrada */}
          {result.kind === "notfound" && (
            <div className="mt-6 rounded-xl border border-dashed p-8 text-center space-y-3">
              <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
              <h2 className="font-semibold text-lg">No encontramos una orden con esos datos</h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Revisa que el folio y los últimos 4 dígitos del teléfono coincidan con tu ticket de recepción.
                Si el problema continúa, acude a la sucursal donde dejaste tu equipo.
              </p>
            </div>
          )}

          {/* Error */}
          {result.kind === "error" && (
            <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
              <p className="text-sm font-medium">{result.message}</p>
            </div>
          )}

          {/* Resultado */}
          {result.kind === "found" && <OrderCard order={result.order} />}
    </section>
  )
}

function OrderCard({ order }: { order: PublicOrder }) {
  const { stages, current, doneThrough } = buildTimeline(order)
  const equipment = [order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")

  return (
    <div className="mt-6 rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Encabezado */}
      <div className="p-6 border-b bg-primary/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-bold tracking-tight">{order.folio}</p>
            <p className="text-muted-foreground mt-1">{equipment}</p>
          </div>
          <Badge variant={STATUS_VARIANT[order.status]} className="text-sm px-3 py-1">
            {repairLabels[order.status]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Recibido: {formatDate(order.createdAt)}
          </span>
          {order.promisedAt && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              Fecha promesa: {formatDate(order.promisedAt)}
            </span>
          )}
          {order.branch && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {order.branch}
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* Falla reportada */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Falla reportada</h3>
          <p className="text-sm leading-relaxed">{order.reportedIssue}</p>
        </div>

        {/* Evidencias del taller */}
        {order.photos.length > 0 && (
          <div>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Images className="h-3.5 w-3.5" />
              Fotos de tu equipo
            </h3>
            <ul className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {order.photos.map(photo => (
                <li key={photo.id} className="space-y-1">
                  <a
                    href={`/api/evidence?id=${encodeURIComponent(photo.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square overflow-hidden rounded-lg border bg-muted hover:opacity-90 transition-opacity"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/evidence?id=${encodeURIComponent(photo.id)}`}
                      alt={photo.label ?? "Evidencia del equipo"}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </a>
                  {photo.label && <p className="text-[11px] text-muted-foreground truncate">{photo.label}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Línea de tiempo */}
        <div>
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-4">Progreso</h3>
          <ol className="space-y-0">
            {stages.map((stage, i) => {
              const done = i < doneThrough
              const isCurrent = i === current
              const isLast = i === stages.length - 1
              return (
                <li key={stage} className="relative flex gap-3 pb-6 last:pb-0">
                  {!isLast && (
                    <span
                      aria-hidden
                      className={`absolute left-[11px] top-6 bottom-0 w-px ${done || isCurrent ? "bg-primary/50" : "bg-border"}`}
                    />
                  )}
                  <span
                    className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      done
                        ? "bg-primary text-primary-foreground"
                        : isCurrent
                          ? "border-2 border-primary bg-primary/10"
                          : "border border-border bg-card"
                    }`}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : isCurrent ? (
                      <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                  </span>
                  <div className="pt-0.5">
                    <p className={`text-sm ${isCurrent ? "font-semibold text-primary" : done ? "font-medium" : "text-muted-foreground"}`}>
                      {repairLabels[stage]}
                    </p>
                    {isCurrent && STATUS_NOTE[stage] && (
                      <p className="text-xs text-muted-foreground mt-1 max-w-sm">{STATUS_NOTE[stage]}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          {order.status === "CANCELLED" && (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-medium">{STATUS_NOTE.CANCELLED}</p>
            </div>
          )}
        </div>

        {/* Historial */}
        {order.events.length > 0 && (
          <div>
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Historial
            </h3>
            <ul className="space-y-3">
              {order.events.slice(0, 10).map(e => (
                e.kind === "MESSAGE" ? (
                  <li key={e.id} className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Mensaje del taller
                    </p>
                    <p className="text-sm leading-relaxed mt-1">{e.detail}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(e.createdAt)}</p>
                  </li>
                ) : (
                  <li key={e.id} className="text-sm flex flex-col gap-0.5 border-l-2 border-border pl-3">
                    <span className="text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
                    <span className="leading-relaxed">{e.detail}</span>
                  </li>
                )
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
