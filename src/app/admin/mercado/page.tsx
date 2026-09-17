"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/admin/empty-state"
import {
  MarketplaceCardSkeleton,
  MarketplaceProductCard,
  type MarketplaceProduct,
} from "@/components/admin/marketplace/product-card"
import { MarketplacePurchasesPanel } from "@/components/admin/marketplace/purchases-panel"
import { MarketplaceRequestDialog } from "@/components/admin/marketplace/request-dialog"
import { MarketplaceRequestsPanel } from "@/components/admin/marketplace/requests-panel"
import { PartRequestsPanel } from "@/components/admin/mercado/solicitudes-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrency } from "@/components/currency-provider"
import { cn } from "@/lib/utils"
import {
  ClipboardList,
  EyeOff,
  Globe,
  Handshake,
  Info,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react"
import { toast } from "sonner"

interface Category {
  id: string
  name: string
}

export default function MercadoPage() {
  const { data: session } = useSession()
  const { formatPrice } = useCurrency()
  const isAdmin = session?.user?.role === "ADMIN"
  // Taller aliado externo: ve el catálogo, solo sus propias solicitudes y sus compras.
  const isWorkshop = session?.user?.role === "WORKSHOP"
  // El nombre del taller sale de su perfil (jobTitle) con fallback al nombre de la cuenta.
  const workshopName =
    session?.user?.jobTitle?.trim() || session?.user?.name?.trim() || "tu taller"

  const [products, setProducts] = useState<MarketplaceProduct[]>([])
  const [visibleCount, setVisibleCount] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string>("all")
  const [showHidden, setShowHidden] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // Solicitudes de talleres aliados ("compras" solo existe para cuentas WORKSHOP)
  const [tab, setTab] = useState<"catalogo" | "solicitudes" | "compras" | "solicitudes-web">("catalogo")
  const [requestTarget, setRequestTarget] = useState<MarketplaceProduct | null>(null)
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [requestsRefreshKey, setRequestsRefreshKey] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  // Solicitudes de refacción del público en /mercado (feed global de plataforma)
  const [openPartRequests, setOpenPartRequests] = useState(0)

  const openRequestDialog = (product: MarketplaceProduct) => {
    setRequestTarget(product)
    setRequestDialogOpen(true)
  }

  // Debounce de búsqueda (~300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchProducts = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams()
        if (debouncedSearch) params.set("search", debouncedSearch)
        if (categoryId !== "all") params.set("category", categoryId)
        if (showHidden && isAdmin) params.set("hidden", "1")

        const res = await fetch(`/api/marketplace?${params}`, { signal })
        if (!res.ok) throw new Error("No se pudo cargar el mercado")
        const data = await res.json()
        if (signal?.aborted) return
        setProducts(data.products ?? [])
        setVisibleCount(data.visibleCount ?? 0)
      } catch {
        if (!signal?.aborted) {
          setLoadError("No se pudo cargar el mercado. Revisa tu conexión y vuelve a intentar.")
        }
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [debouncedSearch, categoryId, showHidden, isAdmin]
  )

  useEffect(() => {
    const controller = new AbortController()
    // Diferido a microtask para no llamar setState de forma síncrona dentro del efecto.
    queueMicrotask(() => void fetchProducts(controller.signal))
    return () => controller.abort()
  }, [fetchProducts])

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]))
  }, [])

  const toggleVisibility = async (product: MarketplaceProduct) => {
    const next = !product.marketplaceVisible
    setTogglingId(product.id)
    // Actualización optimista
    setProducts((prev) =>
      prev.map((p) => (p.id === product.id ? { ...p, marketplaceVisible: next } : p))
    )
    setVisibleCount((prev) => Math.max(0, prev + (next ? 1 : -1)))

    try {
      const res = await fetch("/api/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, marketplaceVisible: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Error al actualizar")
      toast.success(next ? "Producto visible para talleres" : "Producto oculto a talleres")
    } catch (error) {
      // Revertir si falló
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, marketplaceVisible: !next } : p))
      )
      setVisibleCount((prev) => Math.max(0, prev + (next ? -1 : 1)))
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar el producto")
    } finally {
      setTogglingId(null)
    }
  }

  // Sin "Ver ocultos", los productos ocultos no se muestran (actualización optimista).
  const displayedProducts = showHidden
    ? products
    : products.filter((p) => p.marketplaceVisible)

  const hasActiveFilters = debouncedSearch !== "" || categoryId !== "all"

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Store className="h-6 w-6" />
            {isWorkshop ? "Portal de taller aliado" : "Mercado de refacciones"}
          </h1>
          <p className="text-muted-foreground">
            {isWorkshop
              ? "Compra refacciones a precio de mayoreo y da seguimiento a tus pedidos"
              : "Inventario disponible para talleres aliados"}
          </p>
        </div>
        <Badge variant="secondary" className="self-start sm:self-auto text-sm px-3 py-1">
          {visibleCount}{" "}
          {isWorkshop
            ? visibleCount === 1
              ? "producto disponible"
              : "productos disponibles"
            : visibleCount === 1
              ? "producto visible"
              : "productos visibles"}
        </Badge>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "catalogo" | "solicitudes" | "compras" | "solicitudes-web")}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="catalogo" className="px-4">
            <Store className="h-4 w-4" />
            Catálogo
          </TabsTrigger>
          <TabsTrigger value="solicitudes" className="px-4">
            <ClipboardList className="h-4 w-4" />
            {isWorkshop ? "Mis solicitudes" : "Solicitudes"}
            {pendingCount > 0 && (
              <span className="ml-1 inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700 dark:text-amber-400">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          {/* Pedidos del público en /mercado — solo staff (ADMIN/EMPLOYEE);
              cuentas WORKSHOP no tienen acceso al feed. */}
          {!isWorkshop && (
            <TabsTrigger value="solicitudes-web" className="px-4">
              <Globe className="h-4 w-4" />
              Solicitudes web
              {openPartRequests > 0 && (
                <span className="ml-1 inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-amber-700 dark:text-amber-400">
                  {openPartRequests}
                </span>
              )}
            </TabsTrigger>
          )}
          {/* Historial de compras surtidas — solo portal del taller aliado */}
          {isWorkshop && (
            <TabsTrigger value="compras" className="px-4">
              <ShoppingBag className="h-4 w-4" />
              Mis compras
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="catalogo" className="space-y-6">
          {/* Banner informativo para admin */}
          {isAdmin && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Este catálogo es lo que verán los talleres aliados. Usa el{" "}
                <span className="font-medium text-foreground">ojo</span> en cada tarjeta
                para ocultar productos internos y la opción{" "}
                <span className="font-medium text-foreground">Ver ocultos</span> para
                volver a mostrarlos.
              </p>
            </div>
          )}

          {/* Banner del portal: nombre del taller + precios de mayoreo */}
          {isWorkshop && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <Handshake className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Compras para{" "}
                <span className="font-medium text-foreground">{workshopName}</span>
                {" · "}precios de mayoreo
              </p>
            </div>
          )}

          {/* Barra de búsqueda y filtros */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, código o categoría..."
                  aria-label="Buscar en el mercado"
                  className="pl-9"
                />
              </div>
              {isAdmin && (
                <Button
                  type="button"
                  variant={showHidden ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowHidden((v) => !v)}
                  className="shrink-0"
                >
                  <EyeOff className="mr-2 h-4 w-4" />
                  Ver ocultos
                </Button>
              )}
            </div>

            {/* Filtro de categorías */}
            {categories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                <button
                  type="button"
                  onClick={() => setCategoryId("all")}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    categoryId === "all"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  Todas
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      categoryId === cat.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Contenido */}
          {loadError ? (
            <div role="alert" className="rounded-lg border p-6 space-y-3">
              <p>{loadError}</p>
              <Button variant="outline" onClick={() => void fetchProducts()}>
                Reintentar
              </Button>
            </div>
          ) : loading ? (
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <MarketplaceCardSkeleton key={i} />
              ))}
            </div>
          ) : displayedProducts.length > 0 ? (
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {displayedProducts.map((product) => (
                <MarketplaceProductCard
                  key={product.id}
                  product={product}
                  isAdmin={isAdmin}
                  toggling={togglingId === product.id}
                  onToggleVisibility={isAdmin ? toggleVisibility : undefined}
                  onRequest={openRequestDialog}
                  formatPrice={formatPrice}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Store}
              title={
                hasActiveFilters
                  ? "Sin resultados en el mercado"
                  : "Sin productos visibles en el mercado"
              }
              description={
                hasActiveFilters
                  ? "Prueba con otra búsqueda o categoría."
                  : isAdmin
                    ? "Los productos activos aparecen aquí automáticamente. Revisa que no estén ocultos."
                    : "Aún no hay refacciones publicadas para talleres aliados."
              }
            />
          )}
        </TabsContent>

        <TabsContent value="solicitudes">
          <MarketplaceRequestsPanel
            isAdmin={isAdmin}
            isWorkshop={isWorkshop}
            refreshKey={requestsRefreshKey}
            onPendingCount={setPendingCount}
            onGoToPurchases={() => setTab("compras")}
            formatPrice={formatPrice}
          />
        </TabsContent>

        {!isWorkshop && (
          <TabsContent value="solicitudes-web">
            <PartRequestsPanel onOpenCount={setOpenPartRequests} />
          </TabsContent>
        )}

        {isWorkshop && (
          <TabsContent value="compras">
            <MarketplacePurchasesPanel
              isWorkshop={isWorkshop}
              formatPrice={formatPrice}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogo de solicitud de pieza para taller aliado */}
      <MarketplaceRequestDialog
        product={requestTarget}
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
        onSuccess={() => setRequestsRefreshKey((k) => k + 1)}
        formatPrice={formatPrice}
        isWorkshop={isWorkshop}
      />
    </div>
  )
}
