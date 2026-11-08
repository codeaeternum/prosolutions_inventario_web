"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
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
import { Pagination } from "@/components/ui/pagination"
import { EmptyState } from "@/components/admin/empty-state"
import {
  Loader2,
  Package,
  ClipboardList,
  Globe,
  Store,
  QrCode,
  ChevronRight,
  Search,
  Download,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { csvCell } from "@/lib/csv"

type PedidoTipo = "ENCARGO" | "APARTADO_WEB" | "APARTADO_MOSTRADOR"

interface PedidoRow {
  tipo: PedidoTipo
  id: string
  folio: string | null
  cliente: string | null
  detalle: string
  monto: number | null
  anticipo: number
  status: string
  createdAt: string
  branchId: string | null
  href: string
}

const DEFAULT_LIMIT = 20

const TIPO_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "ENCARGO", label: "Encargos" },
  { value: "APARTADO_WEB", label: "Apartados web" },
  { value: "APARTADO_MOSTRADOR", label: "Apartados mostrador" },
]

const TIPO_BADGE: Record<PedidoTipo, { label: string; variant: "default" | "secondary" | "outline" | "warning" }> = {
  ENCARGO: { label: "Encargo", variant: "warning" },
  APARTADO_WEB: { label: "Apartado web", variant: "secondary" },
  APARTADO_MOSTRADOR: { label: "Apartado mostrador", variant: "outline" },
}

// Union of the statuses of the three sources (encargos, reservas web y
// apartados de mostrador). Label y color se comparten en la tabla.
const STATUS_META: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" }> = {
  PENDING: { label: "Pendiente", variant: "warning" },
  PENDING_PAYMENT: { label: "Pago por validar", variant: "warning" },
  ORDERED: { label: "Pedida", variant: "secondary" },
  READY: { label: "Lista para entregar", variant: "default" },
  DEPOSIT_VERIFIED: { label: "Depósito verificado", variant: "default" },
  APPROVED: { label: "Aprobada", variant: "default" },
  OPEN: { label: "Activo", variant: "warning" },
  DRAFT: { label: "Borrador", variant: "secondary" },
  DELIVERED: { label: "Entregada", variant: "success" },
  COMPLETED: { label: "Completada", variant: "success" },
  CANCELLED: { label: "Cancelada", variant: "destructive" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  EXPIRED: { label: "Expirada", variant: "destructive" },
  VOIDED: { label: "Anulada", variant: "destructive" },
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "Todos los estados" },
  { value: "PENDING", label: "Pendiente" },
  { value: "PENDING_PAYMENT", label: "Pago por validar" },
  { value: "ORDERED", label: "Pedida" },
  { value: "READY", label: "Lista para entregar" },
  { value: "OPEN", label: "Activo (mostrador)" },
  { value: "DEPOSIT_VERIFIED", label: "Depósito verificado" },
  { value: "APPROVED", label: "Aprobada" },
  { value: "DRAFT", label: "Borrador" },
  { value: "DELIVERED", label: "Entregada" },
  { value: "COMPLETED", label: "Completada" },
  { value: "CANCELLED", label: "Cancelada" },
  { value: "REJECTED", label: "Rechazada" },
  { value: "EXPIRED", label: "Expirada" },
  { value: "VOIDED", label: "Anulada" },
]

function TipoBadge({ tipo }: { tipo: PedidoTipo }) {
  const meta = TIPO_BADGE[tipo] ?? { label: tipo, variant: "secondary" as const }
  const Icon = tipo === "ENCARGO" ? ClipboardList : tipo === "APARTADO_WEB" ? Globe : Store
  return (
    <Badge variant={meta.variant} className="whitespace-nowrap">
      <Icon className="mr-1 h-3 w-3" />
      {meta.label}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, variant: "secondary" as const }
  return <Badge variant={meta.variant}>{meta.label}</Badge>
}

/**
 * Pestaña Pedidos del hub: feed unificado de encargos, apartados web y
 * apartados de mostrador (GET /api/pedidos). El clic en la fila lleva al
 * lugar donde se atiende cada tipo.
 */
