"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Building2,
  Loader2,
  PackageSearch,
  Search,
  Send,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/admin/empty-state"
import { MarketplaceRequestDialog } from "./request-dialog"
import type { MarketplaceProduct } from "./product-card"
import type { MarketVisibility } from "@/lib/market-visibility"
import { isMarketVisibility } from "@/lib/market-visibility"
import { cn } from "@/lib/utils"

/**
 * "Pedidos que hago": solicitudes que este negocio hizo a OTROS negocios del
 * mercado (GET /api/marketplace/requests?direction=out). El modelo
 * MarketplaceRequest guarda businessId = proveedor y requestedBy → usuario
 * del negocio comprador, así la dirección saliente se deriva sin campo extra.
 *
 * El buscador consume /api/marketplace/sugerencias (top 10 de otros negocios
 * con la pieza en ALLIES|PUBLIC) y crea el pedido con el mismo POST de
 * solicitudes — cae en la bandeja del proveedor.
 */

interface OutgoingRequest {
  id: string
  qty: number
  tallerName: string
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
  business: { id: string; name: string; slug: string }
  requestedBy: { id: string; name: string; role: string } | null
}

interface Suggestion {
  id: string
  name: string
  retailPrice: number
  wholesalePrice: number | null
  marketVisibility: string
  business: { id: string; name: string; slug: string }
  branchNames: string[]
  available: boolean
}

type BadgeVariant = "warning" | "success" | "destructive" | "secondary"

