"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Check,
  ClipboardList,
  Loader2,
  PackageCheck,
  Printer,
  X,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/admin/empty-state"
import { MarketplaceFulfillDialog } from "./fulfill-dialog"
import { cn } from "@/lib/utils"

export interface MarketplaceRequest {
  id: string
  qty: number
  tallerName: string
  contactName: string | null
  contactPhone: string | null
  note: string | null
  status: string
  decisionNote: string | null
  createdAt: string
  product: {
    name: string
    barcode: string | null
    wholesalePrice: number
    retailPrice: number
  }
  requestedBy: { id: string; name: string; role: string } | null
  decidedBy: { name: string } | null
  sale: { id: string; number: number } | null
}

type BadgeVariant = "warning" | "success" | "destructive" | "secondary"

const STATUS_META: Record<
  string,
  { label: string; variant?: BadgeVariant; className?: string }
> = {
  PENDING: { label: "Pendiente", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "success" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  FULFILLED: {
    label: "Surtida",
    className:
      "border-transparent bg-violet-600 text-white shadow hover:bg-violet-600/80",
  },
}

const STATUS_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "PENDING", label: "Pendientes" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "FULFILLED", label: "Surtidas" },
] as const

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

interface MarketplaceRequestsPanelProps {
  isAdmin: boolean
  // Cuenta WORKSHOP: vista del portal del taller — oculta columnas internas
  // (Taller, Solicitó, quién decidió) y muestra hints de qué sigue.
  isWorkshop?: boolean
  refreshKey?: number
  onPendingCount?: (count: number) => void
  // Lleva al tab "Mis compras" (solo portal WORKSHOP).
  onGoToPurchases?: () => void
  formatPrice: (price: number) => string
}

