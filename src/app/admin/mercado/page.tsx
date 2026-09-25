"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/admin/empty-state"
import {
  MarketplaceCardSkeleton,
  MarketplaceProductCard,
  type MarketplaceProduct,
} from "@/components/admin/marketplace/product-card"
import { MarketplaceOutgoingPanel } from "@/components/admin/marketplace/outgoing-panel"
import { MarketplacePublicationPanel } from "@/components/admin/marketplace/publication-panel"
import { MarketplacePurchasesPanel } from "@/components/admin/marketplace/purchases-panel"
import { MarketplaceRequestDialog } from "@/components/admin/marketplace/request-dialog"
import { MarketplaceRequestsPanel } from "@/components/admin/marketplace/requests-panel"
import { PartRequestsPanel } from "@/components/admin/mercado/solicitudes-panel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrency } from "@/components/currency-provider"
import {
  MARKET_VISIBILITY_LABELS,
  type MarketVisibility,
} from "@/lib/market-visibility"
import { cn } from "@/lib/utils"
import {
  ClipboardList,
  ExternalLink,
  Globe,
  Handshake,
  Megaphone,
  Search,
  Send,
  ShoppingBag,
  Store,
} from "lucide-react"

interface Category {
  id: string
  name: string
}

type TabValue =
  | "publicacion"
  | "catalogo"
  | "solicitudes"
  | "compras"
  | "solicitudes-web"
  | "pedidos"

interface VisibilityCounts {
  hidden: number
  allies: number
  public: number
  published: number
}

