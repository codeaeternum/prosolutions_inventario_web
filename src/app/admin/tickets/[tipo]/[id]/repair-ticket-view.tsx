"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"

export interface RepairTicketData {
  title: string
  folio: string
  date: string
  client?: string
  // Segundo teléfono de contacto declarado en recepción (opcional).
  clientPhoneAlt?: string
  branch?: string
  receivedBy?: string
  promisedAt?: string
  equipment: { label: string; value: string }[]
  issue: string
  // Cobros confirmados (anticipo/abonos/liquidación) y presupuesto en pesos.
  payments?: { label: string; amount: number; method: string }[]
  // Mano de obra estimada original: solo llega cuando una mano de obra
  // autorizada distinta ya la reemplazó en la línea "Mano de obra".
  estimatedQuote?: number
  // Desglose pedido por el cliente: mano de obra y refacciones por separado;
  // en cierres sin reparación solo hay diagnosticFee.
  laborQuote?: number
  partsTotal?: number
  diagnosticFee?: number
  totalOrder?: number
  balance?: number
  qrCode?: string
  trackingHint?: string
  // Firma del cliente capturada en recepción (PNG base64 data URL).
  signatureData?: string
  // Modo de firma del negocio (repair_signature_mode): "canvas" exige la
  // firma digital; "ticket" imprime línea de firma y leyenda de aceptación;
  // "pin" confirma con la terminación telefónica (sin firma en el ticket).
  signatureMode?: "canvas" | "ticket" | "pin"
  // Constancia de entrega: quién recogió el equipo (puede no ser el titular),
  // su identificación opcional, su firma (PNG base64) y quién entregó.
  deliveredTo?: string
  deliveredToDoc?: string
  deliverySignatureData?: string
  deliveredBy?: string
  deliveredAt?: string
  // Garantía vigente: solo llega mientras la orden está reingresada por
  // garantía; warrantyCount es la N del reingreso (Garantía #1, #2…).
  warrantyUntil?: string
  warrantyCount?: number
  businessName?: string
  subtitle?: string
  footer?: string
}

const CONDITIONS =
  "El taller no se hace responsable por la pérdida de datos o información almacenada en el equipo. Los accesorios no declarados durante la recepción quedan bajo responsabilidad del cliente. Los equipos no recogidos en un plazo de 90 días naturales se consideran abandonados."