export function MarketplaceRequestsPanel({
  isAdmin,
  isWorkshop = false,
  refreshKey = 0,
  onPendingCount,
  onGoToPurchases,
  formatPrice,
}: MarketplaceRequestsPanelProps) {
  const [requests, setRequests] = useState<MarketplaceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [fulfillTarget, setFulfillTarget] = useState<MarketplaceRequest | null>(null)
  const [fulfillOpen, setFulfillOpen] = useState(false)

  const fetchRequests = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/marketplace/requests", { signal })
      if (!res.ok) throw new Error("No se pudieron cargar las solicitudes")
      const data = await res.json()
      if (signal?.aborted) return
      setRequests(Array.isArray(data.requests) ? data.requests : [])
    } catch {
      if (!signal?.aborted) {
        setLoadError("No se pudieron cargar las solicitudes. Revisa tu conexión y reintenta.")
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => void fetchRequests(controller.signal))
    return () => controller.abort()
  }, [fetchRequests, refreshKey])

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "PENDING").length,
    [requests]
  )

  useEffect(() => {
    onPendingCount?.(pendingCount)
  }, [pendingCount, onPendingCount])

  const displayed =
    statusFilter === "all"
      ? requests
      : requests.filter((r) => r.status === statusFilter)

  const decide = async (
    request: MarketplaceRequest,
    action: "APPROVE" | "REJECT"
  ) => {
    setDecidingId(request.id)
    try {
      const res = await fetch(`/api/marketplace/requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar")
      setRequests((prev) =>
        prev.map((r) => (r.id === request.id ? data.request : r))
      )
      toast.success(
        action === "APPROVE" ? "Solicitud aprobada" : "Solicitud rechazada"
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar")
    } finally {
      setDecidingId(null)
    }
  }

  const openFulfill = (request: MarketplaceRequest) => {
    setFulfillTarget(request)
    setFulfillOpen(true)
  }

  // Tras surtir, el dialog devuelve la solicitud ya ligada a su venta.
  const handleFulfilled = (updated: MarketplaceRequest) => {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  const statusBadge = (request: MarketplaceRequest) => {
    const meta = STATUS_META[request.status] ?? {
      label: request.status,
      variant: "secondary" as const,
    }
    return (
      <div className="space-y-0.5">
        <Badge variant={meta.variant} className={meta.className}>
          {meta.label}
        </Badge>
        {/* Staff: quién decidió. Taller: qué sigue, en su idioma. */}
        {!isWorkshop && request.decidedBy && request.status !== "PENDING" && (
          <p className="text-[11px] text-muted-foreground">
            por {request.decidedBy.name}
          </p>
        )}
        {isWorkshop && request.status === "PENDING" && (
          <p className="text-[11px] text-muted-foreground">
            En revisión por el proveedor
          </p>
        )}
        {isWorkshop && request.status === "APPROVED" && (
          <p className="text-[11px] font-medium text-success">
            El proveedor la surtirá pronto
          </p>
        )}
        {isWorkshop && request.status === "REJECTED" && request.decisionNote && (
          <p
            className="text-[11px] text-muted-foreground truncate max-w-[180px]"
            title={request.decisionNote}
          >
            {request.decisionNote}
          </p>
        )}
        {isWorkshop && request.status === "FULFILLED" && onGoToPurchases && (
          <button
            type="button"
            onClick={onGoToPurchases}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
          >
            Ver en Mis compras
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  const actions = (request: MarketplaceRequest) => {
    if (!isAdmin) return null
    const busy = decidingId === request.id

    if (request.status === "PENDING") {
      return (
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-success border-success/40 hover:bg-success/10 hover:text-success"
            disabled={busy}
            onClick={() => void decide(request, "APPROVE")}
          >
            {busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1 h-3.5 w-3.5" />
            )}
            Aprobar
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Rechazar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>¿Rechazar solicitud?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se rechazará la solicitud de {request.qty}{" "}
                  {request.qty === 1 ? "pieza" : "piezas"} de{" "}
                  <span className="font-medium">{request.product.name}</span>{" "}
                  para {request.tallerName}. Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void decide(request, "REJECT")}
                >
                  Rechazar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )
    }

    if (request.status === "APPROVED") {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-violet-600 border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-600 dark:text-violet-400 dark:hover:text-violet-300"
          disabled={busy}
          onClick={() => openFulfill(request)}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <PackageCheck className="mr-1 h-3.5 w-3.5" />
          )}
          Marcar surtida
        </Button>
      )
    }

    // Surtida: enlace directo al ticket de la venta generada.
    if (request.status === "FULFILLED" && request.sale) {
      return (
        <a
          href={`/admin/tickets/venta/${request.sale.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Printer className="h-3.5 w-3.5" />
          Ticket V-{String(request.sale.number).padStart(6, "0")}
        </a>
      )
    }

    return <span className="text-muted-foreground">—</span>
  }

  if (loadError) {
    return (
      <div role="alert" className="rounded-lg border p-6 space-y-3">
        <p>{loadError}</p>
        <Button variant="outline" onClick={() => void fetchRequests()}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filtro por estado */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === f.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-muted"
            )}
          >
            {f.label}
            {f.value === "PENDING" && pendingCount > 0 && (
              <span className="ml-1 font-semibold">({pendingCount})</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <RequestsTableSkeleton isAdmin={isAdmin} isWorkshop={isWorkshop} />
      ) : displayed.length > 0 ? (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                {!isWorkshop && <TableHead>Taller</TableHead>}
                <TableHead className="text-center">Cant.</TableHead>
                <TableHead>Precio taller</TableHead>
                <TableHead>Fecha</TableHead>
                {!isWorkshop && <TableHead>Solicitó</TableHead>}
                <TableHead>Estado</TableHead>
                {isAdmin && <TableHead className="text-right">Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="min-w-[160px]">
                    <p className="font-medium leading-snug">
                      {request.product.name}
                    </p>
                    {request.product.barcode && (
                      <p className="text-[11px] text-muted-foreground">
                        {request.product.barcode}
                      </p>
                    )}
                    {request.note && (
                      <p
                        className="text-[11px] text-muted-foreground italic truncate max-w-[220px]"
                        title={request.note}
                      >
                        “{request.note}”
                      </p>
                    )}
                  </TableCell>
                  {!isWorkshop && (
                    <TableCell className="min-w-[140px]">
                      <p className="font-medium">{request.tallerName}</p>
                      {(request.contactName || request.contactPhone) && (
                        <p className="text-[11px] text-muted-foreground">
                          {[request.contactName, request.contactPhone]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-center font-semibold">
                    {request.qty}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <p>{formatPrice(request.product.wholesalePrice)} c/u</p>
                    <p className="text-[11px] text-muted-foreground">
                      Total:{" "}
                      <span className="font-semibold text-foreground">
                        {formatPrice(request.product.wholesalePrice * request.qty)}
                      </span>
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(request.createdAt)}
                  </TableCell>
                  {!isWorkshop && (
                    <TableCell className="whitespace-nowrap">
                      {request.requestedBy?.name ?? "—"}
                    </TableCell>
                  )}
                  <TableCell>{statusBadge(request)}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">{actions(request)}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={
            statusFilter === "all"
              ? isWorkshop
                ? "Aún no tienes solicitudes"
                : "Sin solicitudes de talleres"
              : "Sin solicitudes con este estado"
          }
          description={
            statusFilter === "all"
              ? isWorkshop
                ? "Pide refacciones desde el catálogo y dales seguimiento aquí."
                : "Cuando un taller aliado pida piezas del catálogo, aparecerán aquí para su revisión."
              : "Prueba con otro filtro de estado."
          }
        />
      )}

      {/* Surtido: genera la venta a precio de taller y liga saleId. */}
      {isAdmin && (
        <MarketplaceFulfillDialog
          request={fulfillTarget}
          open={fulfillOpen}
          onOpenChange={setFulfillOpen}
          onFulfilled={handleFulfilled}
          formatPrice={formatPrice}
        />
      )}
    </div>
  )
}

function RequestsTableSkeleton({
  isAdmin,
  isWorkshop,
}: {
  isAdmin: boolean
  isWorkshop: boolean
}) {
  // Columnas: Producto [Taller] Cant. Precio Fecha [Solicitó] Estado [Acciones]
  const cols = (isWorkshop ? 0 : 2) + 5 + (isAdmin ? 1 : 0)
  return (
    <div className="rounded-lg border overflow-hidden animate-pulse">
      <div className="border-b bg-muted/40 px-4 py-3">
        <div className="h-4 w-full max-w-xl rounded bg-muted" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="grid items-center gap-4 border-b px-4 py-3.5 last:border-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          <div className="h-4 w-4/5 rounded bg-muted" />
          {!isWorkshop && <div className="h-4 w-3/5 rounded bg-muted" />}
          <div className="h-4 w-8 rounded bg-muted justify-self-center" />
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
          {!isWorkshop && <div className="h-4 w-20 rounded bg-muted" />}
          <div className="h-5 w-16 rounded bg-muted" />
          {isAdmin && <div className="h-7 w-24 rounded bg-muted justify-self-end" />}
        </div>
      ))}
    </div>
  )
}