const EMPTY_COUNTS: VisibilityCounts = {
  hidden: 0,
  allies: 0,
  public: 0,
  published: 0,
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
  const [counts, setCounts] = useState<VisibilityCounts>(EMPTY_COUNTS)
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Ids de productos con cambio de visibilidad en vuelo (optimista).
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())

  // Búsqueda y filtro por categoría del catálogo (aliado) y de la publicación (staff).
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [categoryId, setCategoryId] = useState<string>("all")
  // Link público de la vitrina (/{slug}/market) para la vista previa del staff.
  const [marketUrl, setMarketUrl] = useState<string | null>(null)

  const [tab, setTab] = useState<TabValue | null>(null)
  // Solicitudes de talleres aliados ("compras" solo existe para cuentas WORKSHOP)
  const [requestTarget, setRequestTarget] = useState<MarketplaceProduct | null>(null)
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [requestsRefreshKey, setRequestsRefreshKey] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  // Solicitudes de refacción del público en /mercado (feed global de plataforma)
  const [openPartRequests, setOpenPartRequests] = useState(0)

  // Tabs válidos por rol: el default es el primero de la lista.
  const allowedTabs: TabValue[] = isWorkshop
    ? ["catalogo", "solicitudes", "compras", "pedidos"]
    : ["publicacion", "solicitudes", "solicitudes-web", "pedidos"]
  const activeTab: TabValue =
    tab && allowedTabs.includes(tab) ? tab : allowedTabs[0]

  const openRequestDialog = (product: MarketplaceProduct) => {
    setRequestTarget(product)
    setRequestDialogOpen(true)
  }

  // Debounce de búsqueda (~300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // El staff consume `products` para el control de publicación (todos los
  // activos, con su nivel) y `counts` para el resumen; el aliado los usa
  // como catálogo navegable (solo ALLIES|PUBLIC desde el servidor).
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
        setCounts(data.counts ?? EMPTY_COUNTS)
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

  // Las categorías alimentan el filtro del catálogo (aliado) y de la
  // publicación (staff).
  useEffect(() => {
    if (!session) return
    fetch("/api/categories")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => setCategories([]))
  }, [session])

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

  // Cambio de visibilidad optimista: pinta el nivel nuevo de inmediato y
  // revierte si el POST falla. Sirve igual para un producto que para la
  // selección masiva (mismo endpoint, forma productIds).
  const setVisibility = useCallback(
    async (productIds: string[], level: MarketVisibility) => {
      if (productIds.length === 0) return
      const prevLevels = new Map(
        products
          .filter((p) => productIds.includes(p.id))
          .map((p) => [p.id, p.marketVisibility] as const)
      )
      if (prevLevels.size === 0) return

      // Optimista: productos y conteos (delta por nivel previo → nuevo).
      setProducts((prev) =>
        prev.map((p) =>
          prevLevels.has(p.id) ? { ...p, marketVisibility: level } : p
        )
      )
      setCounts((prev) => {
        const next = { ...prev }
        for (const [, oldLevel] of prevLevels) {
          if (oldLevel === "HIDDEN") next.hidden -= 1
          else if (oldLevel === "ALLIES") next.allies -= 1
          else next.public -= 1
        }
        const moved = prevLevels.size
        if (level === "HIDDEN") next.hidden += moved
        else if (level === "ALLIES") next.allies += moved
        else next.public += moved
        next.published = next.allies + next.public
        return next
      })
      setPendingIds((prev) => new Set([...prev, ...productIds]))

      try {
        const res = await fetch("/api/marketplace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            productIds.length === 1
              ? { productId: productIds[0], marketVisibility: level }
              : { productIds, marketVisibility: level }
          ),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "No se pudo actualizar")
        toast.success(
          productIds.length === 1
            ? `Visibilidad: ${MARKET_VISIBILITY_LABELS[level]}`
            : `${productIds.length} productos → ${MARKET_VISIBILITY_LABELS[level]}`
        )
      } catch (error) {
        // Revert: vuelve el nivel previo y los conteos se recalculan igual.
        setProducts((prev) =>
          prev.map((p) =>
            prevLevels.has(p.id)
              ? { ...p, marketVisibility: prevLevels.get(p.id)! }
              : p
          )
        )
        setCounts((prev) => {
          const next = { ...prev }
          for (const [, oldLevel] of prevLevels) {
            if (level === "HIDDEN") next.hidden -= 1
            else if (level === "ALLIES") next.allies -= 1
            else next.public -= 1
            if (oldLevel === "HIDDEN") next.hidden += 1
            else if (oldLevel === "ALLIES") next.allies += 1
            else next.public += 1
          }
          next.published = next.allies + next.public
          return next
        })
        toast.error(
          error instanceof Error ? error.message : "No se pudo actualizar"
        )
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev)
          for (const id of productIds) next.delete(id)
          return next
        })
      }
    },
    [products]
  )

  const hasActiveFilters = debouncedSearch !== "" || categoryId !== "all"

  // Barra de búsqueda + chips de categoría (compartida por catálogo aliado y
  // publicación del staff).
  const filterBar = (
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
  )

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
              ? "Compra refacciones a precio de aliado y da seguimiento a tus pedidos"
              : "Publica piezas para aliados y público, atiende solicitudes y pide a otros negocios"}
          </p>
        </div>
        {isWorkshop && (
          <Badge variant="secondary" className="self-start sm:self-auto text-sm px-3 py-1">
            {counts.published}{" "}
            {counts.published === 1 ? "producto disponible" : "productos disponibles"}
          </Badge>
        )}
      </div>

      {/* Resumen de publicación para staff: niveles del mercado + vista
          previa pública. El control por producto vive en el tab Publicación. */}
      {!isWorkshop && (
        <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="space-y-1">
            <p className="font-semibold">
              {loadError
                ? "No se pudo cargar el resumen de publicación"
                : loading
                  ? "Cargando publicación…"
                  : `${counts.published} ${
                      counts.published === 1
                        ? "producto publicado"
                        : "productos publicados"
                    } en el mercado`}
            </p>
            <p className="text-sm text-muted-foreground">
              {counts.allies} solo aliados · {counts.public} públicos ·{" "}
              {counts.hidden} ocultos
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
                  Vista pública del mercado
                </a>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant={activeTab === "publicacion" ? "outline" : "default"}
              onClick={() => setTab("publicacion")}
            >
              Gestionar publicación
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
          {/* El catálogo navegable solo lo usa el taller aliado (WORKSHOP). */}
          {isWorkshop && (
            <TabsTrigger value="catalogo" className="px-4">
              <Store className="h-4 w-4" />
              Catálogo
            </TabsTrigger>
          )}
          {!isWorkshop && (
            <TabsTrigger value="publicacion" className="px-4">
              <Megaphone className="h-4 w-4" />
              Publicación
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
          {/* Pedidos que este negocio hace a otros negocios del mercado */}
          <TabsTrigger value="pedidos" className="px-4">
            <Send className="h-4 w-4" />
            Pedidos que hago
          </TabsTrigger>
        </TabsList>

        {/* Publicación del staff: control de 3 niveles por producto y
            publicación masiva al nivel elegido. */}
        {!isWorkshop && (
          <TabsContent value="publicacion" className="space-y-4">
            {filterBar}
            {loadError ? (
              <div role="alert" className="rounded-lg border p-6 space-y-3">
                <p>{loadError}</p>
                <Button variant="outline" onClick={() => void fetchProducts()}>
                  Reintentar
                </Button>
              </div>
            ) : (
              <MarketplacePublicationPanel
                products={products}
                loading={loading}
                onSetLevel={(ids, level) => void setVisibility(ids, level)}
                pendingIds={pendingIds}
                formatPrice={formatPrice}
                hasActiveFilters={hasActiveFilters}
              />
            )}
          </TabsContent>
        )}

        {/* Catálogo del taller aliado: busca refacciones publicadas y las
            solicita al negocio. No se renderiza para staff. */}
        {isWorkshop && (
          <TabsContent value="catalogo" className="space-y-6">
            {/* Banner del portal: nombre del taller + precios de aliado */}
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <Handshake className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">
                Compras para{" "}
                <span className="font-medium text-foreground">{workshopName}</span>
                {" · "}precios de aliado
              </p>
            </div>

            {filterBar}

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

        {/* Pedidos que este negocio (o este taller) hace a otros negocios */}
        <TabsContent value="pedidos">
          <MarketplaceOutgoingPanel
            isWorkshop={isWorkshop}
            formatPrice={formatPrice}
          />
        </TabsContent>
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
