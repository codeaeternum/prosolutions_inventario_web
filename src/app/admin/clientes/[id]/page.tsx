"use client"

import { use, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/admin/empty-state"
import { AbonarDialog } from "@/components/clientes/abonar-dialog"
import { CargoManualDialog, EditarLimiteDialog } from "@/components/clientes/credito-acciones"
import { EstadoCuentaSheet } from "@/components/clientes/estado-cuenta"
import { creditMovementLabels, type CreditMovementItem } from "@/components/clientes/credit-utils"
import { hasModule } from "@/lib/access"
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  Copy,
  CreditCard,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Send,
  Share2,
  ShoppingBag,
  Store,
  UserRound,
  Wallet,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"

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
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  createdAt: string
}

interface Stats {
  totalPurchased: number
  salesCount: number
  lastPurchaseAt: string | null
  pendingReservations: number
  openRepairs: number
  activeDocuments: number
}

interface SaleRow {
  id: string
  number: number
  status: "DRAFT" | "OPEN" | "COMPLETED" | "VOIDED"
  kind: "RETAIL" | "WORKSHOP" | "LAYAWAY" | "QUOTE"
  total: number
  /** Descuento autorizado al cobrar (centavos); 0/ausente = precio de catálogo. */
  discountCents?: number
  createdAt: string
  branch: string
  itemsCount: number
  itemNames: string[]
}

interface ReservationRow {
  id: string
  quantity: number
  totalPrice: number
  depositAmount: number | null
  depositPaid: boolean
  status: string
  type: "TEMPORARY" | "DEPOSIT"
  expiresAt: string
  createdAt: string
  product: { name: string }
}

interface RepairOrderRow {
  id: string
  number: number
  folio: string
  status: string
  statusLabel: string
  equipment: string
  reportedIssue: string
  total: number | null
  createdAt: string
}

interface DocumentRow {
  id: string
  number: number
  kind: SaleRow["kind"]
  status: "DRAFT" | "OPEN"
  total: number
  expiresAt: string | null
  note: string | null
  createdAt: string
  itemsCount: number
  paid: number
  balance: number
}

interface Cliente360 {
  customer: Cliente
  stats: Stats
  sales: SaleRow[]
  creditMovements: CreditMovementItem[]
  reservations: ReservationRow[]
  repairOrders: RepairOrderRow[]
  documents: DocumentRow[]
}

const saleKindLabels: Record<SaleRow["kind"], string> = {
  RETAIL: "Mostrador",
  WORKSHOP: "A taller",
  LAYAWAY: "Apartado",
  QUOTE: "Cotización",
}

const saleStatusLabels: Record<SaleRow["status"], string> = {
  DRAFT: "Borrador",
  OPEN: "Abierto",
  COMPLETED: "Completada",
  VOIDED: "Anulada",
}

const reservationLabels: Record<string, string> = {
  PENDING: "Pendiente",
  PENDING_PAYMENT: "Esperando pago",
  DEPOSIT_VERIFIED: "Depósito verificado",
  APPROVED: "Lista para recoger",
  REJECTED: "Rechazada",
  COMPLETED: "Entregada",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
}

type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "success" | "warning"

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  // Taller
  RECEIVED: "secondary", DIAGNOSIS: "secondary", WAITING_APPROVAL: "warning",
  WAITING_PARTS: "warning", IN_REPAIR: "secondary", QUALITY_CHECK: "secondary",
  EXTERNAL_LAB: "outline", READY: "success", DELIVERED: "default", WARRANTY: "secondary",
  CANCELLED: "destructive", NOT_REPAIRED: "destructive", NOT_AUTHORIZED: "destructive",
  // Ventas / documentos / reservas
  COMPLETED: "success", VOIDED: "destructive", OPEN: "warning", DRAFT: "outline",
  PENDING: "outline", PENDING_PAYMENT: "warning", DEPOSIT_VERIFIED: "secondary",
  APPROVED: "secondary", REJECTED: "destructive", EXPIRED: "destructive",
  // Crédito
  DEBT: "destructive", PAYMENT: "success", REVERSAL: "secondary",
}

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`
}

function saleFolio(number: number) {
  return `V-${String(number).padStart(6, "0")}`
}

function TypeBadge({ type }: { type: Cliente["customerType"] }) {
  if (type === "STORE") {
    return <Badge variant="secondary"><Store className="mr-1 h-3 w-3" />Taller</Badge>
  }
  if (type === "TECHNICIAN") {
    return <Badge variant="secondary"><Wrench className="mr-1 h-3 w-3" />Técnico</Badge>
  }
  return <Badge variant="outline"><ShoppingBag className="mr-1 h-3 w-3" />Público</Badge>
}

function copyText(value: string, label: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${label} copiado`))
    .catch(() => toast.error(`No se pudo copiar el ${label.toLowerCase()}`))
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-lg">
      {text}
    </p>
  )
}

