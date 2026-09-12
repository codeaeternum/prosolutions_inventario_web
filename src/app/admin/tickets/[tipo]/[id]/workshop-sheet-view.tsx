"use client"

import { ArrowLeft, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate, formatPrice } from "@/lib/utils"

export interface WorkshopSheetData {
  folio: string
  status: string
  receivedAt: string
  scheduledAt?: string
  promisedAt?: string
  intakeBranch: string
  currentBranch: string
  assignedTo?: string
  receivedBy: string
  customerName: string
  customerPhone: string
  customerPhoneAlt?: string
  equipment: { label: string; value: string }[]
  // Tipo y clave de desbloqueo del equipo: SOLO se imprimen en esta hoja
  // interna; el ticket del cliente jamás los muestra.
  accessType?: string
  accessTypeLabel?: string
  accessValue?: string
  issue: string
  diagnosis?: string
  qualityCheck?: string
  deliveredTo?: string
  // Importes en pesos (los campos *Cents de la orden ya vienen convertidos).
  quote?: number
  approvedQuote?: number
  quoteApprovedAt?: string
  parts: {
    description: string
    productName?: string
    qty: number
    cost: number
    price: number
    statusLabel: string
    requestedBy: string
    decidedBy?: string
    decisionNote?: string
  }[]
  payments: { label: string; amount: number; method: string; date: string }[]
  paidTotal: number
  balance?: number
  // Últimos eventos de la orden (tipo ya traducido, detalle y actor).
  events: { date: string; typeLabel: string; detail: string; actor: string }[]
  businessName?: string
}

// Fila etiqueta/valor usada en todas las secciones de la hoja.
function SheetRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <tr className="align-top">
      <td className="py-0.5 pr-2 text-gray-500 whitespace-nowrap">{label}:</td>
      <td className="py-0.5 font-medium">{value}</td>
    </tr>
  )
}

// Patrón de desbloqueo como cuadrícula 3x3 impresa: el orden de los puntos
// se lee igual en papel que en la pantalla del tablero de taller.
function AccessPattern({ value }: { value: string }) {
  const steps = value.split("-").map(Number)
  return (
    <span className="inline-grid grid-cols-3 gap-1 align-middle" aria-label={`Patrón de desbloqueo ${value}`}>
      {Array.from({ length: 9 }, (_, index) => {
        const step = steps.indexOf(index)
        return (
          <span key={index} className={`flex h-4 w-4 items-center justify-center rounded-full border border-black text-[8px] leading-none ${step >= 0 ? "bg-black font-bold text-white" : ""}`}>
            {step >= 0 ? step + 1 : ""}
          </span>
        )
      })}
    </span>
  )
}

