"use client"

import { useCallback, useEffect, useState } from "react"
import { ShoppingBag, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/admin/empty-state"
import { cn } from "@/lib/utils"

interface PurchaseItem {
  id: string
  quantity: number
  unitPrice: number
  totalPrice: number
  product: { name: string; barcode: string | null }
}

interface PurchasePayment {
  id: string
  method: string
  amount: number
  status: string
}

export interface MarketplacePurchase {
  id: string
  tallerName: string
  requestedAt: string
  fulfilledAt: string | null
  sale: {
    id: string
    number: number
    status: string
    total: number
    createdAt: string
    items: PurchaseItem[]
    payments: PurchasePayment[]
  }
}

const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  CREDIT: "A crédito",
}

const PAYMENT_STATUS_HINT: Record<string, string> = {
  PENDING_REVIEW: "por verificar",
  REFUNDED: "reembolsado",
  VOIDED: "anulado",
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })

interface MarketplacePurchasesPanelProps {
  // WORKSHOP: su propio historial + saldo a crédito. Staff: todas las compras.
  isWorkshop: boolean
  formatPrice: (price: number) => string
}

export function MarketplacePurchasesPanel({
  isWorkshop,
  formatPrice,
}: MarketplacePurchasesPanelProps) {
  const [purchases, setPurchases] = useState<MarketplacePurchase[]>([])
  const [credit, setCredit] = useState<{ balance: number; limit: number | null } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchPurchases = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/marketplace/purchases", { signal })
      if (!res.ok) throw new Error("No se pudieron cargar las compras")
      const data = await res.json()
      if (signal?.aborted) return
      setPurchases(Array.isArray(data.purchases) ? data.purchases : [])
      setCredit(data.credit ?? null)
    } catch {
      if (!signal?.aborted) {
        setLoadError("No se pudieron cargar las compras. Revisa tu conexión y reintenta.")
      }
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => void fetchPurchases(controller.signal))
    return () => controller.abort()
  }, [fetchPurchases])

  if (loadError) {
    return (
      <div role="alert" className="rounded-lg border p-6 space-y-3">
        <p>{loadError}</p>
        <Button variant="outline" onClick={() => void fetchPurchases()}>
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Estado de cuenta: los abonos a crédito son globales, no por venta. */}
      {isWorkshop && credit && credit.balance > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-foreground">
              Saldo pendiente a crédito: {formatPrice(credit.balance)}
            </p>
            <p className="text-muted-foreground text-xs">
              {credit.limit != null
                ? `Límite de crédito: ${formatPrice(credit.limit)} · `
                : ""}
              Puedes liquidar tu saldo con el proveedor.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <PurchasesSkeleton />
      ) : purchases.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {purchases.map((purchase) => (
            <PurchaseCard
              key={purchase.id}
              purchase={purchase}
              isWorkshop={isWorkshop}
              formatPrice={formatPrice}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShoppingBag}
          title={isWorkshop ? "Aún no tienes compras" : "Sin compras surtidas"}
          description={
            isWorkshop
              ? "Solicita refacciones desde el catálogo y aparecerán aquí una vez surtidas."
              : "Cuando una solicitud del mercado se marque como surtida, su venta aparecerá aquí."
          }
        />
      )}
    </div>
  )
}

function PurchaseCard({
  purchase,
  isWorkshop,
  formatPrice,
}: {
  purchase: MarketplacePurchase
  isWorkshop: boolean
  formatPrice: (price: number) => string
}) {
  const { sale } = purchase
  const folio = `V-${String(sale.number).padStart(6, "0")}`
  const onCredit = sale.payments.some(
    (p) => p.method === "CREDIT" && p.amount > 0 && p.status === "CONFIRMED"
  )
  const voided = sale.status === "VOIDED"

  return (
    <Card className={cn("overflow-hidden", voided && "opacity-70")}>
      <CardContent className="p-4 sm:p-5 space-y-3">
        {/* Folio + fecha + badges */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold leading-tight">{folio}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(sale.createdAt)}
              {!isWorkshop && ` · ${purchase.tallerName}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {voided && <Badge variant="destructive">Anulada</Badge>}
            {onCredit && !voided && (
              <Badge variant="warning">A crédito</Badge>
            )}
          </div>
        </div>

        {/* Partidas cobradas a precio de mayoreo */}
        <ul className="divide-y text-sm">
          {sale.items.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="font-medium">{item.quantity} ×</span>{" "}
                {item.product.name}
                <span className="block text-[11px] text-muted-foreground">
                  {formatPrice(item.unitPrice)} c/u
                </span>
              </span>
              <span className="font-medium whitespace-nowrap">
                {formatPrice(item.totalPrice)}
              </span>
            </li>
          ))}
        </ul>

        {/* Pagos + total de la venta (montos del servidor) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <div className="flex flex-wrap gap-1.5">
            {sale.payments.length > 0 ? (
              sale.payments.map((payment) => {
                const hint = PAYMENT_STATUS_HINT[payment.status]
                return (
                  <span
                    key={payment.id}
                    className={cn(
                      "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                      payment.method === "CREDIT"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {METHOD_LABEL[payment.method] ?? payment.method}
                    {` · ${formatPrice(payment.amount)}`}
                    {hint ? ` (${hint})` : ""}
                  </span>
                )
              })
            ) : (
              <span className="text-[11px] text-muted-foreground">Sin pagos registrados</span>
            )}
          </div>
          <p className="text-base font-bold whitespace-nowrap">
            Total {formatPrice(sale.total)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function PurchasesSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="overflow-hidden animate-pulse">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5">
                <div className="h-4 w-28 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
              </div>
              <div className="h-5 w-16 rounded bg-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-2/3 rounded bg-muted" />
            </div>
            <div className="flex items-center justify-between border-t pt-3">
              <div className="h-5 w-24 rounded bg-muted" />
              <div className="h-5 w-20 rounded bg-muted" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
