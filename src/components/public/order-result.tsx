"use client"

/**
 * Resultado del rastreo público de una orden — compartido por /seguimiento y
 * /<slug>/order-status. Solo renderiza campos que la API ya saneó para público.
 */
import Link from "next/link"
import {
  Wrench, Check, MapPin, CalendarClock, History, MessageSquare,
  Images, Inbox, Stethoscope, FileCheck, ClipboardCheck, PackageCheck,
  CheckCheck, Hourglass, FlaskConical, ShieldCheck, Ban, XCircle, FileX, FileText,
  Store, Wallet, ArrowRight, type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { waMeHref } from "@/components/public/whatsapp-button"
import { repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { cn, formatDate, formatDay, formatPrice } from "@/lib/utils"

export interface PublicEvent {
  id: string
  detail: string
  createdAt: string
  // MESSAGE: nota que el taller marcó como visible para el cliente.
  kind: "EVENT" | "MESSAGE"
}

export interface PublicPhoto {
  id: string
  label: string | null
  createdAt: string
}

export interface PublicOrder {
  folio: string
  status: RepairStage
  equipmentType: string
  brand: string | null
  model: string | null
  reportedIssue: string
  // Servicio del catálogo elegido en recepción (nuevo campo; órdenes viejas: null).
  serviceName: string | null
  promisedAt: string | null
  createdAt: string
  branch: string | null
  // Monto autorizado por el cliente (nunca el estimado) y abonos confirmados.
  authorizedCents: number | null
  paidCents: number
  // Vigencia de la garantía: solo presente mientras la orden está en WARRANTY.
  warrantyUntil: string | null
  // Solo presente mientras la orden espera la autorización del cliente.
  quoteToken: string | null
  photos: PublicPhoto[]
  events: PublicEvent[]
}

export interface BusinessInfo {
  name: string | null
  phone: string | null
}


// Pipeline feliz que entiende el cliente. "Autorización" es la etapa
// WAITING_APPROVAL; las esperas y salidas especiales se muestran aparte.
const FLOW = [
  "RECEIVED", "DIAGNOSIS", "WAITING_APPROVAL", "IN_REPAIR",
  "QUALITY_CHECK", "READY", "DELIVERED",
] as const satisfies readonly RepairStage[]

type FlowStage = (typeof FLOW)[number]

const STEP: Record<FlowStage, { label: string; icon: LucideIcon; hint: string }> = {
  RECEIVED: { label: "Recibido", icon: Inbox, hint: "Tu equipo ya está registrado en el taller." },
  DIAGNOSIS: { label: "Diagnóstico", icon: Stethoscope, hint: "Estamos revisando la falla para preparar tu presupuesto." },
  WAITING_APPROVAL: { label: "Autorización", icon: FileCheck, hint: "Necesitamos tu autorización del presupuesto para continuar." },
  IN_REPAIR: { label: "Reparación", icon: Wrench, hint: "El técnico está trabajando en tu equipo." },
  QUALITY_CHECK: { label: "Revisión", icon: ClipboardCheck, hint: "Estamos verificando que todo funcione correctamente." },
  READY: { label: "Listo", icon: PackageCheck, hint: "Ya puedes recogerlo en la sucursal presentando tu ticket." },
  DELIVERED: { label: "Entregado", icon: CheckCheck, hint: "" },
}

// Estados fuera del pipeline lineal: card propia con color semántico y
// mensaje claro. `timeline` define cómo se dibuja el progreso debajo:
// "paused" marca la etapa alcanzada como vigente, "ended" muestra hasta
// dónde llegó la orden y "none" lo omite (la garantía reingresa cíclicamente).
interface SpecialStatus {
  icon: LucideIcon
  title: string
  message: string
  card: string
  iconBox: string
  timeline: "paused" | "ended" | "none"
}

const SPECIAL: Partial<Record<RepairStage, SpecialStatus>> = {
  WAITING_PARTS: {
    icon: Hourglass,
    title: "Esperando una refacción",
    message: "Tu equipo está en pausa mientras llega la pieza que necesita. Te avisaremos cuando continuemos con la reparación.",
    card: "border-warning/50 bg-warning/10",
    iconBox: "bg-warning/15 text-warning-strong",
    timeline: "paused",
  },
  EXTERNAL_LAB: {
    icon: FlaskConical,
    title: "En laboratorio externo",
    message: "Tu equipo fue enviado a un laboratorio especializado. Te avisaremos en cuanto regrese al taller.",
    card: "border-primary/40 bg-primary/5",
    iconBox: "bg-primary/10 text-primary",
    timeline: "paused",
  },
  WARRANTY: {
    icon: ShieldCheck,
    title: "Reingreso por garantía",
    message: "Tu equipo regresó cubierto por la garantía de la reparación anterior. Lo estamos valorando de nuevo sin costo para ti.",
    card: "border-sky-500/40 bg-sky-500/10",
    iconBox: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    timeline: "none",
  },
  CANCELLED: {
    icon: Ban,
    title: "Orden cancelada",
    message: "Esta orden fue cancelada. Si tienes dudas, acude a la sucursal presentando tu ticket.",
    card: "border-border bg-muted/40",
    iconBox: "bg-muted text-muted-foreground",
    timeline: "ended",
  },
  NOT_REPAIRED: {
    icon: XCircle,
    title: "No fue posible repararlo",
    message: "El equipo no pudo quedar en servicio. Acude a la sucursal para recogerlo; ahí te explicamos el diagnóstico.",
    card: "border-destructive/40 bg-destructive/10",
    iconBox: "bg-destructive/15 text-destructive",
    timeline: "ended",
  },
  NOT_AUTHORIZED: {
    icon: FileX,
    title: "Cotización no autorizada",
    message: "El presupuesto no fue autorizado. Acude a la sucursal para recoger tu equipo o platicar otras opciones.",
    card: "border-destructive/40 bg-destructive/10",
    iconBox: "bg-destructive/15 text-destructive",
    timeline: "ended",
  },
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
  CANCELLED: "secondary",
  NOT_REPAIRED: "destructive",
  NOT_AUTHORIZED: "destructive",
  EXTERNAL_LAB: "secondary",
  WARRANTY: "secondary",
}

// Nota contextual bajo el badge para estados donde el cliente debe actuar
// o ya no hay nada pendiente (los especiales usan su propia card).
const HEADER_NOTE: Partial<Record<RepairStage, string>> = {
  READY: "Tu equipo está listo. Recógelo en la sucursal presentando tu ticket.",
  DELIVERED: "Equipo entregado. Gracias por tu preferencia.",
}

const labelToStage = new Map<string, RepairStage>(
  (Object.entries(repairLabels) as [RepairStage, string][]).map(([stage, label]) => [label, stage]),
)

const isFlowStage = (stage: RepairStage): stage is FlowStage =>
  (FLOW as readonly RepairStage[]).includes(stage)

// Hasta qué etapa llegó la orden: última transición "→ Etiqueta" del
// historial público (los detalles ya vienen saneados de la API).
function inferReached(order: PublicOrder): number {
  let reached = 0
  for (const e of order.events) {
    const target = /→\s*([^.\n]+)/.exec(e.detail)?.[1]?.trim()
    const stage = target ? labelToStage.get(target) : undefined
    if (stage && isFlowStage(stage)) reached = Math.max(reached, FLOW.indexOf(stage))
  }
  return reached
}

// null → el timeline no aplica para este estado (p. ej. WARRANTY).
function buildTimeline(order: PublicOrder): { current: number; doneThrough: number } | null {
  if (isFlowStage(order.status)) {
    // Entregado: todo el pipeline quedó completado (checks verdes).
    if (order.status === "DELIVERED") return { current: -1, doneThrough: FLOW.length }
    const current = FLOW.indexOf(order.status)
    return { current, doneThrough: current }
  }
  const special = SPECIAL[order.status]
  if (!special || special.timeline === "none") return null
  const reached = inferReached(order)
  if (special.timeline === "paused") {
    // Piso semántico: refacción solo se pide en reparación; laboratorio
    // externo implica que al menos pasó por diagnóstico.
    const floor = order.status === "WAITING_PARTS" ? FLOW.indexOf("IN_REPAIR") : FLOW.indexOf("DIAGNOSIS")
    const current = Math.max(reached, floor)
    return { current, doneThrough: current }
  }
  // "ended": la etapa alcanzada cuenta como completada.
  return { current: -1, doneThrough: Math.min(FLOW.length, reached + 1) }
}

// reportedIssue puede venir como "Servicio · Detalle" o el legado
// "Servicio: X — Falla: Y" (mismo criterio que /cotizacion/[token]).
function splitIssue(raw: string): { service?: string; issue: string } {
  const legacy = raw.match(/servicio\s*:\s*(.+?)\s*[—–-]\s*falla\s*:\s*(.+)/i)
  if (legacy) return { service: legacy[1].trim() || undefined, issue: legacy[2].trim() }
  const segments = raw.split("·").map(s => s.trim()).filter(Boolean)
  if (segments.length >= 2) return { service: segments[0], issue: segments.slice(1).join(" · ") }
  return { service: undefined, issue: raw.trim() }
}

// Folios válidos: "OT-000001", "PS-000001" (prefijo configurable), "000001" o
// "1" (ver /api/seguimiento). 16 chars cubren prefijo de 8 + guion + 6 dígitos.
export const sanitizeFolio = (value: string | null) =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16)

export const sanitizePhone4 = (value: string | null) =>
  (value ?? "").replace(/\D/g, "").slice(0, 4)


export function OrderResult({ order, business }: { order: PublicOrder; business: BusinessInfo }) {
  const timeline = buildTimeline(order)
  const special = SPECIAL[order.status]
  const equipment = [order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")
  const { service: legacyService, issue } = splitIssue(order.reportedIssue)
  // El servicio del catálogo ya viaja estructurado en serviceName; el split
  // de reportedIssue solo cubre órdenes anteriores a ese campo.
  const service = order.serviceName ?? legacyService
  const headerNote = HEADER_NOTE[order.status]
  const waHref = waMeHref(business.phone, `Hola, consulto por mi orden ${order.folio}.`)

  const balanceCents = order.authorizedCents !== null
    ? Math.max(0, order.authorizedCents - order.paidCents)
    : null
  // "Por pagar" solo informa mientras el equipo sigue en el taller; en
  // cierres (cancelada, no reparada, entregada) el saldo ya no aplica igual.
  const showBalance =
    balanceCents !== null && balanceCents > 0 &&
    !["CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED", "DELIVERED"].includes(order.status)
  const fullyPaid = order.authorizedCents !== null && order.authorizedCents > 0 && balanceCents === 0 && order.paidCents > 0

  return (
    <article className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="h-1.5 bg-gradient-to-r from-violet-700 via-violet-500 to-fuchsia-500" aria-hidden />

      {/* Encabezado brandeado */}
      <header className="border-b bg-primary/5 p-6 sm:p-7 space-y-4">
        {business.name && (
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <Store className="h-3.5 w-3.5" aria-hidden />
            {business.name}
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-3xl font-extrabold tracking-tight">{order.folio}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{equipment}</p>
          </div>
          <Badge
            variant={STATUS_VARIANT[order.status]}
            className="rounded-full px-3.5 py-1.5 text-sm font-semibold"
          >
            {repairLabels[order.status]}
          </Badge>
        </div>
        {headerNote && (
          <p className="text-sm font-medium">{headerNote}</p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" aria-hidden />
            Recibido: {formatDate(order.createdAt)}
          </span>
          {order.promisedAt && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Entrega estimada: {formatDate(order.promisedAt)}
            </span>
          )}
          {order.warrantyUntil && (
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Garantía vigente hasta {formatDay(order.warrantyUntil)}
            </span>
          )}
          {order.branch && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              Sucursal: {order.branch}
            </span>
          )}
        </div>
      </header>

      <div className="p-6 sm:p-7 space-y-7">
        {/* Estado especial: fuera del pipeline lineal */}
        {special && <SpecialCard special={special} />}

        {/* Autorización pendiente: el momento exacto del CTA a cotización */}
        {order.status === "WAITING_APPROVAL" && order.quoteToken && (
          <div className="rounded-xl border border-warning/50 bg-warning/10 p-5 text-center space-y-3">
            <FileCheck className="mx-auto h-8 w-8 text-warning-strong" aria-hidden />
            <div className="space-y-1">
              <h3 className="font-bold">Tu cotización está lista</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Revisa el desglose y autorízala desde el enlace para que continuemos con tu equipo.
              </p>
            </div>
            <Button asChild size="lg" className="w-full sm:w-auto gap-2">
              <Link href={`/cotizacion/${order.quoteToken}`}>
                Revisar y autorizar mi cotización
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        )}

        {/* Dinero: solo lo autorizado por el cliente y sus abonos */}
        {(order.authorizedCents !== null || order.paidCents > 0) && (
          <div className="rounded-xl border bg-muted/30 p-5 space-y-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" aria-hidden />
              Tu inversión
            </h3>
            <dl className="space-y-2 text-sm">
              {order.authorizedCents !== null && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Presupuesto autorizado</dt>
                  <dd className="font-semibold">{formatPrice(order.authorizedCents / 100)}</dd>
                </div>
              )}
              {order.paidCents > 0 && (
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Anticipo y abonos</dt>
                  <dd className="font-medium text-success">−{formatPrice(order.paidCents / 100)}</dd>
                </div>
              )}
              {showBalance && balanceCents !== null && (
                <div className="flex items-baseline justify-between gap-4 border-t pt-2.5">
                  <dt className="font-medium">Por pagar al recoger</dt>
                  <dd className="text-base font-bold text-primary">{formatPrice(balanceCents / 100)}</dd>
                </div>
              )}
              {fullyPaid && (
                <p className="border-t pt-2.5 text-xs font-medium text-success">
                  Liquidado — no queda saldo pendiente.
                </p>
              )}
            </dl>
          </div>
        )}

        {/* Línea de tiempo del pipeline */}
        {timeline && <Timeline timeline={timeline} />}

        {/* Falla reportada */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Falla reportada</h3>
          {service && <p className="text-sm font-medium mb-0.5">{service}</p>}
          <p className="text-sm leading-relaxed text-muted-foreground">{issue}</p>
        </div>

        {/* Evidencias del taller */}
        {order.photos.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <Images className="h-3.5 w-3.5" aria-hidden />
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
                    {/* eslint-disable-next-line @next/next/no-img-element -- evidencias se sirven por handler con id cuid */}
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

        {/* Actualizaciones: notas públicas como hilo con fechas */}
        {order.events.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" aria-hidden />
              Actualizaciones del taller
            </h3>
            <ul className="space-y-3">
              {order.events.slice(0, 10).map(e => (
                e.kind === "MESSAGE" ? (
                  <li key={e.id} className="rounded-xl border border-primary/25 bg-primary/5 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                      Mensaje del taller
                    </p>
                    <p className="text-sm leading-relaxed mt-1.5">{e.detail}</p>
                    <p className="text-xs text-muted-foreground mt-1.5">{formatDate(e.createdAt)}</p>
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

        {/* Contacto directo con el negocio */}
        {waHref && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border p-5">
            <div className="space-y-1">
              <h3 className="font-semibold">¿Dudas sobre tu equipo?</h3>
              <p className="text-sm text-muted-foreground">
                Escríbenos{business.name ? ` a ${business.name}` : ""} por WhatsApp con tu folio a la mano.
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              className="shrink-0 gap-2 border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              <a href={waHref} target="_blank" rel="noopener noreferrer">
                <MessageSquare className="h-4 w-4" aria-hidden />
                WhatsApp
              </a>
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

function SpecialCard({ special }: { special: SpecialStatus }) {
  const Icon = special.icon
  return (
    <div role="status" className={cn("flex gap-4 rounded-xl border p-5", special.card)}>
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", special.iconBox)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1 pt-0.5">
        <h3 className="font-semibold leading-tight">{special.title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{special.message}</p>
      </div>
    </div>
  )
}

function Timeline({ timeline }: { timeline: { current: number; doneThrough: number } }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
        Progreso de tu equipo
      </h3>
      <ol>
        {FLOW.map((stage, i) => {
          const done = i < timeline.doneThrough
          const isCurrent = i === timeline.current
          const isLast = i === FLOW.length - 1
          const StepIcon = STEP[stage].icon
          return (
            <li key={stage} className="relative flex gap-4 pb-7 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[15px] top-8 bottom-0 w-0.5 rounded-full",
                    done ? "bg-success/60" : "bg-border",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  done && "bg-success text-success-foreground",
                  isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  !done && !isCurrent && "border border-border bg-card text-muted-foreground/50",
                )}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : <StepIcon className="h-4 w-4" aria-hidden />}
              </span>
              <div className="pt-1 min-w-0">
                <p className={cn(
                  "text-sm leading-tight",
                  isCurrent ? "font-semibold text-primary" : done ? "font-medium" : "text-muted-foreground",
                )}>
                  {STEP[stage].label}
                  {isCurrent && (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary align-middle">
                      Ahora
                    </span>
                  )}
                </p>
                {isCurrent && STEP[stage].hint && (
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">
                    {STEP[stage].hint}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
