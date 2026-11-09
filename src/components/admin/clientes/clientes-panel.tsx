"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Pagination } from "@/components/ui/pagination"
import { EmptyState } from "@/components/admin/empty-state"
import { EstadoCuentaSheet } from "@/components/clientes/estado-cuenta"
import {
  Loader2,
  Users,
  Search,
  Phone,
  Send,
  Store,
  ShoppingBag,
  Wrench,
  CreditCard,
  Mail,
  ChevronRight,
  ArrowUpRight,
  ArrowDownRight,
  History,
  Eye,
  FileText,
  MessageCircle,
  Pencil,
  Download,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { csvCell } from "@/lib/csv"
import { waLink } from "@/lib/whatsapp"

interface Cliente {
  id: string
  name: string
  email: string | null
  phone: string | null
  telegramId: string | null
  businessName: string | null
  customerType: "TECHNICIAN" | "STORE" | "NORMAL"
  creditLimit: number | null
  creditBalance: number
  totalPurchases: number
  createdAt: string
  reservationsCount: number
  salesCount: number
  repairsCount: number
}

interface ClienteCreditDetail {
  id: string
  name: string
  email: string | null
  creditLimit: number | null
  creditBalance: number | null
  creditMovements: Array<{
    id: string
    amount: number
    type: "DEBT" | "PAYMENT" | "REVERSAL"
    referenceType: string | null
    notes: string | null
    createdAt: string
  }>
}

const creditMovementLabels = { DEBT: "Cargo", PAYMENT: "Abono", REVERSAL: "Reversión de deuda" } as const

const customerTypeLabels: Record<Cliente["customerType"], string> = {
  STORE: "Taller",
  TECHNICIAN: "Técnico",
  NORMAL: "Público",
}

const DEFAULT_LIMIT = 20

function TypeBadge({ type }: { type: Cliente["customerType"] }) {
  if (type === "STORE") {
    return (
      <Badge variant="secondary">
        <Store className="mr-1 h-3 w-3" />
        Taller
      </Badge>
    )
  }
  if (type === "TECHNICIAN") {
    return (
      <Badge variant="secondary">
        <Wrench className="mr-1 h-3 w-3" />
        Técnico
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <ShoppingBag className="mr-1 h-3 w-3" />
      Público
    </Badge>
  )
}

/**
 * Pestaña Clientes del hub: directorio con búsqueda, filtros y ficha rápida.
 * (Antes era toda la página /admin/clientes; la cobranza ahora tiene su
 * propia pestaña y el botón "Cartera de crédito" solo cambia de tab.)
 */
export function ClientesPanel() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const search = searchParams.get("search") ?? ""
  const typeFilter = searchParams.get("customerType") ?? "ALL"
  const conDeuda = searchParams.get("conDeuda") === "true"
  const pageFromUrl = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limitFromUrl = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [clientes, setClientes] = useState<Cliente[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Detail sheet
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState<Cliente | null>(null)
  const [creditDetail, setCreditDetail] = useState<ClienteCreditDetail | null>(null)
  const [creditLoading, setCreditLoading] = useState(false)
  const [estadoCuentaUserId, setEstadoCuentaUserId] = useState<string | null>(null)

  const fetchClientes = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(false)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (typeFilter !== "ALL") params.set("customerType", typeFilter)
      if (conDeuda) params.set("conDeuda", "true")
      params.set("page", String(pageFromUrl))
      params.set("limit", String(limitFromUrl))

      const res = await fetch(`/api/clientes?${params}`, { signal })
      if (!res.ok) throw new Error("No se pudieron cargar los clientes")
      const data = await res.json()
      if (signal?.aborted) return
      setClientes(data.clientes ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 1)
    } catch (error) {
      if (!signal?.aborted) {
        console.error("Error fetching clientes:", error)
        setLoadError(true)
        toast.error("No se pudieron cargar los clientes. Reintenta en un momento.")
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [search, typeFilter, conDeuda, pageFromUrl, limitFromUrl])

  useEffect(() => {
    const controller = new AbortController()
    // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
    const id = setTimeout(() => void fetchClientes(controller.signal), 0)
    return () => {
      clearTimeout(id)
      controller.abort()
    }
  }, [fetchClientes])

  const updateFilters = (values: { search?: string; customerType?: string; conDeuda?: boolean }) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", "1")
    if (values.search !== undefined) {
      if (values.search.trim()) params.set("search", values.search.trim())
      else params.delete("search")
    }
    if (values.customerType !== undefined) {
      if (values.customerType !== "ALL") params.set("customerType", values.customerType)
      else params.delete("customerType")
    }
    if (values.conDeuda !== undefined) {
      if (values.conDeuda) params.set("conDeuda", "true")
      else params.delete("conDeuda")
    }
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    updateFilters({ search: String(new FormData(e.currentTarget).get("search") ?? "") })
  }

  const handleExportCsv = () => {
    if (clientes.length === 0) return
    const headers = [
      "Nombre",
      "Negocio",
      "Tipo",
      "Teléfono",
      "Correo",
      "Saldo Crédito",
      "Límite Crédito",
      "Ventas",
      "Órdenes Taller",
    ]
    const rows = clientes.map((c) => [
      c.name,
      c.businessName ?? "",
      customerTypeLabels[c.customerType] ?? c.customerType,
      c.phone ?? "",
      c.email ?? "",
      c.creditBalance,
      c.creditLimit ?? "",
      c.salesCount,
      c.repairsCount,
    ])
    const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))]
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const openDetail = async (cliente: Cliente) => {
    setSelected(cliente)
    setCreditDetail(null)
    setDetailOpen(true)
    setCreditLoading(true)
    try {
      const res = await fetch(`/api/credit/users/${cliente.id}`)
      if (res.ok) {
        setCreditDetail(await res.json())
      }
    } catch {
      // El detalle de crédito es complementario; no bloquea la ficha.
    } finally {
      setCreditLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre, teléfono o email..."
              key={search}
              name="search"
              defaultValue={search}
              aria-label="Buscar clientes por nombre, teléfono o email"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={loading} aria-label="Ejecutar búsqueda de clientes">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
          </Button>
        </form>
        <div className="flex gap-2 flex-wrap items-center">
          <Select
            value={typeFilter}
            onValueChange={(value) => updateFilters({ customerType: value })}
          >
            <SelectTrigger
              className="w-full sm:w-[160px]"
              aria-label="Filtrar clientes por tipo"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos los tipos</SelectItem>
              <SelectItem value="NORMAL">Público</SelectItem>
              <SelectItem value="TECHNICIAN">Técnico</SelectItem>
              <SelectItem value="STORE">Taller</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant={conDeuda ? "default" : "outline"}
            size="sm"
            className="h-10 flex-1 sm:flex-initial"
            aria-pressed={conDeuda}
            aria-label="Filtrar clientes con deuda pendiente"
            onClick={() => updateFilters({ conDeuda: !conDeuda })}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Con deuda
          </Button>
          <Button variant="outline" size="sm" className="h-10 flex-1 sm:flex-initial" asChild>
            <Link href="/admin/clientes?tab=cobranza" aria-label="Ir a la pestaña de cartera de crédito">
              <CreditCard className="mr-2 h-4 w-4" />
              Cartera de crédito
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 flex-1 sm:flex-initial"
            disabled={clientes.length === 0}
            aria-label="Exportar clientes a CSV"
            onClick={handleExportCsv}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Clients list (mobile cards + desktop table) */}
      {loading ? (
        <div className="flex items-center justify-center h-64" role="status" aria-label="Cargando clientes">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12 border border-dashed rounded-lg text-center" role="alert">
          <p className="text-sm text-destructive">No se pudieron cargar los clientes.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchClientes()}>
            Reintentar
          </Button>
        </div>
      ) : clientes.length > 0 ? (
        <>
          {/* Vista móvil: tarjetas ergonómicas sin desbordamiento */}
          <div className="grid gap-3 md:hidden">
            {clientes.map((cliente) => (
              <Card key={cliente.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => openDetail(cliente)}
                        aria-label={`Ver detalle de ${cliente.name}`}
                        className="font-semibold text-base text-left truncate block w-full hover:underline"
                      >
                        {cliente.name}
                      </button>
                      {cliente.businessName && (
                        <p className="text-xs text-muted-foreground truncate">
                          {cliente.businessName}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <TypeBadge type={cliente.customerType} />
                    </div>
                  </div>

                  {/* Información de contacto */}
                  <div className="flex flex-col gap-1.5 text-sm min-w-0">
                    {cliente.phone ? (
                      <a
                        href={waLink(cliente.phone)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Contactar por WhatsApp a ${cliente.name} al ${cliente.phone}`}
                        className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400 hover:underline w-fit max-w-full"
                      >
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{cliente.phone}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Sin teléfono</span>
                    )}
                    {cliente.email && (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground min-w-0"
                        title={cliente.email}
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{cliente.email}</span>
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {cliente.telegramId && (
                        <span title="Registrado por Telegram" className="inline-flex items-center gap-1">
                          <Send className="h-3 w-3 shrink-0" /> Telegram
                        </span>
                      )}
                      <span>Alta: {formatDate(cliente.createdAt)}</span>
                    </div>
                  </div>

                  {/* Saldo de crédito y actividad */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground font-medium">Saldo de crédito</p>
                      {cliente.creditLimit != null || cliente.creditBalance > 0 ? (
                        <>
                          <p
                            className={`text-sm truncate ${
                              cliente.creditBalance > 0
                                ? "font-semibold text-destructive"
                                : "font-medium text-foreground"
                            }`}
                          >
                            {formatPrice(cliente.creditBalance)}
                          </p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {cliente.creditLimit != null
                              ? `de ${formatPrice(cliente.creditLimit)}`
                              : "sin límite"}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">Sin crédito</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground font-medium">Actividad</p>
                      <p className="text-xs text-foreground font-medium truncate mt-0.5">
                        {cliente.salesCount} ventas · {cliente.reservationsCount} reservas
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {cliente.repairsCount > 0
                          ? `${cliente.repairsCount} en taller`
                          : `Compras: ${formatPrice(cliente.totalPurchases)}`}
                      </p>
                    </div>
                  </div>

                  {/* Acciones rápidas con etiquetas accesibles */}
                  <div className="flex items-center justify-end gap-1.5 pt-2 border-t flex-wrap">
                    {cliente.phone && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
                        asChild
                      >
                        <a
                          href={waLink(cliente.phone)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Enviar WhatsApp a ${cliente.name}`}
                          title={`Enviar WhatsApp a ${cliente.name}`}
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`Ver estado de cuenta de ${cliente.name}`}
                      title={`Ver estado de cuenta de ${cliente.name}`}
                      onClick={() => setEstadoCuentaUserId(cliente.id)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`Ver detalle de ${cliente.name}`}
                      title={`Ver detalle de ${cliente.name}`}
                      onClick={() => openDetail(cliente)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-9 w-9"
                      asChild
                    >
                      <Link
                        href={`/admin/clientes/${cliente.id}`}
                        aria-label={`Editar cliente ${cliente.name}`}
                        title={`Ver ficha 360 y editar a ${cliente.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Vista escritorio: tabla completa */}
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Contacto</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Crédito</TableHead>
                      <TableHead>Actividad</TableHead>
                      <TableHead>Alta</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clientes.map((cliente) => (
                      <TableRow
                        key={cliente.id}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-label={`Ver detalle de ${cliente.name}`}
                        onClick={() => openDetail(cliente)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            openDetail(cliente)
                          }
                        }}
                      >
                        <TableCell>
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[220px]" title={cliente.name}>
                              {cliente.name}
                            </p>
                            {cliente.businessName && (
                              <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                                {cliente.businessName}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 text-sm">
                            {cliente.phone ? (
                              <a
                                href={waLink(cliente.phone)}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Contactar por WhatsApp a ${cliente.name} al ${cliente.phone}`}
                                className="inline-flex items-center gap-1.5 text-green-600 dark:text-green-400 hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Phone className="h-3.5 w-3.5" />
                                {cliente.phone}
                              </a>
                            ) : (
                              <span className="text-muted-foreground italic">Sin teléfono</span>
                            )}
                            <div className="flex items-center gap-3 text-muted-foreground">
                              {cliente.telegramId && (
                                <span title="Registrado por Telegram" className="inline-flex items-center gap-1 text-xs">
                                  <Send className="h-3 w-3" /> Telegram
                                </span>
                              )}
                              {cliente.email && (
                                <span className="inline-flex items-center gap-1 text-xs truncate max-w-[180px]" title={cliente.email}>
                                  <Mail className="h-3 w-3" /> {cliente.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <TypeBadge type={cliente.customerType} />
                        </TableCell>
                        <TableCell>
                          {cliente.creditLimit != null || cliente.creditBalance > 0 ? (
                            <div className="text-sm">
                              <p className={cliente.creditBalance > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                                {formatPrice(cliente.creditBalance)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {cliente.creditLimit != null
                                  ? `de ${formatPrice(cliente.creditLimit)} límite`
                                  : "sin límite"}
                              </p>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Sin crédito</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-muted-foreground">
                            <p>{cliente.salesCount} ventas · {cliente.reservationsCount} reservas</p>
                            {cliente.repairsCount > 0 && <p>{cliente.repairsCount} en taller</p>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(cliente.createdAt)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center justify-end gap-1">
                            {cliente.phone && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300"
                                asChild
                              >
                                <a
                                  href={waLink(cliente.phone)}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Enviar WhatsApp a ${cliente.name}`}
                                  title={`Enviar WhatsApp a ${cliente.name}`}
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Ver estado de cuenta de ${cliente.name}`}
                              title={`Ver estado de cuenta de ${cliente.name}`}
                              onClick={() => setEstadoCuentaUserId(cliente.id)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Ver detalle de ${cliente.name}`}
                              title={`Ver detalle de ${cliente.name}`}
                              onClick={() => openDetail(cliente)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              asChild
                            >
                              <Link
                                href={`/admin/clientes/${cliente.id}`}
                                aria-label={`Editar cliente ${cliente.name}`}
                                title={`Ver ficha 360 y editar a ${cliente.name}`}
                              >
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <div className="pt-4 border-t">
            <Pagination
              page={pageFromUrl}
              limit={limitFromUrl}
              total={total}
              totalPages={totalPages}
              query={{
                tab: "clientes",
                ...(search ? { search } : {}),
                ...(typeFilter !== "ALL" ? { customerType: typeFilter } : {}),
                ...(conDeuda ? { conDeuda: "true" } : {}),
              }}
            />
          </div>
        </>
      ) : (
        <EmptyState
          icon={Users}
          title="No se encontraron clientes"
          description={
            search || typeFilter !== "ALL" || conDeuda
              ? "Prueba con otros filtros o vuelve a la primera página."
              : isAdmin
                ? "Aún no hay clientes aprobados. Los registros nuevos se aprueban desde Usuarios."
                : "Aún no hay clientes aprobados. Un administrador aprueba los registros nuevos."
          }
          action={
            search || typeFilter !== "ALL" || conDeuda || !isAdmin
              ? undefined
              : { label: "Gestionar usuarios", href: "/admin/equipo?tab=usuarios", icon: Users }
          }
        />
      )}

      {/* Sheet: detalle del cliente */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 flex-wrap">
              {selected?.name ?? "Cliente"}
              {selected && <TypeBadge type={selected.customerType} />}
            </SheetTitle>
            <SheetDescription>
              {selected ? `Cliente desde ${formatDate(selected.createdAt)}` : "Cargando..."}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-6 mt-6">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" asChild className="flex-1 min-w-[140px]">
                  <Link
                    href={`/admin/clientes/${selected.id}`}
                    aria-label={`Ver ficha 360 y editar a ${selected.name}`}
                  >
                    <History className="mr-2 h-4 w-4" />
                    Ver cliente 360
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 min-w-[140px]"
                  aria-label={`Ver estado de cuenta de ${selected.name}`}
                  onClick={() => setEstadoCuentaUserId(selected.id)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Estado de cuenta
                </Button>
              </div>

              {/* Contacto */}
              <div className="p-3 bg-muted rounded-lg space-y-1.5 text-sm min-w-0">
                {selected.businessName && (
                  <p className="font-medium break-words">{selected.businessName}</p>
                )}
                {selected.email && (
                  <p className="flex items-center gap-2 text-muted-foreground min-w-0">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span className="break-all">{selected.email}</span>
                  </p>
                )}
                {selected.phone ? (
                  <a
                    href={waLink(selected.phone)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Contactar por WhatsApp a ${selected.name} al ${selected.phone}`}
                    className="flex items-center gap-2 text-green-600 dark:text-green-400 hover:underline w-fit max-w-full"
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{selected.phone}</span>
                  </a>
                ) : (
                  <p className="flex items-center gap-2 text-muted-foreground italic">
                    <Phone className="h-3.5 w-3.5 shrink-0" /> Sin teléfono
                  </p>
                )}
                {selected.telegramId && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Send className="h-3.5 w-3.5 shrink-0" /> Registrado por Telegram
                  </p>
                )}
              </div>

              {/* Actividad */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 border rounded-lg">
                  <p className="text-xl font-bold">{selected.salesCount}</p>
                  <p className="text-xs text-muted-foreground">Ventas</p>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-xl font-bold">{selected.reservationsCount}</p>
                  <p className="text-xs text-muted-foreground">Reservas</p>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-xl font-bold">{selected.repairsCount}</p>
                  <p className="text-xs text-muted-foreground">Taller</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Compras acumuladas: <span className="font-medium text-foreground">{formatPrice(selected.totalPurchases)}</span>
              </p>

              {/* Crédito */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold flex items-center gap-2">
                    <CreditCard className="h-4 w-4" /> Crédito
                  </h3>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/admin/clientes?tab=cobranza" aria-label="Ir a la pestaña de cartera de cobranza">
                      Ir a cartera
                    </Link>
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-destructive/10 rounded-lg text-center min-w-0">
                    <p className="text-xs text-muted-foreground font-medium">Saldo deudor</p>
                    <p className="text-xl font-bold text-destructive mt-1 truncate">
                      {formatPrice(selected.creditBalance)}
                    </p>
                  </div>
                  <div className="p-4 bg-primary/10 rounded-lg text-center min-w-0">
                    <p className="text-xs text-muted-foreground font-medium">Límite</p>
                    <p className="text-xl font-bold mt-1 truncate">
                      {selected.creditLimit != null ? formatPrice(selected.creditLimit) : "Sin crédito"}
                    </p>
                  </div>
                </div>

                {creditLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : creditDetail && creditDetail.creditMovements.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Últimos movimientos</p>
                    {creditDetail.creditMovements.slice(0, 10).map((mov) => {
                      const isDebt = mov.type === "DEBT"
                      return (
                        <div key={mov.id} className="flex items-center gap-3 p-2 border-b last:border-0">
                          <div className={`p-1.5 rounded-full ${isDebt ? "bg-destructive/10 text-destructive" : "bg-green-500/10 text-green-500 dark:text-green-400"}`}>
                            {isDebt ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                              <p className="text-xs font-medium truncate">
                                {creditMovementLabels[mov.type]}{mov.notes ? ` · ${mov.notes}` : ""}
                              </p>
                              <p className={`text-xs font-bold shrink-0 ${isDebt ? "text-destructive" : "text-green-600 dark:text-green-400"}`}>
                                {isDebt ? "+" : "-"}{formatPrice(mov.amount)}
                              </p>
                            </div>
                            <p className="text-[11px] text-muted-foreground">{formatDate(mov.createdAt)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    Sin movimientos de crédito.
                  </p>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Sheet: estado de cuenta imprimible */}
      <EstadoCuentaSheet
        open={estadoCuentaUserId !== null}
        onOpenChange={(open) => {
          if (!open) setEstadoCuentaUserId(null)
        }}
        userId={estadoCuentaUserId}
      />
    </div>
  )
}
