"use client"

import { useMemo, useState } from "react"
import { CheckSquare, Square, Store } from "lucide-react"
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
import { MarketVisibilityControl } from "./visibility-control"
import type { MarketplaceProduct } from "./product-card"
import {
  MARKET_VISIBILITY_LABELS,
  MARKET_VISIBILITY_LEVELS,
  type MarketVisibility,
} from "@/lib/market-visibility"
import { cn } from "@/lib/utils"

interface MarketplacePublicationPanelProps {
  products: MarketplaceProduct[]
  loading: boolean
  /** Persiste el nivel (optimista con revert lo maneja la página). */
  onSetLevel: (productIds: string[], level: MarketVisibility) => void
  /** Ids con mutación en vuelo (filas deshabilitadas). */
  pendingIds: ReadonlySet<string>
  formatPrice: (price: number) => string
  hasActiveFilters: boolean
}

/**
 * Panel de publicación del staff en /admin/mercado: cada producto lleva un
 * control de 3 niveles (Oculto / Solo aliados / Público) y la selección
 * múltiple permite publicación masiva al nivel elegido.
 */
export function MarketplacePublicationPanel({
  products,
  loading,
  onSetLevel,
  pendingIds,
  formatPrice,
  hasActiveFilters,
}: MarketplacePublicationPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const loadedIds = useMemo(() => new Set(products.map((p) => p.id)), [products])
  const selectedLoaded = useMemo(
    () => [...selected].filter((id) => loadedIds.has(id)),
    [selected, loadedIds]
  )
  const allSelected =
    products.length > 0 && selectedLoaded.length === products.length

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(products.map((p) => p.id)))
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyBulk = (level: MarketVisibility) => {
    if (selectedLoaded.length === 0) return
    onSetLevel(selectedLoaded, level)
    setSelected(new Set())
  }

  if (loading) {
    return <PublicationTableSkeleton />
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title={hasActiveFilters ? "Sin resultados" : "Sin productos activos"}
        description={
          hasActiveFilters
            ? "Prueba con otra búsqueda o categoría."
            : "Cuando tengas productos activos en el catálogo, aquí eliges quién los ve."
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Barra de publicación masiva por nivel */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
        <button
          type="button"
          onClick={toggleAll}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {allSelected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
          {allSelected ? "Quitar selección" : `Seleccionar ${products.length}`}
        </button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {selectedLoaded.length > 0
            ? `${selectedLoaded.length} seleccionado${selectedLoaded.length === 1 ? "" : "s"}`
            : "Selecciona productos para cambio masivo"}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {MARKET_VISIBILITY_LEVELS.map((level) => (
            <Button
              key={level}
              type="button"
              size="sm"
              variant={level === "PUBLIC" ? "default" : "outline"}
              className="h-8 text-xs"
              disabled={selectedLoaded.length === 0}
              onClick={() => applyBulk(level)}
            >
              {MARKET_VISIBILITY_LABELS[level]}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Producto</TableHead>
              <TableHead className="text-center">Stock</TableHead>
              <TableHead>Público</TableHead>
              <TableHead>Taller</TableHead>
              <TableHead>Visibilidad en el mercado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const isSelected = selected.has(product.id)
              const busy = pendingIds.has(product.id)
              return (
                <TableRow
                  key={product.id}
                  className={cn(product.marketVisibility === "HIDDEN" && "bg-muted/30")}
                >
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleOne(product.id)}
                      aria-label={isSelected ? `Quitar ${product.name}` : `Seleccionar ${product.name}`}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="min-w-[180px]">
                    <p className="font-medium leading-snug">{product.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {product.category.name}
                      {product.barcode ? ` · ${product.barcode}` : ""}
                    </p>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={product.stock > 0 ? "secondary" : "destructive"}
                      className="font-semibold"
                    >
                      {product.stock}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatPrice(product.retailPrice)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {formatPrice(product.wholesalePrice)}
                  </TableCell>
                  <TableCell>
                    <MarketVisibilityControl
                      value={product.marketVisibility}
                      busy={busy}
                      onChange={(level) => onSetLevel([product.id], level)}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function PublicationTableSkeleton() {
  return (
    <div className="rounded-lg border overflow-hidden animate-pulse">
      <div className="border-b bg-muted/40 px-4 py-3">
        <div className="h-4 w-full max-w-xl rounded bg-muted" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-6 items-center gap-4 border-b px-4 py-3.5 last:border-0"
        >
          <div className="h-4 w-4 rounded bg-muted" />
          <div className="h-4 w-4/5 rounded bg-muted" />
          <div className="h-4 w-8 rounded bg-muted justify-self-center" />
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-7 w-44 rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
