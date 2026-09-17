"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Check,
  ClipboardList,
  Loader2,
  MessageCircle,
  RotateCcw,
  X,
} from "lucide-react"
import { toast } from "sonner"
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
import { cn, formatDay } from "@/lib/utils"

export interface PartRequest {
  id: string
  name: string
  detail: string | null
  phone: string
  status: "OPEN" | "CONTACTED" | "CLOSED"
  createdAt: string
}

type BadgeVariant = "warning" | "success" | "secondary"

const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  OPEN: { label: "Abierta", variant: "warning" },
  CONTACTED: { label: "Contactada", variant: "success" },
  CLOSED: { label: "Cerrada", variant: "secondary" },
}

const STATUS_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "OPEN", label: "Abiertas" },
  { value: "CONTACTED", label: "Contactadas" },
  { value: "CLOSED", label: "Cerradas" },
] as const

/** Fecha relativa corta ("hace 5 min", "hace 3 h", "hace 2 d"); al mes cae a fecha. */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "ahora"
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `hace ${days} d`
  return formatDay(iso)
}

// wa.me exige formato internacional; la API guarda 10 dígitos MX → +52.
function whatsappUrl(request: PartRequest): string {
  const digits = request.phone.replace(/\D/g, "")
  const intl = digits.length === 10 ? `52${digits}` : digits
  const text = `Hola, vi tu solicitud de ${request.name} en Reficio`
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`
}

interface SolicitudesPanelProps {
  /** Reporta cuántas solicitudes siguen OPEN (badge del tab). */
  onOpenCount?: (count: number) => void
}

/**
 * Solicitudes de refacción del directorio público (/mercado): visitantes que
 * no encontraron una pieza y dejaron su WhatsApp. Feed global de plataforma —
 * lo ve cualquier staff (ADMIN/EMPLOYEE) y la gestión es compartida.
 */
export function PartRequestsPanel({ onOpenCount }: SolicitudesPanelProps) {
  const [requests, setRequests] = useState<PartRequest[]>([])
  const [openCount, setOpenCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  // El conteo de abiertas alimenta el badge del tab en la página padre.
  const reportOpenCount = useCallback(
    (count: number) => {
      setOpenCount(count)
      onOpenCount?.(count)
    },
    [onOpenCount]
  )

  const fetchRequests = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setLoadError(null)
      try {
        const params =
          statusFilter === "all" ? "" : `?status=${statusFilter}`
        const res = await fetch(`/api/part-requests${params}`, { signal })
        if (!res.ok) throw new Error("No se pudieron cargar las solicitudes")
        const data = await res.json()
        if (signal?.aborted) return
        setRequests(Array.isArray(data.requests) ? data.requests : [])
        reportOpenCount(typeof data.openCount === "number" ? data.openCount : 0)
      } catch {
        if (!signal?.aborted) {
          setLoadError("No se pudieron cargar las solicitudes. Revisa tu conexión y reintenta.")
        }
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [statusFilter, reportOpenCount]
  )

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => void fetchRequests(controller.signal))
    return () => controller.abort()
  }, [fetchRequests])

  const setStatus = async (request: PartRequest, status: PartRequest["status"]) => {
    setUpdatingId(request.id)
    try {
      const res = await fetch(`/api/part-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar")
      setRequests((prev) =>
        prev.map((r) => (r.id === request.id ? data.request : r))
      )
      // Ajuste local del badge: la lista visible puede estar filtrada y no
      // incluir todas las OPEN, así que se deriva del conteo del servidor.
      const delta = (status === "OPEN" ? 1 : 0) - (request.status === "OPEN" ? 1 : 0)
      if (delta !== 0) reportOpenCount(Math.max(0, openCount + delta))
      toast.success(
        status === "CONTACTED"
          ? "Solicitud marcada como contactada"
          : status === "CLOSED"
            ? "Solicitud cerrada"
            : "Solicitud reabierta"
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar")
    } finally {
      setUpdatingId(null)
    }
  }

  const actions = (request: PartRequest) => {
    const busy = updatingId === request.id
    const spinner = busy ? (
      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
    ) : null

    return (
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-emerald-700 border-emerald-600/40 hover:bg-emerald-600/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
          asChild
        >
          <a
            href={whatsappUrl(request)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="mr-1 h-3.5 w-3.5" />
            Contactar
          </a>
        </Button>
        {request.status === "OPEN" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-success border-success/40 hover:bg-success/10 hover:text-success"
            disabled={busy}
            onClick={() => void setStatus(request, "CONTACTED")}
          >
            {spinner ?? <Check className="mr-1 h-3.5 w-3.5" />}
            Marcar contactado
          </Button>
        )}
        {request.status !== "CLOSED" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy}
            onClick={() => void setStatus(request, "CLOSED")}
          >
            {spinner ?? <X className="mr-1 h-3.5 w-3.5" />}
            Cerrar
          </Button>
        )}
        {request.status !== "OPEN" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground"
            disabled={busy}
            onClick={() => void setStatus(request, "OPEN")}
          >
            {spinner ?? <RotateCcw className="mr-1 h-3.5 w-3.5" />}
            Reabrir
          </Button>
        )}
      </div>
    )
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
          </button>
        ))}
      </div>

      {loading ? (
        <SolicitudesTableSkeleton />
      ) : requests.length > 0 ? (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Refacción solicitada</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const meta = STATUS_META[request.status] ?? {
                  label: request.status,
                  variant: "secondary" as const,
                }
                return (
                  <TableRow key={request.id}>
                    <TableCell className="min-w-[180px]">
                      <p className="font-medium leading-snug">{request.name}</p>
                      {request.detail && (
                        <p
                          className="text-[11px] text-muted-foreground italic truncate max-w-[260px]"
                          title={request.detail}
                        >
                          “{request.detail}”
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {request.phone}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap text-muted-foreground"
                      title={formatDay(request.createdAt)}
                    >
                      {timeAgo(request.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{actions(request)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={
            statusFilter === "all"
              ? "Sin solicitudes del público"
              : "Sin solicitudes con este estado"
          }
          description={
            statusFilter === "all"
              ? "Cuando un visitante de /mercado pida una refacción que nadie tiene publicada, aparecerá aquí."
              : "Prueba con otro filtro de estado."
          }
        />
      )}
    </div>
  )
}

function SolicitudesTableSkeleton() {
  return (
    <div className="rounded-lg border overflow-hidden animate-pulse">
      <div className="border-b bg-muted/40 px-4 py-3">
        <div className="h-4 w-full max-w-xl rounded bg-muted" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-5 items-center gap-4 border-b px-4 py-3.5 last:border-0"
        >
          <div className="h-4 w-4/5 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-5 w-16 rounded bg-muted" />
          <div className="h-7 w-40 rounded bg-muted justify-self-end" />
        </div>
      ))}
    </div>
  )
}
