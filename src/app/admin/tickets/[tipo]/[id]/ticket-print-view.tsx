"use client"

import { useEffect, useState } from "react"
import { Printer, Share2, ArrowLeft, Scissors } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPrice, formatDate } from "@/lib/utils"
import QRCode from "qrcode"

interface TicketData {
  title: string
  folio: string
  date: string
  client?: string
  clientLabel?: string
  badge?: string
  cashier?: string
  items: { name: string; qty: number; price: number; total: number }[]
  total: number
  /** Descuento autorizado al cobrar (pesos): el total ya viene neto. */
  discount?: number
  discountReason?: string
  paymentMethod?: string
  notes?: string
  newBalance?: number
  qrCode?: string
  businessName?: string
  subtitle?: string
  footer?: string
  // Número de copias a imprimir seguidas (?copias=2). La segunda y
  // siguientes llevan el encabezado "COPIA — CAJA" y quedan en el negocio.
  copies?: number
}

// Cuerpo del ticket térmico (58mm/80mm). `copyLabel` marca la copia interna.
function TicketBody({ data, qrDataUrl, copyLabel }: { data: TicketData; qrDataUrl: string | null; copyLabel?: string }) {
  return (
    <div className="max-w-[80mm] mx-auto bg-white text-black p-4 shadow-lg print:shadow-none print:p-0">

      {/* Cabecera */}
      <div className="text-center mb-4">
        {copyLabel && (
          <p className="font-bold text-sm uppercase tracking-widest border-2 border-black rounded px-2 py-0.5 mb-2 inline-block">
            {copyLabel}
          </p>
        )}
        <h1 className="font-bold text-lg leading-tight uppercase">{data.businessName || "PROSOLUTIONS"}</h1>
        <p className="text-[10px] uppercase text-gray-600" style={{ whiteSpace: 'pre-line' }}>{data.subtitle || "Venta de refacciones y\nReparación profesional"}</p>
        <div className="border-b-2 border-dashed border-gray-300 my-2"></div>
        <h2 className="font-bold text-sm">{data.title}</h2>
        <p className="text-xs">Folio: {data.folio}</p>
        <p className="text-[10px]">{formatDate(data.date)}</p>
        {data.badge && (
          <p className="text-[10px] font-bold uppercase inline-block border border-gray-400 rounded px-1.5 py-0.5 mt-1">
            {data.badge}
          </p>
        )}
        {data.client && <p className="text-xs mt-1">{data.clientLabel ?? "Cliente"}: {data.client}</p>}
        {data.cashier && <p className="text-[10px]">Atendió: {data.cashier}</p>}
      </div>

      <div className="border-b border-gray-300 my-2"></div>

      {/* Artículos */}
      <div className="mb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left pb-1 font-normal w-3/5">CANT/DESCRIPCIÓN</th>
              <th className="text-right pb-1 font-normal w-2/5">IMPORTE</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, idx) => (
              <tr key={idx}>
                <td className="py-1">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-[10px] text-gray-500">{item.qty} x {formatPrice(item.price)}</div>
                </td>
                <td className="text-right align-bottom py-1">{formatPrice(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-b-2 border-dashed border-gray-300 my-2"></div>

      {/* Totales */}
      <div className="space-y-1 mb-4">
        {data.discount != null && data.discount > 0 && (
          <>
            <div className="flex justify-between text-xs text-gray-600">
              <span>SUBTOTAL:</span>
              <span>{formatPrice(data.total + data.discount)}</span>
            </div>
            <div className="flex justify-between gap-2 text-xs text-gray-600">
              <span className="truncate">DESCUENTO{data.discountReason ? ` (${data.discountReason})` : ""}:</span>
              <span className="shrink-0">-{formatPrice(data.discount)}</span>
            </div>
          </>
        )}
        <div className="flex justify-between font-bold text-sm">
          <span>TOTAL:</span>
          <span>{formatPrice(data.total)}</span>
        </div>
        {data.paymentMethod && (
          <div className="flex justify-between gap-4 text-xs text-gray-600">
            <span>MÉTODO:</span>
            <span className="text-right whitespace-pre-line">{data.paymentMethod}</span>
          </div>
        )}
        {data.newBalance !== undefined && (
          <div className="flex justify-between text-xs font-medium mt-2 pt-2 border-t border-gray-200">
            <span>SALDO ACTUAL:</span>
            <span>{formatPrice(data.newBalance)}</span>
          </div>
        )}
      </div>

      {/* Notas y Pie */}
      {data.notes && (
        <div className="text-[10px] text-gray-500 mb-4 p-2 bg-gray-50 border border-gray-200 rounded">
          {data.notes}
        </div>
      )}

      {/* QR Code */}
      {qrDataUrl && (
        <div className="text-center mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="QR" className="w-32 h-32 mx-auto" />
        </div>
      )}

      <div className="text-center text-[10px] text-gray-500 mt-6">
        <p>{data.footer || "¡Gracias por tu preferencia!"}</p>
        <p className="mt-1">{data.businessName || "ProSolutions"} - {new Date().getFullYear()}</p>
      </div>

      {/* Espacio extra abajo para que la térmica corte bien */}
      <div className="h-8 print:block hidden"></div>
    </div>
  )
}

export function TicketPrintView({ data }: { data: TicketData }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const copies = Math.min(4, Math.max(1, data.copies ?? 1))

  useEffect(() => {
    if (data.qrCode) {
      QRCode.toDataURL(data.qrCode, { width: 160, margin: 1 })
        .then(url => setQrDataUrl(url))
        .catch(() => {})
    }
  }, [data.qrCode])

  const handlePrint = () => {
    window.print()
  }

  const handleShareWa = () => {
    let text = `*${(data.businessName || "Ticket").toUpperCase()} - ${data.title}*\n`
    text += `Folio: ${data.folio}\n`
    text += `Fecha: ${formatDate(data.date)}\n`
    if (data.client) text += `${data.clientLabel ?? "Cliente"}: ${data.client}\n`
    text += `------------------------\n`
    data.items.forEach(i => {
      text += `${i.qty}x ${i.name} - ${formatPrice(i.total)}\n`
    })
    text += `------------------------\n`
    if (data.discount != null && data.discount > 0) {
      text += `Subtotal: ${formatPrice(data.total + data.discount)}\n`
      text += `Descuento${data.discountReason ? ` (${data.discountReason})` : ""}: -${formatPrice(data.discount)}\n`
    }
    text += `*TOTAL: ${formatPrice(data.total)}*\n`
    if (data.newBalance !== undefined) {
      text += `Saldo actual: ${formatPrice(data.newBalance)}\n`
    }
    text += `\n¡Gracias por tu preferencia!`

    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, '_blank')
  }


  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono">
      {/* Controles NO imprimibles */}
      <div className="max-w-sm mx-auto mb-6 flex items-center justify-between gap-2 print:hidden bg-background p-4 rounded-xl shadow-sm">
        <Button variant="outline" size="sm" onClick={() => {
          // Pestaña abierta por script (target="_blank"): history.back() no hace
          // nada ahí; cerramos y si no se puede, volvemos al panel.
          if (window.opener || window.history.length <= 1) { window.close(); // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/admin" }
          else window.history.back()
        }}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleShareWa}>
            <Share2 className="w-4 h-4 mr-2" />
            WhatsApp
          </Button>
          <Button size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Copias del ticket: la primera es la del cliente; las demás quedan
          en el negocio ("COPIA — CAJA") separadas por línea de corte. */}
      {Array.from({ length: copies }, (_, idx) => (
        <div key={idx}>
          {idx > 0 && (
            <div className="max-w-[80mm] mx-auto flex items-center gap-2 py-4 print:py-6" aria-hidden>
              <div className="flex-1 border-t-2 border-dashed border-gray-400"></div>
              <Scissors className="w-4 h-4 text-gray-500 shrink-0" />
              <div className="flex-1 border-t-2 border-dashed border-gray-400"></div>
            </div>
          )}
          <TicketBody data={data} qrDataUrl={qrDataUrl} copyLabel={idx > 0 ? "COPIA — CAJA" : undefined} />
        </div>
      ))}
    </div>
  )
}
