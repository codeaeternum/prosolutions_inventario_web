"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/admin/empty-state"
import {
  ArrowLeft,
  CalendarCheck,
  CreditCard,
  Loader2,
  Mail,
  Phone,
  Send,
  ShoppingBag,
  Store,
  UserRound,
  Wrench,
} from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"

interface Cliente {
  id: string
  name: string
  email: string | null
  phone: string | null
  telegramId: string | null
  businessName: string | null
  customerType: "TECHNICIAN" | "STORE" | "NORMAL"
  status: string
  creditLimit: number | null
  creditBalance: number
  totalPurchases: number
  createdAt: string
}

interface Kpis {
  totalGastado: number
  ventas: number
  reparaciones: number
  reservas: number
  movimientosCredito: number
  ultimaActividad: string | null
}

type EventKind = "repair" | "sale" | "credit" | "reservation"

interface TimelineEvent {
  kind: EventKind
  id: string
  folio: string
  fecha: string
  descripcion: string
  monto: number | null
  status: string
  statusLabel: string
  href: string
}

const KIND_META: Record<EventKind, { label: string; icon: typeof Wrench; classes: string }> = {
  repair: { label: "Taller", icon: Wrench, classes: "bg-blue-500/10 text-blue-600" },
  sale: { label: "Venta", icon: ShoppingBag, classes: "bg-green-500/10 text-green-600" },
  reservation: { label: "Reserva", icon: CalendarCheck, classes: "bg-amber-500/10 text-amber-600" },
  credit: { label: "Crédito", icon: CreditCard, classes: "bg-purple-500/10 text-purple-600" },
}

const FILTERS: { value: "ALL" | EventKind; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "repair", label: "Taller" },
  { value: "sale", label: "Ventas" },
  { value: "reservation", label: "Reservas" },
  { value: "credit", label: "Crédito" },
]