export default function Cliente360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: session } = useSession()
  const [data, setData] = useState<Cliente360 | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [abonarOpen, setAbonarOpen] = useState(false)
  const [estadoCuentaOpen, setEstadoCuentaOpen] = useState(false)
  const [limiteOpen, setLimiteOpen] = useState(false)
  const [cargoOpen, setCargoOpen] = useState(false)
  const [sharingStatement, setSharingStatement] = useState(false)

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/clientes/${id}`, { signal })
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) throw new Error("Error al cargar el cliente")
      const json: Cliente360 = await res.json()
      if (signal?.aborted) return
      setData(json)
    } catch (error) {
      if (!signal?.aborted) {
        console.error("Error cargando cliente 360:", error)
        toast.error("No se pudo cargar la ficha del cliente")
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    const controller = new AbortController()
    // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
    const timer = setTimeout(() => void fetchData(controller.signal), 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [fetchData])

  // Saldo corrido: creditBalance es el saldo DESPUÉS del movimiento más
  // reciente; se recorre hacia atrás para mostrar el saldo tras cada cargo/abono.
  const movementsWithBalance = useMemo(() => {
    const movs = data?.creditMovements ?? []
    const result: Array<CreditMovementItem & { balanceAfter: number }> = []
    let running = data?.customer.creditBalance ?? 0
    for (const mov of movs) {
      result.push({ ...mov, balanceAfter: running })
      running = mov.type === "DEBT" ? running - mov.amount : running + mov.amount
    }
    return result
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <EmptyState
        icon={UserRound}
        title="Cliente no encontrado"
        description="El cliente no existe en este negocio o fue eliminado."
        action={{ label: "Volver a clientes", href: "/admin/clientes", icon: ArrowLeft }}
      />
    )
  }

  const { customer: cliente, stats, sales, creditMovements, reservations, repairOrders, documents } = data
  const hasCredit = cliente.creditLimit != null || cliente.creditBalance > 0
  // PATCH de límite exige el módulo "credito"; el cargo manual (DEBT) además
  // es solo para ADMIN (permiso "admin" dentro del dominio de crédito).
  const canCredit = !!session?.user && hasModule(session.user, "credito")
  const isAdmin = session?.user?.role === "ADMIN"

  // Link público del estado de cuenta: el POST rota el token (los enlaces
  // enviados antes mueren) y devuelve el path /cuenta/<token>. Con teléfono
  // se abre WhatsApp con el mensaje; sin teléfono queda en el portapapeles.
  async function shareStatement() {
    if (sharingStatement) return
    setSharingStatement(true)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/statement-link`, { method: "POST" })
      const json = (await res.json().catch(() => null)) as
        | { url?: string; businessName?: string; error?: string }
        | null
      if (!res.ok || !json?.url) {
        toast.error(json?.error ?? "No se pudo generar el enlace")
        return
      }
      const url = `${window.location.origin}${json.url}`
      const digits = (cliente.phone ?? "").replace(/\D/g, "")
      if (digits) {
        // wa.me exige formato internacional; los locales de 10 dígitos son MX (+52).
        const intl = digits.length === 10 ? `52${digits}` : digits
        const text = `Hola ${cliente.name}, aquí puedes consultar tu estado de cuenta${json.businessName ? ` en ${json.businessName}` : ""}: ${url}`
        window.open(`https://wa.me/${intl}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer")
      } else {
        await navigator.clipboard.writeText(url)
        toast.success("Enlace del estado de cuenta copiado")
      }
    } catch {
      toast.error("Sin conexión. Intenta de nuevo.")
    } finally {
      setSharingStatement(false)
    }
  }
  const creditUsedPct =
    cliente.creditLimit != null && cliente.creditLimit > 0
      ? Math.min(100, (cliente.creditBalance / cliente.creditLimit) * 100)
      : 0

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* ========== Encabezado ========== */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
            <Link href="/admin/clientes"><ArrowLeft className="mr-1 h-4 w-4" />Clientes</Link>
          </Button>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
            {cliente.name}
            <TypeBadge type={cliente.customerType} />
            {cliente.status !== "APPROVED" && <Badge variant="outline">Sin aprobar</Badge>}
            {cliente.phoneVerifiedAt && (
              <Badge variant="success"><BadgeCheck className="mr-1 h-3 w-3" />Teléfono verificado</Badge>
            )}
            {cliente.emailVerifiedAt && (
              <Badge variant="success"><BadgeCheck className="mr-1 h-3 w-3" />Email verificado</Badge>
            )}
          </h2>
          <p className="text-muted-foreground">Cliente desde {formatDay(cliente.createdAt)}</p>

          {/* Contacto */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm pt-1">
            {cliente.businessName && (
              <span className="inline-flex items-center gap-2 font-medium">
                <Store className="h-4 w-4 text-muted-foreground" />{cliente.businessName}
              </span>
            )}
            {cliente.phone ? (
              <span className="inline-flex items-center gap-1.5">
                <a href={waLink(cliente.phone)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-green-600 hover:underline">
                  <Phone className="h-4 w-4" />{cliente.phone}
                </a>
                <button type="button" aria-label="Copiar teléfono" title="Copiar teléfono"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => copyText(cliente.phone!, "Teléfono")}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-muted-foreground italic">
                <Phone className="h-4 w-4" />Sin teléfono
              </span>
            )}
            {cliente.email && (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Mail className="h-4 w-4" />{cliente.email}
                </span>
                <button type="button" aria-label="Copiar email" title="Copiar email"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => copyText(cliente.email!, "Email")}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            {cliente.telegramId && (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Send className="h-4 w-4" />Telegram
              </span>
            )}
          </div>
        </div>

        {/* Acciones + crédito */}
        <div className="flex flex-col gap-3 sm:min-w-[300px]">
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/admin/ventas?cliente=${cliente.id}`}>
                <Plus className="mr-2 h-4 w-4" />Nueva venta
              </Link>
            </Button>
            {canCredit && (
              <Button variant="outline" onClick={() => setEstadoCuentaOpen(true)}>
                <FileText className="mr-2 h-4 w-4" />Estado de cuenta
              </Button>
            )}
            {canCredit && (
              <Button
                variant="outline"
                className="text-green-700 border-green-600/40 hover:bg-green-600/10"
                onClick={() => setAbonarOpen(true)}
              >
                <Wallet className="mr-2 h-4 w-4" />Abonar
              </Button>
            )}
          </div>
          {hasCredit && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Saldo de crédito</p>
                    <p className={`text-2xl font-bold ${cliente.creditBalance > 0 ? "text-destructive" : "text-green-600"}`}>
                      {formatPrice(cliente.creditBalance)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground text-right">
                    {cliente.creditLimit != null
                      ? `Límite ${formatPrice(cliente.creditLimit)}`
                      : "Sin límite"}
                  </p>
                </div>
                {cliente.creditLimit != null && cliente.creditLimit > 0 && (
                  <div>
                    <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${creditUsedPct > 90 ? "bg-destructive" : creditUsedPct > 75 ? "bg-yellow-500" : "bg-primary"}`}
                        style={{ width: `${creditUsedPct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {Math.round(creditUsedPct)}% del límite usado
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ========== KPIs ========== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Total comprado</p>
            <p className="text-2xl font-bold mt-1">{formatPrice(stats.totalPurchased)}</p>
            <p className="text-xs text-muted-foreground">ventas + pagos de taller</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Compras</p>
            <p className="text-2xl font-bold mt-1">{stats.salesCount}</p>
            <p className="text-xs text-muted-foreground">ventas completadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Última compra</p>
            <p className="text-lg font-bold mt-1 leading-7">
              {stats.lastPurchaseAt ? formatDay(stats.lastPurchaseAt) : "Sin compras"}
            </p>
            <p className="text-xs text-muted-foreground">venta más reciente</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Apartados activos</p>
            <p className="text-2xl font-bold mt-1">{stats.activeDocuments}</p>
            <p className="text-xs text-muted-foreground">{stats.pendingReservations} reservas pendientes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Reparaciones abiertas</p>
            <p className="text-2xl font-bold mt-1">{stats.openRepairs}</p>
            <p className="text-xs text-muted-foreground">{repairOrders.length} órdenes en total</p>
          </CardContent>
        </Card>
      </div>

      {/* ========== Secciones ========== */}
      <Tabs defaultValue="compras">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="compras"><ShoppingBag className="h-4 w-4" />Compras ({sales.length})</TabsTrigger>
          <TabsTrigger value="credito"><CreditCard className="h-4 w-4" />Crédito ({creditMovements.length})</TabsTrigger>
          <TabsTrigger value="apartados"><CalendarCheck className="h-4 w-4" />Apartados ({documents.length + reservations.length})</TabsTrigger>
          <TabsTrigger value="taller"><Wrench className="h-4 w-4" />Taller ({repairOrders.length})</TabsTrigger>
        </TabsList>

        {/* ---------- Compras ---------- */}
        <TabsContent value="compras" className="mt-4">
          {sales.length === 0 ? (
            <Empty text="Este cliente aún no tiene ventas registradas." />
          ) : (
            <div className="space-y-2">
              {sales.map((sale) => (
                <a
                  key={sale.id}
                  href={`/admin/tickets/venta/${sale.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 border rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <span className="font-semibold text-sm group-hover:underline">{saleFolio(sale.number)}</span>
                  <Badge variant={STATUS_VARIANT[sale.status] ?? "outline"}>{saleStatusLabels[sale.status]}</Badge>
                  <Badge variant="outline">{saleKindLabels[sale.kind]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {sale.itemsCount} producto{sale.itemsCount === 1 ? "" : "s"} · {sale.branch}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">{formatDate(sale.createdAt)}</span>
                  <span className="text-sm font-bold w-full sm:w-auto sm:text-right">
                    {(sale.discountCents ?? 0) > 0 && (
                      <span className="mr-1.5 font-normal text-xs text-muted-foreground line-through">{formatPrice(sale.total)}</span>
                    )}
                    {formatPrice(sale.total - (sale.discountCents ?? 0) / 100)}
                  </span>
                  {sale.itemNames.length > 0 && (
                    <p className="w-full text-xs text-muted-foreground line-clamp-1">
                      {sale.itemNames.join(" · ")}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---------- Crédito ---------- */}
        <TabsContent value="credito" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {canCredit && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => setAbonarOpen(true)}>
                <Wallet className="mr-2 h-4 w-4" />Abonar
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setCargoOpen(true)}>
                <ArrowUpRight className="mr-2 h-4 w-4" />Cargo manual
              </Button>
            )}
            {canCredit && (
              <Button size="sm" variant="outline" onClick={() => setLimiteOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />Editar límite
              </Button>
            )}
            {canCredit && (
              <Button size="sm" variant="outline" onClick={() => setEstadoCuentaOpen(true)}>
                <FileText className="mr-2 h-4 w-4" />Estado de cuenta
              </Button>
            )}
            {canCredit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void shareStatement()}
                disabled={sharingStatement}
                title="Genera un link público (vigente 30 días) para enviarlo por WhatsApp"
              >
                {sharingStatement ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="mr-2 h-4 w-4" />
                )}
                Compartir estado de cuenta
              </Button>
            )}
          </div>
          {movementsWithBalance.length === 0 ? (
            <Empty text="Sin movimientos de crédito." />
          ) : (
            <ol className="relative border-l border-muted ml-3 space-y-1">
              {movementsWithBalance.map((mov) => {
                const isDebt = mov.type === "DEBT"
                return (
                  <li key={mov.id} className="ml-8 pb-5">
                    <span
                      className={`absolute -left-4 flex h-8 w-8 items-center justify-center rounded-full border bg-background ${
                        isDebt ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-600"
                      }`}
                    >
                      {isDebt ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold text-sm">{creditMovementLabels[mov.type]}</span>
                      <Badge variant={STATUS_VARIANT[mov.type] ?? "outline"}>{mov.type}</Badge>
                      {mov.type === "PAYMENT" && (
                        <a
                          href={`/admin/tickets/abono/${mov.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-500 hover:underline"
                        >
                          Ver ticket
                        </a>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">{formatDate(mov.createdAt)}</span>
                    </div>
                    {mov.notes && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{mov.notes}</p>}
                    <p className="text-sm mt-0.5">
                      <span className={`font-semibold ${isDebt ? "text-destructive" : "text-green-600"}`}>
                        {isDebt ? "+" : "−"}{formatPrice(mov.amount)}
                      </span>
                      <span className="text-xs text-muted-foreground"> · saldo: {formatPrice(mov.balanceAfter)}</span>
                    </p>
                  </li>
                )
              })}
            </ol>
          )}
        </TabsContent>

        {/* ---------- Apartados ---------- */}
        <TabsContent value="apartados" className="mt-4 space-y-6">
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Documentos abiertos</h3>
            {documents.length === 0 ? (
              <Empty text="Sin apartados ni cotizaciones abiertas." />
            ) : (
              documents.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 border rounded-lg">
                  <span className="font-semibold text-sm">{saleFolio(doc.number)}</span>
                  <Badge variant={STATUS_VARIANT[doc.status] ?? "outline"}>{saleStatusLabels[doc.status]}</Badge>
                  <Badge variant="outline">{saleKindLabels[doc.kind]}</Badge>
                  <span className="text-xs text-muted-foreground">{doc.itemsCount} productos</span>
                  {doc.expiresAt && (
                    <span className="text-xs text-muted-foreground">vence {formatDay(doc.expiresAt)}</span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">{formatDate(doc.createdAt)}</span>
                  <div className="w-full flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Total {formatPrice(doc.total)} · abonado{" "}
                      <span className="text-green-600 font-medium">{formatPrice(doc.paid)}</span> · resta{" "}
                      <span className={doc.balance > 0 ? "text-destructive font-semibold" : "font-medium"}>
                        {formatPrice(doc.balance)}
                      </span>
                    </span>
                    <Button size="sm" variant="outline" asChild className="h-8">
                      <Link href="/admin/ventas">Liquidar en caja</Link>
                    </Button>
                  </div>
                  {doc.note && <p className="w-full text-xs text-muted-foreground italic">{doc.note}</p>}
                </div>
              ))
            )}
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Reservas</h3>
            {reservations.length === 0 ? (
              <Empty text="Sin reservas de productos." />
            ) : (
              reservations.map((res) => (
                <a
                  key={res.id}
                  href={`/admin/tickets/reserva/${res.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 border rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <span className="font-semibold text-sm group-hover:underline">
                    {res.id.slice(-8).toUpperCase()}
                  </span>
                  <Badge variant={STATUS_VARIANT[res.status] ?? "outline"}>
                    {reservationLabels[res.status] ?? res.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {res.quantity} × {res.product.name}
                    {res.type === "DEPOSIT" && (res.depositPaid ? " · anticipo pagado" : " · anticipo pendiente")}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    vence {formatDay(res.expiresAt)}
                  </span>
                  <span className="text-sm font-bold">{formatPrice(res.totalPrice)}</span>
                </a>
              ))
            )}
          </div>
        </TabsContent>

        {/* ---------- Taller ---------- */}
        <TabsContent value="taller" className="mt-4">
          {repairOrders.length === 0 ? (
            <Empty text="Este cliente no tiene órdenes de taller." />
          ) : (
            <div className="space-y-2">
              {repairOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/admin/taller?orden=${order.id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 border rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <span className="font-semibold text-sm group-hover:underline">{order.folio}</span>
                  <Badge variant={STATUS_VARIANT[order.status] ?? "outline"}>{order.statusLabel}</Badge>
                  <span className="text-sm text-muted-foreground truncate max-w-[320px]">
                    {order.equipment} — {order.reportedIssue}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">{formatDate(order.createdAt)}</span>
                  {order.total != null && (
                    <span className="text-sm font-bold">{formatPrice(order.total)}</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ========== Diálogos ========== */}
      <AbonarDialog
        open={abonarOpen}
        onOpenChange={setAbonarOpen}
        user={{ id: cliente.id, name: cliente.name, creditBalance: cliente.creditBalance }}
        onSuccess={() => void fetchData()}
      />
      <EstadoCuentaSheet
        open={estadoCuentaOpen}
        onOpenChange={setEstadoCuentaOpen}
        userId={cliente.id}
      />
      <EditarLimiteDialog
        open={limiteOpen}
        onOpenChange={setLimiteOpen}
        user={{
          id: cliente.id,
          name: cliente.name,
          creditLimit: cliente.creditLimit,
          creditBalance: cliente.creditBalance,
        }}
        onSuccess={() => void fetchData()}
      />
      <CargoManualDialog
        open={cargoOpen}
        onOpenChange={setCargoOpen}
        user={{
          id: cliente.id,
          name: cliente.name,
          creditLimit: cliente.creditLimit,
          creditBalance: cliente.creditBalance,
        }}
        onSuccess={() => void fetchData()}
      />
    </div>
  )
}