export function PedidosPanel() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const tipo = searchParams.get("tipo") ?? ""
  const status = searchParams.get("status") ?? "ALL"
  const pageFromUrl = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limitFromUrl = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

  const [rows, setRows] = useState<PedidoRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const fetchPedidos = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (tipo) params.set("tipo", tipo)
      if (status !== "ALL") params.set("status", status)
      params.set("page", String(pageFromUrl))
      params.set("limit", String(limitFromUrl))

      const res = await fetch(`/api/pedidos?${params}`, { signal })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los pedidos")
      if (signal?.aborted) return
      setRows(data.data ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 1)
    } catch (error) {
      if (!signal?.aborted) {
        console.error("Error fetching pedidos:", error)
        const message =
          error instanceof Error && error.message
            ? error.message
            : "No se pudieron cargar los pedidos. Reintenta en un momento."
        setLoadError(message)
        toast.error("No se pudieron cargar los pedidos. Reintenta en un momento.")
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [tipo, status, pageFromUrl, limitFromUrl])

  useEffect(() => {
    const controller = new AbortController()
    // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
    const id = setTimeout(() => void fetchPedidos(controller.signal), 0)
    return () => {
      clearTimeout(id)
      controller.abort()
    }
  }, [fetchPedidos])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        (r.folio ?? "").toLowerCase().includes(q) ||
        (r.cliente ?? "").toLowerCase().includes(q) ||
        r.detalle.toLowerCase().includes(q)
    )
  }, [rows, query])

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return
    const headers = [
      "Tipo",
      "Folio",
      "Cliente",
      "Detalle",
      "Monto",
      "Anticipo",
      "Estado",
      "Fecha",
    ]
    const csvRows = filteredRows.map((r) => [
      TIPO_BADGE[r.tipo]?.label ?? r.tipo,
      r.folio ?? "",
      r.cliente ?? "",
      r.detalle,
      r.monto ?? "",
      r.anticipo,
      STATUS_META[r.status]?.label ?? r.status,
      formatDate(r.createdAt),
    ])
    const lines = [headers.map(csvCell).join(","), ...csvRows.map((r) => r.map(csvCell).join(","))]
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const updateFilters = (values: { tipo?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "pedidos")
    params.set("page", "1")
    if (values.tipo !== undefined) {
      if (values.tipo) params.set("tipo", values.tipo)
      else params.delete("tipo")
    }
    if (values.status !== undefined) {
      if (values.status !== "ALL") params.set("status", values.status)
      else params.delete("status")
    }
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  return (
    <div className="space-y-6">
      {/* Filtros por tipo + buscador + estado + exportación + escáner QR */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          {TIPO_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={tipo === f.value ? "default" : "outline"}
              size="sm"
              className="h-8"
              onClick={() => updateFilters({ tipo: f.value })}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="pedidos-search"
              name="pedidos-search"
              placeholder="Buscar por folio, cliente o detalle..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar pedidos por folio, cliente o detalle"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={status} onValueChange={(value) => updateFilters({ status: value })}>
              <SelectTrigger className="w-full sm:w-[190px]" aria-label="Filtrar pedidos por estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10"
              disabled={filteredRows.length === 0}
              aria-label="Exportar pedidos a CSV"
              onClick={handleExportCsv}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button variant="outline" size="sm" className="h-10" asChild>
              {/* El escáner vive en el POS: reconoce QR de apartados y productos. */}
              <Link href="/admin/ventas?escanear=1">
                <QrCode className="mr-2 h-4 w-4" />
                Escanear
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Banner de error resiliente */}
      {loadError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <div className="flex items-start sm:items-center gap-2.5">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 sm:mt-0" />
            <span>{loadError}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchPedidos()}
            className="shrink-0 self-end sm:self-auto"
          >
            Reintentar
          </Button>
        </div>
      )}

      {/* Listado de pedidos (tarjetas móviles + tabla de escritorio) */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredRows.length > 0 ? (
        <>
          {/* Vista móvil: tarjetas clicables sin scroll horizontal */}
          <div className="grid gap-3 md:hidden">
            {filteredRows.map((row) => (
              <Card
                key={`${row.tipo}:${row.id}`}
                role="button"
                tabIndex={0}
                aria-label={`Abrir pedido ${row.folio ?? row.id}`}
                onClick={() => router.push(row.href)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    router.push(row.href)
                  }
                }}
                className="overflow-hidden cursor-pointer transition-colors hover:bg-muted/40"
              >
                <CardContent className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <TipoBadge tipo={row.tipo} />
                      <span className="font-mono text-xs text-muted-foreground truncate">
                        {row.folio ?? "—"}
                      </span>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>

                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-sm truncate" title={row.cliente ?? undefined}>
                      {row.cliente ?? (
                        <span className="text-muted-foreground italic">Sin cliente</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2" title={row.detalle}>
                      {row.detalle}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t text-xs">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">
                          {row.monto != null ? formatPrice(row.monto) : "—"}
                        </span>
                        {row.anticipo > 0 && (
                          <span className="text-xs text-muted-foreground">
                            Anticipo {formatPrice(row.anticipo)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDate(row.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {row.tipo === "ENCARGO" && row.status === "READY" ? (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/admin/ventas?encargo=${row.id}`}>Cobrar</Link>
                        </Button>
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
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
                      <TableHead>Tipo</TableHead>
                      <TableHead>Folio</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow
                        key={`${row.tipo}:${row.id}`}
                        className="cursor-pointer"
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir pedido ${row.folio ?? row.id}`}
                        onClick={() => router.push(row.href)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            router.push(row.href)
                          }
                        }}
                      >
                        <TableCell>
                          <TipoBadge tipo={row.tipo} />
                        </TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {row.folio ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span className="font-medium truncate max-w-[180px] block" title={row.cliente ?? undefined}>
                            {row.cliente ?? <span className="text-muted-foreground italic">Sin cliente</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground truncate max-w-[260px] block" title={row.detalle}>
                            {row.detalle}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm whitespace-nowrap">
                            <p className="font-medium">{row.monto != null ? formatPrice(row.monto) : "—"}</p>
                            {row.anticipo > 0 && (
                              <p className="text-xs text-muted-foreground">
                                Anticipo {formatPrice(row.anticipo)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(row.createdAt)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {row.tipo === "ENCARGO" && row.status === "READY" ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/admin/ventas?encargo=${row.id}`}>Cobrar</Link>
                            </Button>
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
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
                tab: "pedidos",
                ...(tipo ? { tipo } : {}),
                ...(status !== "ALL" ? { status } : {}),
              }}
            />
          </div>
        </>
      ) : !loadError ? (
        <EmptyState
          icon={Package}
          title="No hay pedidos"
          description={
            tipo || status !== "ALL" || query.trim()
              ? "Ningún pedido coincide con los filtros. Prueba con otro tipo o estado."
              : "Los encargos de mostrador, las reservas del catálogo y los apartados del POS aparecerán aquí."
          }
        />
      ) : null}
    </div>
  )
}
