"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
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
  ExternalLink,
  Globe,
  Handshake,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react"

interface Category {
  id: string
  name: string
}

type TabValue = "catalogo" | "solicitudes" | "compras" | "solicitudes-web"

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

  // Búsqueda y filtro por categoría del catálogo navegable (solo WORKSHOP).
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string>("all")
  // Link público de la vitrina (/{slug}/market) para la vista previa del staff.
  const [marketUrl, setMarketUrl] = useState<string | null>(null)

  // Solicitudes de talleres aliados ("compras" solo existe para cuentas WORKSHOP)
  const [tab, setTab] = useState<TabValue>("catalogo")
  // El staff ya no administra el catálogo desde aquí: su tab efectivo siempre
  // es una bandeja de solicitudes (default "solicitudes").
  const activeTab: TabValue = isWorkshop
    ? tab
    : tab === "solicitudes-web"
      ? "solicitudes-web"
      : "solicitudes"
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

  // WORKSHOP consume `products` para el catálogo; al staff solo le interesa
  // `visibleCount` para la tarjeta de resumen (mismo endpoint, fetch ligero).
  const fetchProducts = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setLoadError(null)
      try {
        const params = new URLSearchParams()
        if (debouncedSearch) params.set("search", debouncedSearch)
        if (categoryId !== "all") params.set("category", categoryId)

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
    [debouncedSearch, categoryId]
  )

  useEffect(() => {
    const controller = new AbortController()
    // Diferido a microtask para no llamar setState de forma síncrona dentro del efecto.
    queueMicrotask(() => void fetchProducts(controller.signal))
    return () => controller.abort()
  }, [fetchProducts])

  // Las categorías solo alimentan el filtro del catálogo del taller aliado.
  useEffect(() => {
    if (!isWorkshop) return
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]))
  }, [isWorkshop])

  // URL pública del mercado del negocio (/{slug}/market) — solo para staff.
  useEffect(() => {
    if (!session || isWorkshop) return
    fetch("/api/settings/public-profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) =>
        setMarketUrl(typeof data?.urls?.market === "string" ? data.urls.market : null)
      )
      .catch(() => setMarketUrl(null))
  }, [session, isWorkshop])

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
              : "Solicitudes de talleres aliados y del público — tu publicación se gestiona en Catálogo"}
          </p>
        </div>
        {isWorkshop && (
          <Badge variant="secondary" className="self-start sm:self-auto text-sm px-3 py-1">
            {visibleCount}{" "}
            {visibleCount === 1 ? "producto disponible" : "productos disponibles"}
          </Badge>
        )}
      </div>

      {/* Resumen de publicación para staff: mostrar/ocultar productos del
          mercado se gestiona desde el hub de Catálogo (/admin/productos). */}
      {!isWorkshop && (
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="space-y-1">
            <p className="font-semibold">
              {loadError
                ? "No se pudo cargar el resumen de publicación"
                : loading
                  ? "Cargando publicación…"
                  : `${visibleCount} ${
                      visibleCount === 1
                        ? "producto publicado"
                        : "productos publicados"
                    } en el mercado`}
            </p>
            <p className="text-sm text-muted-foreground">
              Publica u oculta refacciones para talleres aliados desde el Catálogo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {loadError && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void fetchProducts()}
              >
                Reintentar
              </Button>
            )}
            {marketUrl && (
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={marketUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Vista previa del mercado
                </a>
              </Button>
            )}
            <Button size="sm" asChild>
              <Link href="/admin/productos?mercado=publicados">Gestionar publicación</Link>
            </Button>
          </div>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setTab(v as TabValue)}
        className="gap-6"
      >
        <TabsList>
          {/* El catálogo navegable solo lo usa el taller aliado (WORKSHOP);
              la publicación del staff vive en Catálogo (/admin/productos). */}
          {isWorkshop && (
            <TabsTrigger value="catalogo" className="px-4">
              <Store className="h-4 w-4" />
              Catálogo
            </TabsTrigger>
          )}
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

        {/* Catálogo del taller aliado: busca refacciones publicadas y las
            solicita al negocio. No se renderiza para staff. */}
        {isWorkshop && (
          <TabsContent value="catalogo" className="space-y-6">
            {/* Banner del portal: nombre del taller + precios de mayoreo */}
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <Handshake className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Compras para{" "}
                <span className="font-medium text-foreground">{workshopName}</span>
                {" · "}precios de mayoreo
              </p>
            </div>

            {/* Barra de búsqueda y filtros */}
            <div className="flex flex-col gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, código o categoría..."
                  aria-label="Buscar en el mercado"
                  className="pl-9"
                />
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
            ) : products.length > 0 ? (
              <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => (
                  <MarketplaceProductCard
                    key={product.id}
                    product={product}
                    isAdmin={isAdmin}
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
                    : "Aún no hay refacciones publicadas para talleres aliados."
                }
              />
            )}
          </TabsContent>
        )}

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