export function WorkshopSheetView({ data }: { data: WorkshopSheetData }) {
  // Mismo patrón que el ticket: en pestaña abierta por script history.back()
  // no hace nada; cerramos y, si el navegador no deja, volvemos al taller.
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
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono">
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

      {/* HOJA DE SERVICIO (media carta / A5 — documento interno) */}
      <div className="max-w-xl mx-auto bg-white text-black text-xs shadow-lg print:shadow-none">
        {/* Franja de advertencia: borde + texto rojo para que se note aunque
            la impresora no reproduzca el fondo de color */}
        <div className="border-4 border-red-700 bg-red-700 px-3 py-1.5 text-center text-[11px] font-bold uppercase tracking-widest text-white print:bg-transparent print:text-red-700">
          USO INTERNO — NO ENTREGAR AL CLIENTE
        </div>

        <div className="p-5 space-y-4">
          {/* Cabecera */}
          <div className="text-center">
            <h1 className="text-base font-bold uppercase leading-tight">{data.businessName || "PROSOLUTIONS"}</h1>
            <h2 className="mt-1 text-sm font-bold uppercase">Hoja de servicio — Uso interno</h2>
            <p className="mt-1 text-sm font-bold">
              Folio: {data.folio}
              <span className="ml-3 font-normal">Estado: {data.status}</span>
            </p>
          </div>

          {/* Datos de la orden */}
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Orden</h3>
            <table className="w-full">
              <tbody>
                <SheetRow label="Recepción" value={formatDate(data.receivedAt)} />
                <SheetRow label="Programada" value={data.scheduledAt ? formatDate(data.scheduledAt) : undefined} />
                <SheetRow label="Prometida" value={data.promisedAt ? formatDate(data.promisedAt) : undefined} />
                <SheetRow label="Suc. recepción" value={data.intakeBranch} />
                <SheetRow label="Suc. actual" value={data.currentBranch} />
                <SheetRow label="Técnico" value={data.assignedTo ?? "Sin asignar"} />
                <SheetRow label="Recibió" value={data.receivedBy} />
              </tbody>
            </table>
          </section>

          {/* Cliente */}
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Cliente</h3>
            <table className="w-full">
              <tbody>
                <SheetRow label="Nombre" value={data.customerName} />
                <SheetRow label="Teléfono" value={data.customerPhone} />
                <SheetRow label="Contacto 2" value={data.customerPhoneAlt} />
              </tbody>
            </table>
          </section>

          {/* Equipo completo */}
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Equipo</h3>
            <table className="w-full">
              <tbody>
                {data.equipment.map((row, idx) => (
                  <SheetRow key={idx} label={row.label} value={row.value} />
                ))}
              </tbody>
            </table>
          </section>

          {/* BLOQUEO: tipo y clave de desbloqueo — confidencial, uso interno */}
          {(data.accessTypeLabel || data.accessValue) && (
            <section className="border-2 border-dashed border-red-500 bg-red-50 p-2 print:bg-transparent">
              <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-red-700">Bloqueo del equipo — Confidencial · uso interno</h3>
              <p>Tipo: <span className="font-medium">{data.accessTypeLabel || "Sin registrar"}</span></p>
              {data.accessType === "PATTERN" && data.accessValue ? (
                <p className="mt-1 flex items-center gap-2">
                  Patrón: <AccessPattern value={data.accessValue} />
                  <span className="font-medium">({data.accessValue})</span>
                </p>
              ) : data.accessValue ? (
                <p className="mt-1">Clave: <span className="font-bold">{data.accessValue}</span></p>
              ) : null}
            </section>
          )}

          {/* Servicio */}
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Servicio</h3>
            <div className="space-y-1">
              <p><span className="text-gray-500">Falla reportada:</span> {data.issue}</p>
              {data.diagnosis && <p><span className="text-gray-500">Diagnóstico:</span> {data.diagnosis}</p>}
              {data.qualityCheck && <p><span className="text-gray-500">Revisión final:</span> {data.qualityCheck}</p>}
              {data.deliveredTo && <p><span className="text-gray-500">Entregado a:</span> {data.deliveredTo}</p>}
            </div>
          </section>

          {/* Presupuesto */}
          {(data.quote !== undefined || data.approvedQuote !== undefined) && (
            <section>
              <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Presupuesto</h3>
              <div className="space-y-0.5">
                {data.quote !== undefined && <p>Estimado: {formatPrice(data.quote)}</p>}
                {data.approvedQuote !== undefined && (
                  <p className="font-bold">
                    Autorizado: {formatPrice(data.approvedQuote)}
                    {data.quoteApprovedAt && <span className="ml-1 font-normal text-gray-500">({formatDate(data.quoteApprovedAt)})</span>}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Refacciones */}
          {data.parts.length > 0 && (
            <section>
              <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Refacciones</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-300 text-[10px] uppercase text-gray-500">
                    <th className="pb-0.5 text-left font-normal">Descripción</th>
                    <th className="pb-0.5 text-center font-normal">Cant</th>
                    <th className="pb-0.5 text-right font-normal">Costo</th>
                    <th className="pb-0.5 text-right font-normal">Precio</th>
                    <th className="pb-0.5 text-right font-normal">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.parts.map((part, idx) => (
                    <tr key={idx} className="align-top border-b border-gray-100 last:border-0">
                      <td className="py-1 pr-1">
                        <p className="font-medium">{part.description}</p>
                        {part.productName && <p className="text-[10px] text-gray-500">Inventario: {part.productName}</p>}
                        <p className="text-[10px] text-gray-500">
                          Pidió: {part.requestedBy}{part.decidedBy ? ` · Decidió: ${part.decidedBy}` : ""}
                        </p>
                        {part.decisionNote && <p className="text-[10px] text-gray-500">Nota: {part.decisionNote}</p>}
                      </td>
                      <td className="py-1 text-center">{part.qty}</td>
                      <td className="py-1 text-right whitespace-nowrap">{formatPrice(part.cost)}</td>
                      <td className="py-1 text-right whitespace-nowrap">{formatPrice(part.price)}</td>
                      <td className="py-1 pl-1 text-right whitespace-nowrap">{part.statusLabel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Pagos y saldo */}
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Pagos</h3>
            <div className="space-y-0.5">
              {data.payments.length > 0 ? (
                data.payments.map((p, idx) => (
                  <p key={idx}>
                    {p.label}: {formatPrice(p.amount)} ({p.method})
                    <span className="text-gray-500"> — {formatDate(p.date)}</span>
                  </p>
                ))
              ) : (
                <p className="text-gray-500">Sin pagos registrados</p>
              )}
              {data.payments.length > 0 && <p>Total pagado: {formatPrice(data.paidTotal)}</p>}
              {data.balance !== undefined && <p className="font-bold">Saldo: {formatPrice(data.balance)}</p>}
            </div>
          </section>

          {/* Historial de la orden */}
          {data.events.length > 0 && (
            <section>
              <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Historial</h3>
              <ol className="space-y-1.5">
                {data.events.map((event, idx) => (
                  <li key={idx} className="border-l-2 border-gray-300 pl-2">
                    <p className="leading-snug">{event.detail}</p>
                    <p className="text-[10px] text-gray-500">{event.typeLabel} · {event.actor} · {formatDate(event.date)}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Firmas internas */}
          <div className="grid grid-cols-2 gap-8 pt-10 text-center text-[10px]">
            <div className="border-t border-gray-400 pt-1">Recibió (taller)</div>
            <div className="border-t border-gray-400 pt-1">Entregó / Revisó</div>
          </div>
        </div>

        {/* Franja de advertencia repetida al pie */}
        <div className="border-4 border-red-700 bg-red-700 px-3 py-1 text-center text-[10px] font-bold uppercase tracking-widest text-white print:bg-transparent print:text-red-700">
          USO INTERNO — NO ENTREGAR AL CLIENTE
        </div>
      </div>
    </div>
  )
}
