"use client"

import { useEffect, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import QRCode from "qrcode"
import { Button } from "@/components/ui/button"
import { cn, formatAccessPattern, formatDate, formatPrice } from "@/lib/utils"

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
  // Tipo y clave de desbloqueo del equipo: SOLO se imprimen en documentos
  // internos (esta hoja y la etiqueta pegada al equipo); el ticket del
  // cliente jamás los muestra.
  accessType?: string
  accessTypeLabel?: string
  accessValue?: string
  issue: string
  diagnosis?: string
  qualityCheck?: string
  // Constancia de entrega estructurada: receptor (puede no ser el titular),
  // su identificación, su firma (PNG base64) y quién del staff entregó.
  deliveredTo?: string
  deliveredToDoc?: string
  deliverySignatureData?: string
  deliveredBy?: string
  deliveredAt?: string
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
  // Totales de la orden (workshop-money): refacciones autorizadas a precio,
  // cargo por diagnóstico en cierres sin reparación y total a cobrar.
  partsTotal?: number
  diagnosticFee?: number
  totalOrder?: number
  balance?: number
  // Últimos eventos de la orden (tipo ya traducido, detalle y actor).
  events: { date: string; typeLabel: string; detail: string; actor: string }[]
  // URL pública /evidencia/<uploadToken> — el técnico la escanea para subir
  // fotos del equipo desde su celular sin login.
  evidenceUrl?: string
  // Orden terminal: el enlace público ya murió (la ruta rechaza la subida y
  // el cierre rota el token) — se imprime el aviso en lugar de un QR que
  // solo llevaría a un error.
  evidenceLinkDisabled?: boolean
  // Etiqueta 50×40: toggles del negocio (label_show_problem,
  // label_show_access). undefined = imprimir (default).
  labelShowProblem?: boolean
  labelShowAccess?: boolean
  businessName?: string
}

// Formatos de impresión de la hoja interna.
type SheetFormat = "sheet" | "thermal" | "label"

const FORMAT_OPTIONS: { value: SheetFormat; label: string }[] = [
  { value: "sheet", label: "Hoja completa" },
  { value: "thermal", label: "Térmico 80mm" },
  { value: "label", label: "Etiqueta" },
]

