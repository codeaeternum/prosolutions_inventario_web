"use client"

import { ArrowLeft, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate, formatPrice } from "@/lib/utils"

export interface QuoteTicketData {
  folio: string
  issuedAt: string
  customerName: string
  customerPhone: string
  customerPhoneAlt?: string
  equipment: { label: string; value: string }[]
  // Texto crudo de reportedIssue; la vista lo limpia antes de imprimirlo.
  issue: string
  diagnosis?: string
  // Mano de obra / servicio en pesos (approvedQuoteCents ?? quoteCents).
  serviceAmount?: number
  // Solo refacciones AUTORIZADAS (status APPROVED), importes en pesos.
  parts: { description: string; qty: number; unitPrice: number; subtotal: number }[]
  elaboratedBy?: string
  businessName?: string
}

const TERMS =
  "Esta cotización es un estimado basado en el diagnóstico inicial. Si se detectan daños adicionales se le contactará antes de proceder."

// La falla registrada puede arrastrar texto de datos viejos:
//   "Servicio: Cambio de pantalla — Falla: no enciende"
//   "Cambio de pantalla · no enciende · Presupuesto estimado: $1,500.00"
// Se separa el nombre del servicio del detalle y se quita el presupuesto
// embebido (el importe real va en el desglose, no dentro del texto).
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

  // La recepción actual guarda "Servicio · Detalle": el primer segmento es
  // el nombre del servicio y el resto es la falla descrita por el cliente.
  if (segments.length >= 2) {
    return { service: segments[0], issue: segments.slice(1).join(" · ") }
  }
  return { service: undefined, issue: segments[0] ?? raw.trim() }
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <tr className="align-top">
      <td className="py-0.5 pr-2 text-gray-500 whitespace-nowrap">{label}:</td>
      <td className="py-0.5 font-medium">{value}</td>
    </tr>
  )
}

export function QuoteTicketView({ data }: { data: QuoteTicketData }) {
  const { service, issue } = parseIssue(data.issue)
  const partsTotal = data.parts.reduce((sum, part) => sum + part.subtotal, 0)
  const hasBreakdown = data.serviceAmount !== undefined || data.parts.length > 0
  const total = (data.serviceAmount ?? 0) + partsTotal

  // Mismo patrón que el ticket/hoja: en pestaña abierta por script
  // history.back() no hace nada; cerramos y si no se puede, al taller.
  function goBack() {
    if (window.opener || window.history.length <= 1) {
      window.close()
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/admin/taller"
    } else {
      window.history.back()
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono print:p-0">
      {/* Controles NO imprimibles */}
      <div className="max-w-xl mx-auto mb-6 flex items-center justify-between gap-2 print:hidden bg-background p-4 rounded-xl shadow-sm">
        <Button variant="outline" size="sm" onClick={goBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          Imprimir
        </Button>
      </div>

      {/* COTIZACIÓN (media carta — documento formal para el cliente) */}
      <div className="max-w-xl mx-auto bg-white text-black text-xs shadow-lg print:shadow-none p-6 sm:p-8 space-y-5">

        {/* Membrete */}
        <div className="text-center border-b-2 border-black pb-4">
          <h1 className="text-lg font-bold uppercase leading-tight">{data.businessName || "PROSOLUTIONS"}</h1>
          <h2 className="mt-2 text-sm font-bold uppercase tracking-widest">Cotización de reparación</h2>
          <p className="mt-1">
            Folio: <span className="font-bold">{data.folio}</span>
            <span className="ml-3">Emitida: {formatDate(data.issuedAt)}</span>
          </p>
        </div>

        {/* Cliente */}
        <section>
          <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Cliente</h3>
          <table className="w-full">
            <tbody>
              <Row label="Nombre" value={data.customerName} />
              <Row label="Teléfono" value={data.customerPhone} />
              <Row label="Contacto 2" value={data.customerPhoneAlt} />
            </tbody>
          </table>
        </section>

        {/* Equipo */}
        <section>
          <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Equipo</h3>
          <table className="w-full">
            <tbody>
              {data.equipment.map((row, idx) => (
                <Row key={idx} label={row.label} value={row.value} />
              ))}
            </tbody>
          </table>
        </section>

        {/* Falla reportada / diagnóstico (texto ya limpio) */}
        <section>
          <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Trabajo a realizar</h3>
          <div className="space-y-1">
            {service && <p><span className="text-gray-500">Servicio:</span> <span className="font-medium">{service}</span></p>}
            <p><span className="text-gray-500">Falla reportada:</span> {issue}</p>
            {data.diagnosis && <p><span className="text-gray-500">Diagnóstico:</span> {data.diagnosis}</p>}
          </div>
        </section>

        {/* Desglose */}
        {hasBreakdown && (
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Desglose</h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-300 text-[10px] uppercase text-gray-500">
                  <th className="pb-0.5 text-left font-normal">Concepto</th>
                  <th className="pb-0.5 text-center font-normal">Cant</th>
                  <th className="pb-0.5 text-right font-normal">P. unitario</th>
                  <th className="pb-0.5 text-right font-normal">Importe</th>
                </tr>
              </thead>
              <tbody>
                {data.serviceAmount !== undefined && (
                  <tr className="align-top border-b border-gray-100">
                    <td className="py-1 pr-1 font-medium">{service ?? "Servicio de reparación (mano de obra)"}</td>
                    <td className="py-1 text-center">1</td>
                    <td className="py-1 text-right whitespace-nowrap">{formatPrice(data.serviceAmount)}</td>
                    <td className="py-1 text-right whitespace-nowrap">{formatPrice(data.serviceAmount)}</td>
                  </tr>
                )}
                {data.parts.map((part, idx) => (
                  <tr key={idx} className="align-top border-b border-gray-100 last:border-0">
                    <td className="py-1 pr-1">Refacción: {part.description}</td>
                    <td className="py-1 text-center">{part.qty}</td>
                    <td className="py-1 text-right whitespace-nowrap">{formatPrice(part.unitPrice)}</td>
                    <td className="py-1 text-right whitespace-nowrap">{formatPrice(part.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black text-sm">
                  <td colSpan={3} className="pt-1.5 text-right font-bold uppercase">Total</td>
                  <td className="pt-1.5 text-right font-bold whitespace-nowrap">{formatPrice(total)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {/* Vigencia y términos */}
        <section className="space-y-1 text-[10px] leading-snug text-gray-600">
          <p className="font-bold text-black">Válida por 15 días naturales a partir de la fecha de emisión.</p>
          <p className="text-justify">{TERMS}</p>
        </section>

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-8 pt-12 text-center text-[10px]">
          <div>
            <div className="border-t border-gray-400 pt-1">Acepto la cotización</div>
            <p className="mt-0.5 text-gray-500">{data.customerName}</p>
          </div>
          <div>
            <div className="border-t border-gray-400 pt-1">Elaboró</div>
            {data.elaboratedBy && <p className="mt-0.5 text-gray-500">{data.elaboratedBy}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
