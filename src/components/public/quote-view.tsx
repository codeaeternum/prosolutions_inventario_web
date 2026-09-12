import Link from "next/link"
import { AlertCircle, BadgeCheck } from "lucide-react"
import { repairFolio } from "@/lib/workshop-labels"
import { formatDate, formatPrice } from "@/lib/utils"
import type { PublicQuote } from "@/lib/public-quote"
import { QuoteApproval } from "@/components/public/quote-approval"

// Documento de cotización público, compartido por la página global
// (/cotizacion/[token], fallback sin slug) y la brandeada por negocio
// (/<slug>/cotizacion/[token]). Componente de servidor: lo renderizan las
// páginas dentro de su propio shell (Reficio global o PublicShell por slug).

const TERMS =
  "Esta cotización es un estimado basado en el diagnóstico inicial. Si se detectan daños adicionales se le contactará antes de proceder."

// Mismo criterio de limpieza que quote-ticket-view.tsx (documento impreso):
// reportedIssue puede arrastrar "Servicio: X — Falla: Y", presupuestos
// embebidos o el formato "Servicio · Detalle". Vive aquí porque la vista del
// ticket no la exporta y esta página no puede importar de un client file.
function parseIssue(raw: string): { service?: string; issue: string } {
  const withoutBudget = raw
    .replace(/presupuesto\s+estimado\s*:?\s*\$?\s*[\d.,]+/gi, "")
    .replace(/\s{2,}/g, " ")

  const legacy = withoutBudget.match(/servicio\s*:\s*(.+?)\s*[—–-]\s*falla\s*:\s*(.+)/i)
  if (legacy) {
    return { service: legacy[1].trim() || undefined, issue: legacy[2].trim() }
  }

  const segments = withoutBudget
    .split("·")
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length >= 2) {
    return { service: segments[0], issue: segments.slice(1).join(" · ") }
  }
  return { service: undefined, issue: segments[0] ?? raw.trim() }
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <tr className="align-top">
      <td className="py-0.5 pr-3 text-neutral-500 whitespace-nowrap">{label}:</td>
      <td className="py-0.5 font-medium">{value}</td>
    </tr>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 border-b border-neutral-300 pb-1 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
      {children}
    </h3>
  )
}

/**
 * Token sin orden detrás: enlace incompleto o cotización fuera de vigencia.
 * `trackingHref` apunta al rastreo correspondiente: /seguimiento en la página
 * global o /<slug>/order-status dentro del namespace del negocio.
 */
export function QuoteNotFound({ trackingHref }: { trackingHref: string }) {
  return (
    <section className="container mx-auto max-w-2xl px-4 pt-16 pb-20">
      <div className="rounded-2xl border border-dashed bg-card p-10 text-center space-y-4 shadow-sm">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Cotización no encontrada</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          El enlace pudo escribirse incompleto o ya no estar vigente. Pide al taller que te reenvíe el enlace por WhatsApp.
        </p>
        <p className="text-sm">
          <Link href={trackingHref} className="font-medium text-primary underline-offset-4 hover:underline">
            Rastrear mi equipo con el folio del ticket →
          </Link>
        </p>
      </div>
    </section>
  )
}

/**
 * Documento "papel" de la cotización + bloque de decisión del cliente.
 * `businessName` es el membrete: en la página global llega de
 * ticket_business_name (o "PROSOLUTIONS"); en la brandeada, el nombre del slug.
 */