// @page por formato: la hoja completa usa el tamaño por defecto de la
// impresora (media carta); térmico y etiqueta fijan el ancho del papel.
const PAGE_CSS: Record<SheetFormat, string> = {
  sheet: "",
  thermal: "@page { size: 80mm auto; margin: 0; }",
  // La etiqueta creció a 50×40mm para caber la falla reportada y la clave.
  label: "@page { size: 50mm 40mm; margin: 0; }",
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

// Fecha corta dd/mm/aaaa para espacios reducidos (etiqueta).
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// Busca el valor de una fila de equipo por su etiqueta ("Marca", "Modelo"...).
function equipmentValue(data: WorkshopSheetData, label: string) {
  return data.equipment.find(row => row.label === label)?.value ?? ""
}

/* ---------- HOJA COMPLETA (media carta, documento interno actual) ---------- */

function FullSheet({ data, evidenceQr, evidenceDisabled }: { data: WorkshopSheetData; evidenceQr: string | null; evidenceDisabled?: boolean }) {
  return (
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
                <span className="font-medium">({formatAccessPattern(data.accessValue)})</span>
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
          </div>
        </section>

        {/* Constancia de entrega */}
        {data.deliveredTo && (
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Entrega del equipo</h3>
            <table className="w-full">
              <tbody>
                <SheetRow label="Entregado a" value={data.deliveredTo} />
                <SheetRow label="Identificación" value={data.deliveredToDoc} />
                <SheetRow label="Entregó" value={data.deliveredBy} />
                <SheetRow label="Fecha de entrega" value={data.deliveredAt ? formatDate(data.deliveredAt) : undefined} />
              </tbody>
            </table>
            {data.deliverySignatureData && (
              <div className="mt-1">
                {/* El trazo del canvas es claro (#e4e4e7): brightness(0) lo imprime negro. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={data.deliverySignatureData} alt="Firma de quien recibió el equipo" style={{ filter: "brightness(0)" }} className="h-14 w-auto object-contain" />
                <p className="text-[9px] text-gray-500">Firma de quien recibe</p>
              </div>
            )}
          </section>
        )}

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
            {data.partsTotal !== undefined && <p>Refacciones autorizadas: {formatPrice(data.partsTotal)}</p>}
            {data.diagnosticFee !== undefined && <p>Cargo por diagnóstico: {formatPrice(data.diagnosticFee)}</p>}
            {data.totalOrder !== undefined && <p className="font-bold">Total a cobrar: {formatPrice(data.totalOrder)}</p>}
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

        {/* QR de evidencias: el técnico lo escanea con su celular para subir
            fotos del estado del equipo sin login (sección operativa). En orden
            cerrada el enlace ya no funciona y se imprime solo el aviso. */}
        {evidenceQr ? (
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Evidencias</h3>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={evidenceQr} alt="QR para subir fotos del equipo" className="h-20 w-20" />
              <p className="text-[10px] text-gray-500 leading-snug">
                Escanea con el celular para subir fotos del estado del equipo a esta orden.
              </p>
            </div>
          </section>
        ) : evidenceDisabled ? (
          <section>
            <h3 className="mb-1 border-b border-gray-400 text-[10px] font-bold uppercase tracking-wide text-gray-600">Evidencias</h3>
            <p className="text-[10px] text-gray-500 leading-snug">
              Link de evidencias desactivado: la orden está cerrada y el código QR impreso anteriormente ya no funciona.
            </p>
          </section>
        ) : null}

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
  )
}

/* ---------- TÉRMICO 80mm (versión angosta de la hoja interna) ---------- */

function ThermalSheet({ data, evidenceQr, evidenceDisabled }: { data: WorkshopSheetData; evidenceQr: string | null; evidenceDisabled?: boolean }) {
  return (
    <div className="max-w-[80mm] mx-auto bg-white text-black text-xs shadow-lg print:shadow-none p-3">
      <div className="border-2 border-red-700 px-2 py-1 text-center text-[9px] font-bold uppercase tracking-widest text-red-700">
        Uso interno — No entregar al cliente
      </div>

      {/* Cabecera */}
      <div className="text-center mt-2 mb-2">
        <h1 className="font-bold text-sm uppercase leading-tight">{data.businessName || "PROSOLUTIONS"}</h1>
        <p className="font-bold text-base">Folio: {data.folio}</p>
        <p className="text-[10px]">{data.status} · Recibido {formatDate(data.receivedAt)}</p>
        {data.promisedAt && <p className="text-[10px]">Prometido: {formatDate(data.promisedAt)}</p>}
      </div>

      <div className="border-b border-dashed border-gray-400 my-2"></div>

      {/* Orden / cliente */}
      <div className="space-y-0.5 mb-2">
        <p><span className="text-gray-500">Técnico:</span> {data.assignedTo ?? "Sin asignar"}</p>
        <p><span className="text-gray-500">Cliente:</span> {data.customerName}</p>
        <p><span className="text-gray-500">Teléfono:</span> {data.customerPhone}</p>
        {data.customerPhoneAlt && <p><span className="text-gray-500">Contacto 2:</span> {data.customerPhoneAlt}</p>}
        {data.deliveredTo && <p><span className="text-gray-500">Entregado a:</span> {data.deliveredTo}{data.deliveredBy ? ` · Entregó: ${data.deliveredBy}` : ""}</p>}
      </div>

      {/* Equipo */}
      <div className="mb-2">
        <h3 className="text-[10px] font-bold uppercase text-gray-600 mb-0.5">Equipo</h3>
        <table className="w-full">
          <tbody>
            {data.equipment.map((row, idx) => (
              <SheetRow key={idx} label={row.label} value={row.value} />
            ))}
          </tbody>
        </table>
      </div>

      {/* BLOQUEO: confidencial — el térmico sigue siendo uso interno */}
      {(data.accessTypeLabel || data.accessValue) && (
        <div className="border border-dashed border-red-500 p-1.5 mb-2">
          <p className="text-[9px] font-bold uppercase tracking-wide text-red-700 mb-0.5">Bloqueo — Confidencial</p>
          <p>Tipo: <span className="font-medium">{data.accessTypeLabel || "Sin registrar"}</span></p>
          {data.accessType === "PATTERN" && data.accessValue ? (
            <p className="mt-1 flex items-center gap-2">
              <AccessPattern value={data.accessValue} />
              <span className="font-medium">({formatAccessPattern(data.accessValue)})</span>
            </p>
          ) : data.accessValue ? (
            <p className="mt-1">Clave: <span className="font-bold">{data.accessValue}</span></p>
          ) : null}
        </div>
      )}

      {/* Falla y diagnóstico */}
      <div className="mb-2 space-y-1">
        <div>
          <h3 className="text-[10px] font-bold uppercase text-gray-600">Falla reportada</h3>
          <p className="leading-snug">{data.issue}</p>
        </div>
        {data.diagnosis && (
          <div>
            <h3 className="text-[10px] font-bold uppercase text-gray-600">Diagnóstico</h3>
            <p className="leading-snug">{data.diagnosis}</p>
          </div>
        )}
      </div>

      {/* Refacciones compactas */}
      {data.parts.length > 0 && (
        <div className="mb-2">
          <h3 className="text-[10px] font-bold uppercase text-gray-600 mb-0.5">Refacciones</h3>
          <table className="w-full">
            <tbody>
              {data.parts.map((part, idx) => (
                <tr key={idx} className="align-top border-b border-gray-200 last:border-0">
                  <td className="py-0.5 pr-1">
                    {part.description}
                    <span className="block text-[9px] text-gray-500">{part.statusLabel}</span>
                  </td>
                  <td className="py-0.5 text-center whitespace-nowrap">x{part.qty}</td>
                  <td className="py-0.5 text-right whitespace-nowrap">{formatPrice(part.price * part.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* QR de evidencias: lo escanea el técnico para subir fotos del equipo.
          En orden cerrada el enlace ya murió y se imprime solo el aviso. */}
      {evidenceQr ? (
        <div className="text-center mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={evidenceQr} alt="QR para subir fotos del equipo" className="w-24 h-24 mx-auto" />
          <p className="text-[9px] text-gray-600 mt-1 leading-snug">Escanear para subir fotos del equipo</p>
        </div>
      ) : evidenceDisabled ? (
        <p className="mt-3 text-center text-[9px] font-bold uppercase text-red-700">
          Link de evidencias desactivado
        </p>
      ) : null}

      {/* Espacio extra abajo para que la térmica corte bien */}
      <div className="h-8 print:block hidden"></div>
    </div>
  )
}

/* ---------- ETIQUETA 50×30mm (sticker para pegar en el equipo) ---------- */

function EquipmentLabel({ data, evidenceQr, evidenceDisabled }: { data: WorkshopSheetData; evidenceQr: string | null; evidenceDisabled?: boolean }) {
  const brandModel = [equipmentValue(data, "Marca"), equipmentValue(data, "Modelo")].filter(Boolean).join(" ")
  const shortName = data.customerName.trim().split(/\s+/).slice(0, 2).join(" ")
  // Falla reportada, recortada para que quepa en el sticker (~2 líneas a 6pt).
  // label_show_problem=false la omite por completo en la etiqueta.
  const issue = data.issue.trim()
  const issueSnippet = data.labelShowProblem === false
    ? ""
    : issue.length > 80 ? `${issue.slice(0, 80).trimEnd()}…` : issue
  // Clave de desbloqueo para el técnico: el patrón se imprime como puntos 1-9
  // (formatAccessPattern), PIN y contraseña tal como las dictó el cliente.
  // label_show_access=false la omite en la etiqueta (sigue en la hoja interna).
  const accessSnippet = data.labelShowAccess === false
    ? ""
    : data.accessType === "PATTERN" && data.accessValue
      ? `Patrón: ${formatAccessPattern(data.accessValue)}`
      : data.accessValue
        ? `${data.accessTypeLabel ?? "Clave"}: ${data.accessValue}`
        : ""

  return (
    <div className="mx-auto w-fit">
      {/* Borde punteado solo en pantalla: marca la línea de corte */}
      <div className="w-[50mm] min-h-[30mm] max-h-[40mm] overflow-hidden border border-dashed border-gray-400 print:border-0 bg-white text-black p-[1.5mm] flex items-center gap-[1.5mm]">
        {evidenceQr || evidenceDisabled ? (
          <>
            <div className="flex-1 min-w-0 leading-tight">
              <p className="font-bold text-[12pt] leading-none">{data.folio}</p>
              {brandModel && <p className="mt-[0.8mm] text-[6.5pt] truncate">{brandModel}</p>}
              <p className="text-[6.5pt] truncate">{shortName}</p>
              <p className="text-[6pt] text-gray-600">Ing: {shortDate(data.receivedAt)}</p>
              {issueSnippet && <p className="mt-[0.5mm] text-[6pt] leading-snug line-clamp-2">{issueSnippet}</p>}
              {accessSnippet && <p className="mt-[0.3mm] text-[6pt] font-bold leading-snug">{accessSnippet}</p>}
              {/* Orden cerrada: el enlace ya murió — sin QR muerto en el sticker */}
              {!evidenceQr && evidenceDisabled && (
                <p className="mt-[0.5mm] text-[6pt] font-bold uppercase text-red-700">Link desactivado</p>
              )}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {evidenceQr && <img src={evidenceQr} alt="QR para subir fotos del equipo" className="w-[13mm] h-[13mm] shrink-0 self-center" />}
          </>
        ) : (
          // Sin uploadToken no hay enlace que escanear: la etiqueta identifica
          // el equipo por folio, falla y clave de desbloqueo.
          <div className="w-full">
            <p className="text-center font-bold text-[14pt]">{data.folio}</p>
            {issueSnippet && <p className="mt-[0.5mm] text-[6pt] leading-snug line-clamp-2">{issueSnippet}</p>}
            {accessSnippet && <p className="mt-[0.3mm] text-[6pt] font-bold leading-snug">{accessSnippet}</p>}
          </div>
        )}
      </div>
      <p className="mt-2 text-center text-[10px] text-gray-500 print:hidden">Etiqueta 50 × 40 mm — el QR abre la subida de evidencias</p>
    </div>
  )
}

/* ---------- Vista principal con selector de formato ---------- */

export function WorkshopSheetView({ data }: { data: WorkshopSheetData }) {
  const [format, setFormat] = useState<SheetFormat>("sheet")
  const [evidenceQrDataUrl, setEvidenceQrDataUrl] = useState<string | null>(null)

  // El QR de evidencias se imprime en los tres formatos: en la hoja y el
  // térmico lo escanea el técnico; en la etiqueta queda pegado al equipo.
  // Con el link desactivado (orden cerrada) no se genera el QR: imprimirlo
  // solo llevaría a un enlace muerto.
  useEffect(() => {
    const url = data.evidenceLinkDisabled ? undefined : data.evidenceUrl
    if (!url) return
    let cancelled = false
    QRCode.toDataURL(url, { width: 200, margin: 1 })
      .then(d => { if (!cancelled) setEvidenceQrDataUrl(d) })
      .catch(() => { if (!cancelled) setEvidenceQrDataUrl(null) })
    return () => { cancelled = true }
  }, [data.evidenceUrl, data.evidenceLinkDisabled])

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
    <div className="min-h-screen bg-neutral-100 dark:bg-neutral-900 p-4 sm:p-8 font-mono print:p-0">
      {/* Tamaño de página según el formato seleccionado */}
      {PAGE_CSS[format] && <style>{PAGE_CSS[format]}</style>}

      {/* Controles NO imprimibles */}
      <div className="max-w-xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden bg-background p-4 rounded-xl shadow-sm">
        <Button variant="outline" size="sm" onClick={goBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Volver
        </Button>
        {/* Selector segmentado de formato de impresión */}
        <div className="flex overflow-hidden rounded-md border text-xs" role="group" aria-label="Formato de impresión">
          {FORMAT_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFormat(option.value)}
              aria-pressed={format === option.value}
              className={cn(
                "px-3 py-2 min-h-[36px] transition-colors",
                format === option.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="w-4 h-4 mr-2" />
          Imprimir
        </Button>
      </div>

      {format === "sheet" && <FullSheet data={data} evidenceQr={data.evidenceLinkDisabled ? null : evidenceQrDataUrl} evidenceDisabled={data.evidenceLinkDisabled} />}
      {format === "thermal" && <ThermalSheet data={data} evidenceQr={data.evidenceLinkDisabled ? null : evidenceQrDataUrl} evidenceDisabled={data.evidenceLinkDisabled} />}
      {format === "label" && <EquipmentLabel data={data} evidenceQr={data.evidenceLinkDisabled ? null : evidenceQrDataUrl} evidenceDisabled={data.evidenceLinkDisabled} />}
    </div>
  )
}
