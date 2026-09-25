"use client"

import Image from "next/image"
import { Globe, Handshake, Package, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { MARKET_VISIBILITY_LABELS, type MarketVisibility } from "@/lib/market-visibility"
import { cn } from "@/lib/utils"

export interface MarketplaceProduct {
  id: string
  name: string
  barcode: string | null
  retailPrice: number
  wholesalePrice: number
  stock: number
  minStock: number
  image: string | null
  /** Nivel de mercado: HIDDEN (nadie) / ALLIES (solo aliados) / PUBLIC (todos). */
  marketVisibility: MarketVisibility
  category: { id: string; name: string }
  branches: { branchId: string; branchName: string; quantity: number }[]
}

type StockStatus = {
  label: string
  variant: "success" | "warning" | "destructive"
}

function getStockStatus(product: MarketplaceProduct): StockStatus {
  if (product.stock <= 0) return { label: "Agotado", variant: "destructive" }
  if (product.stock <= product.minStock) return { label: "Últimas piezas", variant: "warning" }
  return { label: "Disponible", variant: "success" }
}

interface MarketplaceProductCardProps {
  product: MarketplaceProduct
  isAdmin: boolean
  onRequest?: (product: MarketplaceProduct) => void
  formatPrice: (price: number) => string
}

export function MarketplaceProductCard({
  product,
  isAdmin,
  onRequest,
  formatPrice,
}: MarketplaceProductCardProps) {
  const status = getStockStatus(product)
  const hidden = product.marketVisibility === "HIDDEN"
  const wholesaleHasDiscount = product.wholesalePrice < product.retailPrice

  return (
    <Card
      className={cn(
        "overflow-hidden h-full transition-shadow hover:shadow-lg",
        hidden && "opacity-60 border-dashed"
      )}
    >
      <div className="aspect-[4/3] relative bg-violet-100/60 dark:bg-violet-950/30">
        {product.image ? (
          <Image
            src={product.image}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 25vw"
            className={cn("object-cover", hidden && "grayscale")}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-200/70 dark:bg-violet-900/50">
              <Package className="h-8 w-8 text-violet-500 dark:text-violet-300" />
            </div>
          </div>
        )}

        {/* Badge de disponibilidad */}
        <Badge variant={status.variant} className="absolute top-2 left-2 shadow-sm">
          {status.label}
        </Badge>

        {/* Nivel de visibilidad — el taller aliado solo ve ALLIES|PUBLIC,
            pero el distintivo le dice si la pieza también es pública. */}
        <Badge
          variant="secondary"
          className="absolute bottom-2 left-2 shadow-sm gap-1"
        >
          {product.marketVisibility === "PUBLIC" ? (
            <Globe className="h-3 w-3" />
          ) : (
            <Users className="h-3 w-3" />
          )}
          {isAdmin || product.marketVisibility === "HIDDEN"
            ? MARKET_VISIBILITY_LABELS[product.marketVisibility]
            : product.marketVisibility === "PUBLIC"
              ? "También público"
              : MARKET_VISIBILITY_LABELS.ALLIES}
        </Badge>
      </div>

      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs font-normal">
            {product.category.name}
          </Badge>
          {product.barcode && (
            <span className="text-[11px] text-muted-foreground truncate">
              {product.barcode}
            </span>
          )}
        </div>

        <h3 className="font-medium leading-snug line-clamp-2 min-h-[2.6rem]">
          {product.name}
        </h3>

        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Precio aliado
            </p>
            <p className="text-lg font-bold text-primary leading-tight">
              {formatPrice(product.wholesalePrice)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Público</p>
            <p
              className={cn(
                "text-xs text-muted-foreground",
                wholesaleHasDiscount && "line-through"
              )}
            >
              {formatPrice(product.retailPrice)}
            </p>
          </div>
        </div>

        {product.branches.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {product.branches.map((b) => (
              <span
                key={b.branchId}
                className={cn(
                  "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px]",
                  b.quantity <= 0 ? "text-muted-foreground/60" : "text-muted-foreground"
                )}
              >
                {b.branchName}:{" "}
                <span className={cn("ml-0.5 font-semibold", b.quantity <= 0 && "font-normal")}>
                  {b.quantity}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Solicitar pieza para un taller aliado */}
        {onRequest && (
          <Button
            type="button"
            size="sm"
            className="w-full mt-1"
            onClick={() => onRequest(product)}
          >
            <Handshake className="mr-2 h-4 w-4" />
            Solicitar
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function MarketplaceCardSkeleton() {
  return (
    <Card className="overflow-hidden h-full animate-pulse">
      <div className="aspect-[4/3] bg-muted" />
      <CardContent className="p-4 space-y-3">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="space-y-1.5">
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
        </div>
        <div className="h-6 w-24 rounded bg-muted" />
      </CardContent>
    </Card>
  )
}
