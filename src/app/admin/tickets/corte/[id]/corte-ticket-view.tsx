"use client"

import { Printer, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPrice, formatDate } from "@/lib/utils"

export interface CorteTicketData {
  title: string
  folio: string
  branch: string
  openedAt: string
  closedAt: string
  openedBy: string
  closedBy: string
  initialAmount: number
  methodTotals: { label: string; amount: number }[]
  hasDenominations: boolean
  denominations: { key: string; label: string; count: number; subtotal: number }[]
  counted: number | null
  expected: number
  difference: number | null
  movementCount: number
  notes?: string
  businessName?: string
  subtitle?: string
  footer?: string
}

export function CorteTicketView({ data }: { data: CorteTicketData }) {
  const differenceLabel = data.difference == null
    ? "—"
    : data.difference === 0
      ? "CUADRADO"
      : data.difference > 0
        ? `SOBRANTE ${formatPrice(data.difference)}`
        : `FALTANTE ${formatPrice(Math.abs(data.difference))}`

  return (
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono">
      {/* Controles NO imprimibles */}
      <div className="max-w-sm mx-auto mb-6 flex items-center justify-between gap-2 print:hidden bg-background p-4 rounded-xl shadow-sm">
        <Button variant="outline" size="sm" onClick={() => {
          // Pestaña abierta por script (target="_blank"): history.back() no hace
          // nada ahí; cerramos y si no se puede, volvemos al panel.
          if (window.opener || window.history.length <= 1) { window.close(); // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.href = "/admin/caja" }
          else window.history.back()
        }}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          Imprimir
        </Button>
      </div>

      {/* TICKET (Formato térmico 80mm) */}
      <div className="max-w-[80mm] mx-auto bg-white text-black p-4 shadow-lg print:shadow-none print:p-0">

        {/* Cabecera */}
        <div className="text-center mb-4">
          <h1 className="font-bold text-lg leading-tight uppercase">{data.businessName || "PROSOLUTIONS"}</h1>
          <p className="text-[10px] uppercase text-gray-600" style={{ whiteSpace: 'pre-line' }}>{data.subtitle || "Venta de refacciones y\nReparación profesional"}</p>
          <div className="border-b-2 border-dashed border-gray-300 my-2"></div>
          <h2 className="font-bold text-sm">{data.title}</h2>
          <p className="text-xs">Folio: {data.folio}</p>
          <p className="text-xs">Sucursal: {data.branch}</p>
        </div>

        <div className="border-b border-gray-300 my-2"></div>

        {/* Turno */}
        <div className="text-xs space-y-1 mb-3">
          <div className="flex justify-between"><span>Apertura:</span><span>{formatDate(data.openedAt)}</span></div>
          <div className="flex justify-between"><span>Cierre:</span><span>{formatDate(data.closedAt)}</span></div>
          <div className="flex justify-between"><span>Abrió:</span><span>{data.openedBy}</span></div>
          <div className="flex justify-between"><span>Cerró:</span><span>{data.closedBy}</span></div>
          <div className="flex justify-between"><span>Fondo inicial:</span><span>{formatPrice(data.initialAmount)}</span></div>
          <div className="flex justify-between"><span>Movimientos:</span><span>{data.movementCount}</span></div>
        </div>

        <div className="border-b border-gray-300 my-2"></div>

        {/* Cobrado por método */}
        <p className="text-[10px] font-bold uppercase mb-1">Cobrado por método</p>
        <div className="text-xs space-y-1 mb-3">
          {data.methodTotals.map(row => (
            <div key={row.label} className="flex justify-between"><span>{row.label}:</span><span>{formatPrice(row.amount)}</span></div>
          ))}
        </div>

        <div className="border-b-2 border-dashed border-gray-300 my-2"></div>

        {/* Desglose de denominaciones */}
        {data.hasDenominations ? (
          <>
            <p className="text-[10px] font-bold uppercase mb-1">Conteo físico</p>
            <table className="w-full text-xs mb-3">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left pb-1 font-normal">DENOM.</th>
                  <th className="text-center pb-1 font-normal">PIEZAS</th>
                  <th className="text-right pb-1 font-normal">SUBTOTAL</th>
                </tr>
              </thead>
              <tbody>
                {data.denominations.map(row => (
                  <tr key={row.key}>
                    <td className="py-0.5">{row.label}</td>
                    <td className="py-0.5 text-center">{row.count}</td>
                    <td className="py-0.5 text-right">{formatPrice(row.subtotal)}</td>
                  </tr>
                ))}
                {data.denominations.length === 0 && (
                  <tr><td colSpan={3} className="py-1 text-center text-gray-500">Conteo en ceros</td></tr>
                )}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-[10px] text-gray-500 mb-3">Cierre sin desglose de denominaciones.</p>
        )}

        {/* Totales del corte */}
        <div className="space-y-1 mb-4">
          <div className="flex justify-between font-bold text-sm">
            <span>TOTAL CONTADO:</span>
            <span>{data.counted == null ? "—" : formatPrice(data.counted)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span>ESPERADO:</span>
            <span>{formatPrice(data.expected)}</span>
          </div>
          <div className="flex justify-between font-bold text-sm mt-2 pt-2 border-t border-gray-200">
            <span>DIFERENCIA:</span>
            <span>{differenceLabel}</span>
          </div>
        </div>

        {/* Notas */}
        {data.notes && (
          <div className="text-[10px] text-gray-500 mb-4 p-2 bg-gray-50 border border-gray-200 rounded">
            {data.notes}
          </div>
        )}

        <div className="text-center text-[10px] text-gray-500 mt-6">
          <p>{data.footer || "¡Gracias por tu preferencia!"}</p>
          <p className="mt-1">{data.businessName || "ProSolutions"} - {new Date().getFullYear()}</p>
        </div>

        {/* Espacio extra abajo para que la térmica corte bien */}
        <div className="h-8 print:block hidden"></div>
      </div>
    </div>
  )
}
