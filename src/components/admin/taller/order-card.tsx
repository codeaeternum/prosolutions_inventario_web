"use client"

import type { DragEvent } from "react"
import { CalendarClock, ChevronRight, MapPin, MessageCircle, Store } from "lucide-react"
import { hasWhatsAppPhone } from "@/lib/whatsapp"
import { formatCents, formatDate } from "@/lib/utils"
import { repairFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import type { SlaHours } from "@/lib/workshop-config"
import { orderBalanceCents as balanceOf, type PartLike } from "@/lib/workshop-money"
import { SemaforoBadge } from "@/components/admin/taller/semaforo"
import type { WorkshopPayment } from "@/components/admin/taller/payments-panel"

/** Lo mínimo que necesitan la tarjeta del tablero y la fila de la lista: la
 *  Order completa de /admin/taller lo satisface por tipado estructural, sin
 *  conversión. Los campos de dinero (quoteCents…parts) no se muestran pero el
 *  chip de adeudo los necesita: delega en orderBalanceCents de payments-panel.
 *  updatedAt es opcional: el semáforo lo usa como último movimiento y cae a
 *  createdAt cuando la lista no lo trae. */
export type BoardCardOrder = {
  id: string
  number: number
  folio?: string
  status: RepairStage
  // Concurrencia optimista del PATCH de etapa — el drag & drop del tablero
  // lo embarca en el payload del arrastre (expectedVersion).
  version: number
  equipmentType: string
  brand: string | null
  model: string | null
  customerName: string
  customerPhone: string
  currentBranch: { id: string; name: string }
  assignedTo: { id: string; name: string } | null
  promisedAt: string | null
  scheduledAt: string | null
  location: string | null
  createdAt: string
  updatedAt?: string | null
  // Origen aliado (tenant ligado o nombre de mostrador) — la vista de lista
  // lo muestra como chip para distinguir captaciones.
  originBusiness?: { id: string; name: string } | null
  originBusinessName?: string | null
  quoteCents: number | null
  approvedQuoteCents: number | null
  diagnosticFeeCents?: number | null
  closedWithoutRepair?: boolean | null
  payments?: WorkshopPayment[]
  parts?: PartLike[]
}

// El API ya manda el folio formateado con los dígitos configurados del
// negocio (order_folio_digits); repairFolio queda como respaldo de 6 dígitos.
export const folioOf = (order: { folio?: string; number: number }) => order.folio ?? repairFolio(order.number)

// Formatos compartidos de utils: money llega en CENTAVOS (api) y date es la
// fecha+hora legible estándar del panel.
export const money = formatCents
export const date = (value: string) => formatDate(value)

// Cierres definitivos para la promesa: una orden entregada o cancelada ya no
// compite contra su fecha prometida (mismo criterio que la vista "Atrasadas").
export const terminalStages: readonly RepairStage[] = ["DELIVERED", "CANCELLED"]

export const isOverdue = (order: BoardCardOrder) =>
  order.promisedAt !== null && new Date(order.promisedAt).getTime() < Date.now() && !terminalStages.includes(order.status)

export const isScheduledToday = (order: BoardCardOrder) => {
  if (!order.scheduledAt) return false
  const scheduled = new Date(order.scheduledAt)
  const now = new Date()
  return scheduled.getFullYear() === now.getFullYear() && scheduled.getMonth() === now.getMonth() && scheduled.getDate() === now.getDate()
}

/** Colores por etapa: `dot` para el encabezado de columna del kanban y
 *  `badge` para el chip de etapa en tarjetas y filas. */
export const stageStyles: Record<RepairStage, { dot: string; badge: string }> = {
  RECEIVED: { dot: "bg-sky-500", badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  DIAGNOSIS: { dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  WAITING_APPROVAL: { dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  WAITING_PARTS: { dot: "bg-orange-500", badge: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  IN_REPAIR: { dot: "bg-blue-600", badge: "bg-blue-600/10 text-blue-700 dark:text-blue-300" },
  QUALITY_CHECK: { dot: "bg-teal-500", badge: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
  READY: { dot: "bg-emerald-500", badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  DELIVERED: { dot: "bg-zinc-400", badge: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" },
  CANCELLED: { dot: "bg-rose-400", badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  NOT_REPAIRED: { dot: "bg-red-500", badge: "bg-red-500/10 text-red-700 dark:text-red-300" },
  NOT_AUTHORIZED: { dot: "bg-pink-500", badge: "bg-pink-500/10 text-pink-700 dark:text-pink-300" },
  EXTERNAL_LAB: { dot: "bg-indigo-500", badge: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  WARRANTY: { dot: "bg-cyan-500", badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
}

/** Estilo de la columna "Cerradas" del tablero (mezcla etapas terminales). */
export const closedColumnStyle = { dot: "bg-zinc-400", badge: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400" }

/** Fecha promesa compacta; se pinta en ámbar con "· Atrasada" cuando venció. */
export function PromisedAt({ order }: { order: BoardCardOrder }) {
  if (!order.promisedAt) return null
  const overdue = isOverdue(order)
  return <span className={`flex items-center gap-1 ${overdue ? "font-medium text-amber-600 dark:text-amber-400" : ""}`}><CalendarClock size={12} />{date(order.promisedAt)}{overdue ? " · Atrasada" : ""}</span>
}

/** Props compartidas por la tarjeta del kanban y la fila de la lista. Los
 *  callbacks van como métodos (sintaxis corta): así aceptan handlers tipados
 *  con la Order completa de la página — bivariante, seguro porque la Order
 *  siempre satisface BoardCardOrder. */
export type OrderCardProps = {
  order: BoardCardOrder
  /** SLA por etapa (ajuste workshop_sla_hours); lo consume SemaforoBadge. */
  slaHours: SlaHours
  /** Muestra el chip de etapa (columna "Cerradas" y vista de lista mezclada). */
  showStage?: boolean
  /** Muestra la sucursal actual (vista multi-sucursal). */
  showBranch?: boolean
  /** Activa el arrastre HTML5 de la tarjeta (tablero por fases). */
  draggable?: boolean
  /** La tarjeta es la que está en arrastre (se atenúa en su columna origen). */
  dragging?: boolean
  onDragStart?(event: DragEvent<HTMLElement>): void
  onDragEnd?(): void
  onOpen(id: string): void
  onAvisar(order: BoardCardOrder): void
}

const equipoTexto = (order: BoardCardOrder) => [order.equipmentType, order.brand, order.model].filter(Boolean).join(" · ")

// "Avisar" en un toque: solo cuando hay algo accionable por WhatsApp — el
// equipo está listo o la cotización espera autorización — y hay teléfono.
const puedeAvisar = (order: BoardCardOrder) =>
  (order.status === "READY" || order.status === "WAITING_APPROVAL") && hasWhatsAppPhone(order.customerPhone)

/** Overlay hermano del botón-tarjeta (botón dentro de botón no es HTML
 *  válido); `className` fija la posición según el contexto (esquina de la
 *  tarjeta o junto al chevron de la fila). */
function AvisarOverlay({ order, onAvisar, className }: { order: BoardCardOrder; onAvisar: (order: BoardCardOrder) => void; className: string }) {
  return <button
    type="button"
    title={`Avisar a ${order.customerName} por WhatsApp`}
    aria-label={`Avisar a ${order.customerName} por WhatsApp`}
    onClick={event => {
      event.stopPropagation()
      onAvisar(order)
    }}
    className={`absolute flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 transition hover:bg-emerald-500/25 dark:text-emerald-300 ${className}`}
  >
    <MessageCircle size={14} />
  </button>
}

const orderBalanceCents = (order: BoardCardOrder) => balanceOf(order, order.parts ?? [], order.payments ?? [])

function DebtChip({ order }: { order: BoardCardOrder }) {
  const balanceCents = orderBalanceCents(order)
  if (balanceCents <= 0) return null
  return <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">Adeudo {money(balanceCents)}</span>
}

function TodayChip({ order }: { order: BoardCardOrder }) {
  if (!isScheduledToday(order)) return null
  return <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">Hoy</span>
}

/** Tarjeta compacta del kanban: folio + semáforo, equipo, cliente·técnico y
 *  una fila de chips solo cuando hay promesa, adeudo, entrega de hoy o
 *  ubicación. La tarjeta entera es el botón que abre el detalle. */
export function BoardOrderCard({ order, slaHours, showStage = false, showBranch = false, draggable = false, dragging = false, onDragStart, onDragEnd, onOpen, onAvisar }: OrderCardProps) {
  const avisar = puedeAvisar(order)
  const hasChips = Boolean(order.promisedAt) || orderBalanceCents(order) > 0 || isScheduledToday(order) || Boolean(order.location)
  return <div
    className={`relative ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${dragging ? "opacity-40" : ""}`}
    draggable={draggable}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
  >
    <button
      onClick={() => onOpen(order.id)}
      className="w-full space-y-1 rounded-lg border bg-card p-2.5 text-left text-sm transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
    >
      {/* pr-8 deja libre la esquina cuando el overlay "Avisar" la ocupa. */}
      <p className={`flex items-center justify-between gap-2 ${avisar ? "pr-8" : ""}`}>
        <strong className="truncate text-[11px] font-medium text-muted-foreground">{folioOf(order)}</strong>
        <span className="flex shrink-0 items-center gap-2 text-[11px]">
          <SemaforoBadge order={order} slaHours={slaHours} />
          {showStage && <span className={`rounded-full px-2 py-0.5 font-medium ${stageStyles[order.status].badge}`}>{repairLabels[order.status]}</span>}
        </span>
      </p>
      <p className="truncate font-medium leading-snug">{equipoTexto(order)}</p>
      <p className="truncate text-xs text-muted-foreground">
        {order.customerName} · {order.assignedTo?.name ?? "Sin asignar"}
        {showBranch && <> · <MapPin size={11} className="inline-block align-middle" /> {order.currentBranch.name}</>}
      </p>
      {(hasChips || order.originBusiness || order.originBusinessName) && <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5 text-xs text-muted-foreground">
        <PromisedAt order={order} />
        <DebtChip order={order} />
        <TodayChip order={order} />
        {order.location && <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"><MapPin size={11} />{order.location}</span>}
        {(order.originBusiness || order.originBusinessName) && (
          <span className="flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
            <Store size={11} />
            {order.originBusiness?.name ?? order.originBusinessName}
          </span>
        )}
      </div>}
    </button>
    {avisar && <AvisarOverlay order={order} onAvisar={onAvisar} className="right-2 top-2" />}
  </div>
}

/** Fila densa para la vista de lista: una línea por orden. Los chips
 *  secundarios (promesa, adeudo, "Hoy" y semáforo) se ocultan en móvil — el
 *  badge de etapa y el chevron siempre quedan. */
export function OrderListRow({ order, slaHours, showStage = true, showBranch = false, onOpen, onAvisar }: OrderCardProps) {
  const avisar = puedeAvisar(order)
  return <div className="relative">
    <button
      onClick={() => onOpen(order.id)}
      className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span className="w-24 truncate text-xs font-medium text-muted-foreground">{folioOf(order)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{equipoTexto(order)}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {order.customerName} · {order.assignedTo?.name ?? "Sin asignar"}
          {showBranch && <> · <MapPin size={11} className="inline-block align-middle" /> {order.currentBranch.name}</>}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex">
          {(order.originBusiness || order.originBusinessName) && (
            <span className="flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 font-medium text-indigo-700 dark:text-indigo-300">
              <Store size={11} />
              {order.originBusiness?.name ?? order.originBusinessName}
            </span>
          )}
          <PromisedAt order={order} />
          <DebtChip order={order} />
          <TodayChip order={order} />
        </span>
        <SemaforoBadge order={order} slaHours={slaHours} className="hidden text-xs sm:inline-flex" />
        {showStage && <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stageStyles[order.status].badge}`}>{repairLabels[order.status]}</span>}
        {/* Hueco del overlay "Avisar": el botón flota a la izquierda del chevron. */}
        {avisar && <span aria-hidden className="w-7 shrink-0" />}
        <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
      </span>
    </button>
    {avisar && <AvisarOverlay order={order} onAvisar={onAvisar} className="right-10 top-1/2 -translate-y-1/2" />}
  </div>
}
