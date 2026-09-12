"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { formatDate, formatPrice } from "@/lib/utils"

export interface RepairTicketData {
  title: string
  folio: string
  date: string
  client?: string
  branch?: string
  receivedBy?: string
  promisedAt?: string
  equipment: { label: string; value: string }[]
  issue: string
  // Cobros confirmados (anticipo/abonos/liquidación) y presupuesto en pesos.
  payments?: { label: string; amount: number; method: string }[]
  quote?: number
  balance?: number
  qrCode?: string
  trackingHint?: string
  // URL pública /evidencia/<uploadToken> — el técnico la escanea para subir
  // fotos del equipo desde su celular sin login.
  evidenceUrl?: string
  // Firma del cliente capturada en recepción (PNG base64 data URL).
  signatureData?: string
  businessName?: string
  subtitle?: string
  footer?: string
}

const CONDITIONS =
  "El taller no se hace responsable por la pérdida de datos o información almacenada en el equipo. Los accesorios no declarados durante la recepción quedan bajo responsabilidad del cliente. Los equipos no recogidos en un plazo de 90 días naturales se consideran abandonados."

export function RepairTicketView({ data }: { data: RepairTicketData }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [evidenceQrDataUrl, setEvidenceQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (data.qrCode) {
      QRCode.toDataURL(data.qrCode, { width: 160, margin: 1 })
        .then(url => setQrDataUrl(url))
        .catch(() => {})
    }
    if (data.evidenceUrl) {
      QRCode.toDataURL(data.evidenceUrl, { width: 110, margin: 1 })
        .then(url => setEvidenceQrDataUrl(url))
        .catch(() => {})
    }
  }, [data.qrCode, data.evidenceUrl])

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono">
      {/* Controles NO imprimibles */}
      <div className="max-w-sm mx-auto mb-6 flex items-center justify-between gap-2 print:hidden bg-background p-4 rounded-xl shadow-sm">
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          Imprimir
        </Button>
      </div>

      {/* COMPROBANTE (Formato térmico 58mm/80mm) */}
      <div className="max-w-[80mm] mx-auto bg-white text-black p-4 shadow-lg print:shadow-none print:p-0">

        {/* Cabecera */}
        <div className="text-center mb-4">
          <h1 className="font-bold text-lg leading-tight uppercase">{data.businessName || "PROSOLUTIONS"}</h1>
          <p className="text-[10px] uppercase text-gray-600" style={{ whiteSpace: "pre-line" }}>{data.subtitle || "Venta de refacciones y\nReparación profesional"}</p>
          <div className="border-b-2 border-dashed border-gray-300 my-2"></div>
          <h2 className="font-bold text-sm">{data.title}</h2>
          <p className="font-bold text-sm">Folio: {data.folio}</p>
          <p className="text-[10px]">{formatDate(data.date)}</p>
        </div>

        <div className="border-b border-gray-300 my-2"></div>

        {/* Datos de recepción */}
        <div className="text-xs space-y-1 mb-3">
          {data.client && <p><span className="text-gray-500">Cliente:</span> {data.client}</p>}
          {data.branch && <p><span className="text-gray-500">Sucursal de recepción:</span> {data.branch}</p>}
          {data.receivedBy && <p><span className="text-gray-500">Recibió:</span> {data.receivedBy}</p>}
          {data.promisedAt && <p><span className="text-gray-500">Fecha promesa:</span> {formatDate(data.promisedAt)}</p>}
        </div>

        {/* Equipo recibido */}
        <div className="mb-3">
          <h3 className="text-[10px] uppercase text-gray-500 mb-1">Equipo recibido</h3>
          <table className="w-full text-xs">
            <tbody>
              {data.equipment.map((row, idx) => (
                <tr key={idx} className="align-top">
                  <td className="py-0.5 pr-2 text-gray-500 whitespace-nowrap">{row.label}:</td>
                  <td className="py-0.5 font-medium">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Falla reportada */}
        <div className="mb-3">
          <h3 className="text-[10px] uppercase text-gray-500 mb-1">Falla reportada</h3>
          <p className="text-xs leading-snug">{data.issue}</p>
        </div>

        {/* Cobros y presupuesto (solo si existen) */}
        {((data.payments?.length ?? 0) > 0 || data.quote !== undefined) && (
          <div className="mb-3">
            <h3 className="text-[10px] uppercase text-gray-500 mb-1">Cobros</h3>
            <div className="text-xs space-y-0.5">
              {data.payments?.map((p, idx) => (
                <p key={idx}>{p.label}: {formatPrice(p.amount)} ({p.method})</p>
              ))}
              {data.quote !== undefined && <p>Presupuesto: {formatPrice(data.quote)}</p>}
              {data.balance !== undefined && <p className="font-bold">Saldo: {formatPrice(data.balance)}</p>}
            </div>
          </div>
        )}

        <div className="border-b-2 border-dashed border-gray-300 my-2"></div>

        {/* QR de seguimiento */}
        {qrDataUrl && (
          <div className="text-center mb-3">
            <img src={qrDataUrl} alt="QR de seguimiento" className="w-28 h-28 mx-auto" />
            {data.trackingHint && (
              <p className="text-[10px] text-gray-600 mt-1 leading-snug">{data.trackingHint}</p>
            )}
          </div>
        )}

        {/* QR de evidencias: lo usa el técnico para subir fotos del equipo */}
        {evidenceQrDataUrl && (
          <div className="text-center mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={evidenceQrDataUrl} alt="QR para subir fotos del equipo" className="w-20 h-20 mx-auto" />
            <p className="text-[10px] text-gray-600 mt-1 leading-snug">Subir fotos del equipo</p>
          </div>
        )}

        {/* Firmas */}
        <div className="grid grid-cols-2 gap-6 mt-14 mb-4 text-center text-[10px]">
          <div className="border-t border-gray-400 pt-1">Recibió</div>
          <div className="relative border-t border-gray-400 pt-1">
            {data.signatureData && (
              // El trazo del canvas es claro (#e4e4e7): brightness(0) lo imprime negro.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.signatureData}
                alt="Firma del cliente"
                style={{ filter: "brightness(0)" }}
                className="pointer-events-none absolute bottom-full left-1/2 mb-0.5 h-14 w-auto max-w-[95%] -translate-x-1/2 object-contain"
              />
            )}
            Cliente
          </div>
        </div>

        {/* Condiciones */}
        <p className="text-[9px] text-gray-500 leading-snug text-justify mb-4">{CONDITIONS}</p>

        <div className="text-center text-[10px] text-gray-500 mt-4">
          <p>{data.footer || "¡Gracias por tu preferencia!"}</p>
          <p className="mt-1">{data.businessName || "ProSolutions"} - {new Date().getFullYear()}</p>
        </div>

        {/* Espacio extra abajo para que la térmica corte bien */}
        <div className="h-8 print:block hidden"></div>
      </div>
    </div>
  )
}