export function QuoteDocument({ order, businessName, token }: {
  order: PublicQuote
  businessName: string
  token: string
}) {
  const folio = repairFolio(order.number)
  const { service, issue } = parseIssue(order.reportedIssue)
  const laborCents = order.approvedQuoteCents ?? order.quoteCents
  const parts = order.parts.map(part => ({
    description: part.description,
    qty: part.qty,
    unitPrice: part.unitPriceCents / 100,
    subtotal: (part.qty * part.unitPriceCents) / 100,
  }))
  const partsTotal = parts.reduce((sum, part) => sum + part.subtotal, 0)
  const totalCents = (laborCents ?? 0) + Math.round(partsTotal * 100)
  const hasQuote = laborCents !== null || parts.length > 0
  const issuedAt = order.events[0]?.createdAt ?? order.quoteApprovedAt ?? order.createdAt

  const statusChip = order.quoteApprovedAt
    ? { label: "Aprobada", className: "bg-emerald-100 text-emerald-800 border-emerald-300" }
    : order.status === "NOT_AUTHORIZED"
      ? { label: "No autorizada", className: "bg-red-100 text-red-800 border-red-300" }
      : order.status === "CANCELLED"
        ? { label: "Cancelada", className: "bg-neutral-200 text-neutral-700 border-neutral-300" }
        : hasQuote
          ? { label: "Pendiente de tu autorización", className: "bg-amber-100 text-amber-900 border-amber-300" }
          : { label: "En preparación", className: "bg-neutral-100 text-neutral-600 border-neutral-300" }

  return (
    <section className="container mx-auto max-w-2xl px-4 pt-8 pb-16 space-y-6">
      {/* Documento "papel": siempre claro aunque el tema del teléfono sea oscuro,
          igual que la cotización impresa (quote-ticket-view). */}
      <article className="overflow-hidden rounded-2xl bg-white text-neutral-900 shadow-xl ring-1 ring-black/5">
        <div className="h-1.5 bg-gradient-to-r from-violet-700 via-violet-500 to-fuchsia-500" />
        <div className="space-y-6 p-6 sm:p-8 text-sm">

          {/* Membrete */}
          <div className="border-b-2 border-neutral-900 pb-4 text-center">
            <h1 className="text-xl font-extrabold uppercase leading-tight tracking-tight">
              {businessName}
            </h1>
            <h2 className="mt-1.5 text-xs font-bold uppercase tracking-[0.25em] text-violet-700">
              Cotización de reparación
            </h2>
            <p className="mt-2 text-xs text-neutral-600">
              Folio: <span className="font-bold text-neutral-900">{folio}</span>
              <span className="mx-2">·</span>
              Emitida: {formatDate(issuedAt)}
            </p>
            <span className={`mt-3 inline-block rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${statusChip.className}`}>
              {order.quoteApprovedAt && <BadgeCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />}
              {statusChip.label}
            </span>
          </div>

          {/* Cliente */}
          <section>
            <SectionTitle>Cliente</SectionTitle>
            <table className="w-full">
              <tbody>
                <Row label="Nombre" value={order.customerName} />
              </tbody>
            </table>
          </section>

          {/* Equipo */}
          <section>
            <SectionTitle>Equipo</SectionTitle>
            <table className="w-full">
              <tbody>
                <Row label="Tipo" value={order.equipmentType} />
                <Row label="Marca" value={order.brand} />
                <Row label="Modelo" value={order.model} />
                <Row label="Color" value={order.equipmentColor} />
              </tbody>
            </table>
          </section>

          {/* Trabajo a realizar */}
          <section>
            <SectionTitle>Trabajo a realizar</SectionTitle>
            <div className="space-y-1 leading-relaxed">
              {service && <p><span className="text-neutral-500">Servicio:</span> <span className="font-medium">{service}</span></p>}
              <p><span className="text-neutral-500">Falla reportada:</span> {issue}</p>
              {order.diagnosis && <p><span className="text-neutral-500">Diagnóstico:</span> {order.diagnosis}</p>}
            </div>
          </section>

          {/* Desglose */}
          <section>
            <SectionTitle>Desglose</SectionTitle>
            {hasQuote ? (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-300 text-[10px] uppercase text-neutral-500">
                    <th className="pb-1 text-left font-normal">Concepto</th>
                    <th className="pb-1 text-center font-normal">Cant</th>
                    <th className="pb-1 text-right font-normal">P. unitario</th>
                    <th className="pb-1 text-right font-normal">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {laborCents !== null && (
                    <tr className="align-top border-b border-neutral-100">
                      <td className="py-1.5 pr-2 font-medium">{service ?? "Servicio de reparación (mano de obra)"}</td>
                      <td className="py-1.5 text-center">1</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{formatPrice(laborCents / 100)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{formatPrice(laborCents / 100)}</td>
                    </tr>
                  )}
                  {parts.map((part, idx) => (
                    <tr key={idx} className="align-top border-b border-neutral-100 last:border-0">
                      <td className="py-1.5 pr-2">Refacción: {part.description}</td>
                      <td className="py-1.5 text-center">{part.qty}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{formatPrice(part.unitPrice)}</td>
                      <td className="py-1.5 text-right whitespace-nowrap">{formatPrice(part.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-neutral-900">
                    <td colSpan={3} className="pt-2 text-right text-base font-extrabold uppercase">Total</td>
                    <td className="pt-2 text-right text-xl font-extrabold whitespace-nowrap text-violet-700">
                      {formatPrice(totalCents / 100)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <p className="text-neutral-600">El taller aún está preparando el desglose de esta cotización.</p>
            )}
          </section>

          {/* Vigencia y términos */}
          <section className="space-y-1.5 rounded-xl bg-neutral-50 p-4 text-[11px] leading-snug text-neutral-600">
            <p className="font-bold text-neutral-900">Válida por 15 días naturales a partir de la fecha de emisión.</p>
            <p className="text-justify">{TERMS}</p>
            <p>Al aprobar desde este enlace queda registrada tu autorización electrónica{order.quoteApprovedAt ? "" : " (fecha, hora y nombre que indiques)"}.</p>
          </section>

          <p className="text-center text-[11px] text-neutral-400">
            Elaboró: {order.createdBy.name} · Documento generado por Reficio
          </p>
        </div>
      </article>

      {/* Decisión del cliente */}
      <QuoteApproval
        token={token}
        folio={folio}
        status={order.status}
        quoteApprovedAt={order.quoteApprovedAt?.toISOString() ?? null}
        totalCents={hasQuote ? totalCents : null}
        hasQuote={hasQuote}
      />
    </section>
  )
}
