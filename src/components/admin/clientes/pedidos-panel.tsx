"use client"

import { useState, useEffect, useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
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
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"

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

  const fetchPedidos = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
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
      {/* Filtros por tipo + estado + escáner QR */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-2 flex-wrap flex-1">
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
        <div className="flex gap-2">
          <Select value={status} onValueChange={(value) => updateFilters({ status: value })}>
            <SelectTrigger className="w-[190px]">
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
          <Button variant="outline" size="sm" className="h-10" asChild>
            {/* El escáner vive en el POS: reconoce QR de apartados y productos. */}
            <Link href="/admin/ventas?escanear=1">
              <QrCode className="mr-2 h-4 w-4" />
              Escanear
            </Link>
          </Button>
        </div>
      </div>

      {/* Tabla de pedidos */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : rows.length > 0 ? (
        <>
          <Card>
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
                    {rows.map((row) => (
                      <TableRow
                        key={`${row.tipo}:${row.id}`}
                        className="cursor-pointer"
                        onClick={() => router.push(row.href)}
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
      ) : (
        <EmptyState
          icon={Package}
          title="No hay pedidos"
          description={
            tipo || status !== "ALL"
              ? "Ningún pedido coincide con los filtros. Prueba con otro tipo o estado."
              : "Los encargos de mostrador, las reservas del catálogo y los apartados del POS aparecerán aquí."
          }
        />
      )}
    </div>
  )
}