type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "success" | "warning"

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  // Taller
  RECEIVED: "secondary", DIAGNOSIS: "secondary", WAITING_APPROVAL: "warning",
  WAITING_PARTS: "warning", IN_REPAIR: "secondary", QUALITY_CHECK: "secondary",
  EXTERNAL_LAB: "outline", READY: "success", DELIVERED: "default", WARRANTY: "secondary",
  CANCELLED: "destructive", NOT_REPAIRED: "destructive", NOT_AUTHORIZED: "destructive",
  // Ventas / reservas
  COMPLETED: "success", VOIDED: "destructive", PENDING: "outline",
  PENDING_PAYMENT: "warning", DEPOSIT_VERIFIED: "secondary", APPROVED: "secondary",
  REJECTED: "destructive", EXPIRED: "destructive",
  // Crédito
  DEBT: "destructive", PAYMENT: "success", REVERSAL: "secondary",
}

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`
}

function TypeBadge({ type }: { type: Cliente["customerType"] }) {
  if (type === "STORE") {
    return <Badge variant="secondary"><Store className="mr-1 h-3 w-3" />Mayoreo</Badge>
  }
  if (type === "TECHNICIAN") {
    return <Badge variant="secondary"><Wrench className="mr-1 h-3 w-3" />Técnico</Badge>
  }
  return <Badge variant="outline"><ShoppingBag className="mr-1 h-3 w-3" />Menudeo</Badge>
}

function montoText(e: TimelineEvent): { text: string; className: string } | null {
  if (e.monto == null) return null
  if (e.kind === "credit") {
    const sign = e.monto >= 0 ? "+" : "−"
    return {
      text: `${sign}${formatPrice(Math.abs(e.monto))}`,
      className: e.monto >= 0 ? "text-destructive" : "text-green-600",
    }
  }
  return { text: formatPrice(e.monto), className: "text-foreground" }
}

export default function Cliente360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [eventos, setEventos] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [filter, setFilter] = useState<"ALL" | EventKind>("ALL")

  useEffect(() => {
    const controller = new AbortController()
    const idTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clientes/${id}`, { signal: controller.signal })
        if (res.status === 404) { setNotFound(true); return }
        if (!res.ok) throw new Error("Error al cargar el cliente")
        const data = await res.json()
        if (controller.signal.aborted) return
        setCliente(data.cliente)
        setKpis(data.kpis)
        setEventos(data.eventos ?? [])
      } catch (error) {
        if (!controller.signal.aborted) console.error("Error cargando cliente 360:", error)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 0)
    return () => { clearTimeout(idTimer); controller.abort() }
  }, [id])

  const filtered = filter === "ALL" ? eventos : eventos.filter((e) => e.kind === filter)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (notFound || !cliente || !kpis) {
    return (
      <EmptyState
        icon={UserRound}
        title="Cliente no encontrado"
        description="El cliente no existe en este negocio o fue eliminado."
        action={{ label: "Volver a clientes", href: "/admin/clientes", icon: ArrowLeft }}
      />
    )
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
            <Link href="/admin/clientes"><ArrowLeft className="mr-1 h-4 w-4" />Clientes</Link>
          </Button>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
            {cliente.name}
            <TypeBadge type={cliente.customerType} />
            {cliente.status !== "APPROVED" && <Badge variant="outline">Sin aprobar</Badge>}
          </h2>
          <p className="text-muted-foreground">Cliente desde {formatDate(cliente.createdAt)}</p>
        </div>
        {cliente.creditLimit != null || cliente.creditBalance > 0 ? (
          <Card className="sm:min-w-[260px]">
            <CardContent className="p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Saldo de crédito</p>
                <p className={`text-2xl font-bold ${cliente.creditBalance > 0 ? "text-destructive" : ""}`}>
                  {formatPrice(cliente.creditBalance)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cliente.creditLimit != null ? `de ${formatPrice(cliente.creditLimit)} límite` : "sin límite"}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/credito">Cartera</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Contacto */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {cliente.businessName && (
          <span className="inline-flex items-center gap-2 font-medium">
            <Store className="h-4 w-4 text-muted-foreground" />{cliente.businessName}
          </span>
        )}
        {cliente.phone ? (
          <a href={waLink(cliente.phone)} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 text-green-600 hover:underline">
            <Phone className="h-4 w-4" />{cliente.phone}
          </a>
        ) : (
          <span className="inline-flex items-center gap-2 text-muted-foreground italic">
            <Phone className="h-4 w-4" />Sin teléfono
          </span>
        )}
        {cliente.email && (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Mail className="h-4 w-4" />{cliente.email}
          </span>
        )}
        {cliente.telegramId && (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Send className="h-4 w-4" />Telegram
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Total gastado</p>
            <p className="text-2xl font-bold mt-1">{formatPrice(kpis.totalGastado)}</p>
            <p className="text-xs text-muted-foreground">ventas + pagos de taller</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Reparaciones</p>
            <p className="text-2xl font-bold mt-1">{kpis.reparaciones}</p>
            <p className="text-xs text-muted-foreground">órdenes de taller</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Ventas</p>
            <p className="text-2xl font-bold mt-1">{kpis.ventas}</p>
            <p className="text-xs text-muted-foreground">{kpis.reservas} reservas · {kpis.movimientosCredito} movs. crédito</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Última actividad</p>
            <p className="text-lg font-bold mt-1 leading-7">
              {kpis.ultimaActividad ? formatDate(kpis.ultimaActividad) : "Sin actividad"}
            </p>
            <p className="text-xs text-muted-foreground">en cualquier módulo</p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold">Historial del cliente</h3>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por tipo de evento">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filter === f.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title={filter === "ALL" ? "Sin actividad registrada" : `Sin eventos de tipo ${FILTERS.find((f) => f.value === filter)?.label}`}
            description={
              filter === "ALL"
                ? "Este cliente aún no tiene ventas, reservas, crédito ni órdenes de taller."
                : "Prueba con otro filtro."
            }
          />
        ) : (
          <ol className="relative border-l border-muted ml-3 space-y-1">
            {filtered.map((e) => {
              const meta = KIND_META[e.kind]
              const Icon = meta.icon
              const monto = montoText(e)
              const isTicket = e.href.startsWith("/admin/tickets/")
              const content = (
                <>
                  <span className={`absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full border bg-background ${meta.classes}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold text-sm group-hover:underline">{e.folio}</span>
                    <Badge variant={STATUS_VARIANT[e.status] ?? "outline"}>{e.statusLabel}</Badge>
                    <span className="text-xs text-muted-foreground">{meta.label}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{formatDate(e.fecha)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{e.descripcion}</p>
                  {monto && <p className={`text-sm font-semibold mt-0.5 ${monto.className}`}>{monto.text}</p>}
                </>
              )
              return (
                <li key={`${e.kind}-${e.id}`} className="ml-8 pb-5">
                  {isTicket ? (
                    <a href={e.href} target="_blank" rel="noopener noreferrer" className="group block">
                      {content}
                    </a>
                  ) : (
                    <Link href={e.href} className="group block">
                      {content}
                    </Link>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