const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDING: { label: "Pendiente", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "success" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
  FULFILLED: { label: "Surtida", variant: "secondary" },
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

const MIN_CHARS = 2
const DEBOUNCE_MS = 300

interface MarketplaceOutgoingPanelProps {
  isWorkshop: boolean
  formatPrice: (price: number) => string
}

export function MarketplaceOutgoingPanel({
  isWorkshop,
  formatPrice,
}: MarketplaceOutgoingPanelProps) {
  const [requests, setRequests] = useState<OutgoingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Buscador en el catálogo de otros negocios.
  const [search, setSearch] = useState("")
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [searching, setSearching] = useState(false)

  // Diálogo de pedido reutilizado (el mismo POST /api/marketplace/requests).
  const [requestTarget, setRequestTarget] = useState<MarketplaceProduct | null>(null)
  const [requestSeller, setRequestSeller] = useState<string | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)

  const fetchOutgoing = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/marketplace/requests?direction=out", { signal })
      if (!res.ok) throw new Error("No se pudieron cargar tus pedidos")
      const data = await res.json()
      if (signal?.aborted) return
      setRequests(Array.isArray(data.requests) ? data.requests : [])
    } catch {
      if (!signal?.aborted) {
        setLoadError("No se pudieron cargar tus pedidos. Revisa tu conexión y reintenta.")
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => void fetchOutgoing(controller.signal))
    return () => controller.abort()
  }, [fetchOutgoing, refreshKey])

  // Búsqueda con debounce en sugerencias cross-business. Con menos de
  // MIN_CHARS el render deriva "sin resultados" (browsingSuggestions) sin
  // tocar estado — la próxima búsqueda válida pisa `suggestions`.
  useEffect(() => {
    const term = search.trim()
    if (term.length < MIN_CHARS) return
    const controller = new AbortController()
    const debounce = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/marketplace/sugerencias?q=${encodeURIComponent(term)}`,
          { signal: controller.signal }
        )
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        if (controller.signal.aborted) return
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
      } catch {
        if (!controller.signal.aborted) setSuggestions([])
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(debounce)
      controller.abort()
    }
  }, [search])

  const openRequest = (s: Suggestion) => {
    // El diálogo solo necesita id/nombre/precio de taller para armar el POST.
    setRequestTarget({
      id: s.id,
      name: s.name,
      barcode: null,
      retailPrice: s.retailPrice,
      wholesalePrice: s.wholesalePrice ?? s.retailPrice,
      stock: s.available ? 1 : 0,
      minStock: 0,
      image: null,
      marketVisibility: isMarketVisibility(s.marketVisibility)
        ? (s.marketVisibility as MarketVisibility)
        : "ALLIES",
      category: { id: "", name: "" },
      branches: [],
    })
    setRequestSeller(s.business.name)
    setRequestOpen(true)
  }

  const term = search.trim()
  const browsingSuggestions = term.length >= MIN_CHARS

  return (
    <div className="space-y-6">
      {/* Buscador en el catálogo de otros negocios */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar la pieza en otros negocios aliados…"
            aria-label="Buscar pieza en otros negocios"
            className="pl-9"
          />
        </div>

        {browsingSuggestions && (
          <div className="rounded-lg border divide-y" aria-live="polite">
            {searching ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando en negocios aliados…
              </div>
            ) : suggestions.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Ningún otro negocio tiene “{term}” publicado para aliados.
              </p>
            ) : (
              suggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug truncate">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1 flex-wrap">
                      <Building2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{s.business.name}</span>
                      {s.branchNames.length > 0 && (
                        <span>· En: {s.branchNames.join(", ")}</span>
                      )}
                    </p>
                  </div>
                  <Badge variant={s.available ? "success" : "secondary"}>
                    {s.available ? "Disponible" : "Agotado"}
                  </Badge>
                  {s.wholesalePrice != null && (
                    <p className="text-sm font-semibold whitespace-nowrap">
                      {formatPrice(s.wholesalePrice)}
                      <span className="block text-[10px] font-normal text-muted-foreground text-right">
                        precio taller
                      </span>
                    </p>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => openRequest(s)}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Pedir
                  </Button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Listado de pedidos salientes */}
      {loadError ? (
        <div role="alert" className="rounded-lg border p-6 space-y-3">
          <p>{loadError}</p>
          <Button variant="outline" onClick={() => void fetchOutgoing()}>
            Reintentar
          </Button>
        </div>
      ) : loading ? (
        <OutgoingTableSkeleton />
      ) : requests.length > 0 ? (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-center">Cant.</TableHead>
                <TableHead>Precio taller</TableHead>
                <TableHead>Fecha</TableHead>
                {!isWorkshop && <TableHead>Pidió</TableHead>}
                <TableHead>Estado</TableHead>
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
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-medium">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {request.business.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-center font-semibold">
                      {request.qty}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatPrice(request.product.wholesalePrice * request.qty)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(request.createdAt)}
                    </TableCell>
                    {!isWorkshop && (
                      <TableCell className="whitespace-nowrap">
                        {request.requestedBy?.name ?? "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="space-y-0.5">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {request.status === "REJECTED" && request.decisionNote && (
                          <p
                            className="text-[11px] text-muted-foreground truncate max-w-[180px]"
                            title={request.decisionNote}
                          >
                            {request.decisionNote}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={PackageSearch}
          title="Sin pedidos a otros negocios"
          description="Busca una pieza arriba: si un aliado la tiene publicada, puedes pedirla desde aquí y darle seguimiento."
        />
      )}

      <MarketplaceRequestDialog
        product={requestTarget}
        sellerName={requestSeller}
        open={requestOpen}
        onOpenChange={setRequestOpen}
        onSuccess={() => setRefreshKey((k) => k + 1)}
        formatPrice={formatPrice}
        isWorkshop={isWorkshop}
      />
    </div>
  )
}

function OutgoingTableSkeleton() {
  return (
    <div className="rounded-lg border overflow-hidden animate-pulse">
      <div className="border-b bg-muted/40 px-4 py-3">
        <div className="h-4 w-full max-w-xl rounded bg-muted" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "grid grid-cols-7 items-center gap-4 border-b px-4 py-3.5 last:border-0"
          )}
        >
          <div className="h-4 w-4/5 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-4 w-8 rounded bg-muted justify-self-center" />
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
          <div className="h-4 w-20 rounded bg-muted" />
          <div className="h-5 w-16 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