export function RepairTicketView({ data }: { data: RepairTicketData }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  // El ticket suele abrirse en pestaña nueva (target="_blank"): ahí
  // history.back() es un callejón sin salida, así que cerramos la pestaña.
  function goBack() {
    if (window.opener || window.history.length <= 1) {
      window.close()
      // window.close() falla si la pestaña no la abrió un script: ir al taller.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/admin/taller"
    } else {
      window.history.back()
    }
  }

  useEffect(() => {
    if (data.qrCode) {
      QRCode.toDataURL(data.qrCode, { width: 160, margin: 1 })
        .then(url => setQrDataUrl(url))
        .catch(() => {})
    }
  }, [data.qrCode])

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono">
      {/* Controles NO imprimibles */}
      <div className="max-w-sm mx-auto mb-6 flex items-center justify-between gap-2 print:hidden bg-background p-4 rounded-xl shadow-sm">
        <Button variant="outline" size="sm" onClick={goBack}>
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
          {data.clientPhoneAlt && <p><span className="text-gray-500">Contacto 2:</span> {data.clientPhoneAlt}</p>}
          {data.branch && <p><span className="text-gray-500">Sucursal de recepción:</span> {data.branch}</p>}
          {data.receivedBy && <p><span className="text-gray-500">Recibió:</span> {data.receivedBy}</p>}
          {data.promisedAt && <p><span className="text-gray-500">Fecha promesa:</span> {formatDate(data.promisedAt)}</p>}
          {data.warrantyUntil && <p><span className="text-gray-500">Garantía #{data.warrantyCount ?? 1}:</span> válida hasta {formatDay(data.warrantyUntil)}</p>}
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

        {/* Cobros y desglose (solo si existen) */}
        {((data.payments?.length ?? 0) > 0 || data.totalOrder !== undefined) && (
          <div className="mb-3">
            <h3 className="text-[10px] uppercase text-gray-500 mb-1">Cobros</h3>
            <div className="text-xs space-y-0.5">
              {data.payments?.map((p, idx) => (
                <p key={idx}>{p.label}: {formatPrice(p.amount)} ({p.method})</p>
              ))}
              {data.estimatedQuote !== undefined && <p>Mano de obra estimada: {formatPrice(data.estimatedQuote)}</p>}
              {data.laborQuote !== undefined && <p>{data.estimatedQuote !== undefined ? "Mano de obra autorizada" : "Mano de obra"}: {formatPrice(data.laborQuote)}</p>}
              {data.partsTotal !== undefined && <p>Refacciones: {formatPrice(data.partsTotal)}</p>}
              {data.diagnosticFee !== undefined && <p>Cargo por diagnóstico: {formatPrice(data.diagnosticFee)}</p>}
              {data.totalOrder !== undefined && <p className="font-bold">Total a pagar: {formatPrice(data.totalOrder)}</p>}
              {data.balance !== undefined && <p className="font-bold">Saldo: {formatPrice(data.balance)}</p>}
            </div>
          </div>
        )}

        {/* Constancia de entrega: solo se imprime cuando la orden ya fue
            entregada — quién recogió, con qué identificación, su firma y
            quién del staff la entregó. */}
        {data.deliveredTo && (
          <div className="mb-3">
            <h3 className="text-[10px] uppercase text-gray-500 mb-1">Entrega del equipo</h3>
            <div className="text-xs space-y-0.5">
              <p><span className="text-gray-500">Entregado a:</span> {data.deliveredTo}</p>
              {data.deliveredToDoc && <p><span className="text-gray-500">Identificación:</span> {data.deliveredToDoc}</p>}
              {data.deliveredBy && <p><span className="text-gray-500">Entregó:</span> {data.deliveredBy}</p>}
              {data.deliveredAt && <p><span className="text-gray-500">Fecha de entrega:</span> {formatDate(data.deliveredAt)}</p>}
            </div>
            {data.deliverySignatureData && (
              <div className="mt-1">
                {/* El trazo del canvas es claro (#e4e4e7): brightness(0) lo imprime negro. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.deliverySignatureData}
                  alt="Firma de quien recibió el equipo"
                  style={{ filter: "brightness(0)" }}
                  className="h-14 w-auto max-w-[95%] object-contain"
                />
                <p className="text-[9px] text-gray-500">Firma de quien recibe</p>
              </div>
            )}
          </div>
        )}

        <div className="border-b-2 border-dashed border-gray-300 my-2"></div>

        {/* QR de seguimiento */}
        {qrDataUrl && (
          <div className="text-center mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR de seguimiento" className="w-28 h-28 mx-auto" />
            {data.trackingHint && (
              <p className="text-[10px] text-gray-600 mt-1 leading-snug">{data.trackingHint}</p>
            )}
          </div>
        )}

        {/* Firmas. En modo "ticket" —o siempre que falte la firma digital—
            la línea invita a firmar en el comprobante impreso. */}
        {(() => {
          const signatureOnPaper = data.signatureMode === "ticket" || !data.signatureData
          return (
            <>
              <div className="grid grid-cols-2 gap-6 mt-14 mb-1 text-center text-[10px]">
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
                  {signatureOnPaper ? "Firma del cliente" : "Cliente"}
                </div>
              </div>
              {signatureOnPaper && (
                <p className="mb-4 text-center text-[9px] text-gray-500">
                  Al firmar acepta las condiciones de servicio
                </p>
              )}
              {!signatureOnPaper && <div className="mb-4" />}
            </>
          )
        })()}

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
