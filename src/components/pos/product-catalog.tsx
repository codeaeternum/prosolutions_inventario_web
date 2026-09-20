"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Package, PackageSearch, Search, X } from "lucide-react"
import { toast } from "sonner"
import { cn, formatPrice } from "@/lib/utils"
import { productImage, unitPriceOf, type PosProduct } from "./types"

interface Category {
    id: string
    name: string
    icon?: string | null
    _count?: { products: number }
}

interface ProductCatalogProps {
    branchId: string
    workshopActive: boolean
    disabled?: boolean
    /** Búsqueda controlada por la página (Esc la limpia, el escáner la usa). */
    query: string
    onQueryChange: (query: string) => void
    onAdd: (product: PosProduct) => void
}

const PAGE_SIZE = 24

function ProductCard({ product, workshopActive, disabled, onAdd }: {
    product: PosProduct
    workshopActive: boolean
    disabled?: boolean
    onAdd: (p: PosProduct) => void
}) {
    const image = productImage(product)
    const outOfStock = product.stock < 1
    return (
        <button
            type="button"
            onClick={() => onAdd(product)}
            disabled={disabled || outOfStock}
            className={cn(
                "group flex flex-col rounded-lg border bg-card text-left overflow-hidden transition-shadow",
                "hover:shadow-md hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                outOfStock && "opacity-60"
            )}
        >
            <div className="relative aspect-square w-full bg-muted/60">
                {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URLs arbitrarias (uploads/CDN), el optimizador no las conoce
                    <img src={image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Package className="h-10 w-10 text-muted-foreground/30" />
                    </div>
                )}
                <div className="absolute top-1.5 right-1.5">
                    {outOfStock ? (
                        <Badge variant="destructive" className="text-[10px] px-1.5">Sin stock</Badge>
                    ) : (
                        <Badge variant="secondary" className="text-[10px] px-1.5 bg-background/80 backdrop-blur-sm">
                            {product.stock} ud
                        </Badge>
                    )}
                </div>
            </div>
            <div className="p-2 space-y-1 flex-1 flex flex-col">
                <p className="text-xs font-medium leading-tight line-clamp-2 flex-1">{product.name}</p>
                <p className="text-sm font-bold text-primary">
                    {formatPrice(unitPriceOf(product, workshopActive))}
                    {workshopActive && <span className="ml-1 text-[10px] font-normal text-muted-foreground">may.</span>}
                </p>
            </div>
        </button>
    )
}

/** Catálogo del mostrador: búsqueda instantánea + parrilla navegable por categoría. */
export function ProductCatalog({ branchId, workshopActive, disabled, query, onQueryChange, onAdd }: ProductCatalogProps) {
    const [categories, setCategories] = useState<Category[]>([])
    const [categoryId, setCategoryId] = useState("")

    const [browseProducts, setBrowseProducts] = useState<PosProduct[]>([])
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [browseLoading, setBrowseLoading] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [searchResults, setSearchResults] = useState<PosProduct[]>([])
    const [searching, setSearching] = useState(false)
    const searchRef = useRef(0)

    useEffect(() => {
        fetch("/api/categories")
            .then(r => (r.ok ? r.json() : null))
            .then((d: Category[] | { error?: string } | null) => {
                if (Array.isArray(d)) setCategories(d.filter(c => (c._count?.products ?? 1) > 0))
            })
            .catch(() => {})
    }, [])

    // Búsqueda con debounce: ≥2 caracteres usa el endpoint del POS (stock por sucursal).
    useEffect(() => {
        const q = query.trim()
        if (q.length < 2) return // los resultados visibles se filtran por la query
        const requestId = ++searchRef.current
        const timer = setTimeout(async () => {
            setSearching(true)
            try {
                const res = await fetch(`/api/search/pos?q=${encodeURIComponent(q)}${branchId ? `&branchId=${branchId}` : ""}`)
                const data: { products?: PosProduct[] } | null = await res.json().catch(() => null)
                if (!res.ok) throw new Error("search failed")
                if (searchRef.current === requestId) setSearchResults(data?.products ?? [])
            } catch {
                if (searchRef.current === requestId) {
                    setSearchResults([])
                    toast.error("Error al buscar productos")
                }
            } finally {
                if (searchRef.current === requestId) setSearching(false)
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [query, branchId])

    // Modo exploración: /api/pos/products da el stock de la sucursal activa
    // y pagina por cursor (orden alfabético), filtrado por la categoría.
    const loadBrowse = useCallback(async (cursor: string | null, append: boolean) => {
        if (append) setLoadingMore(true)
        else setBrowseLoading(true)
        try {
            const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
            if (categoryId) params.set("categoryId", categoryId)
            if (branchId) params.set("branchId", branchId)
            if (cursor) params.set("cursor", cursor)
            const res = await fetch(`/api/pos/products?${params}`)
            const data: { products?: PosProduct[]; nextCursor?: string | null } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error("load failed")
            const incoming = data?.products ?? []
            setBrowseProducts(prev => (append ? [...prev, ...incoming] : incoming))
            setNextCursor(data?.nextCursor ?? null)
        } catch {
            if (!append) setBrowseProducts([])
            toast.error("No se pudo cargar el catálogo")
        } finally {
            setBrowseLoading(false)
            setLoadingMore(false)
        }
    }, [categoryId, branchId])

    useEffect(() => {
        // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
        const id = setTimeout(() => void loadBrowse(null, false), 0)
        return () => clearTimeout(id)
    }, [loadBrowse])

    const searchingMode = query.trim().length >= 2
    const shownProducts = searchingMode ? searchResults : browseProducts
    const loading = searchingMode ? searching : browseLoading

    return (
        <section className="flex flex-col gap-3 min-h-0">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    aria-label="Buscar producto para vender"
                    disabled={disabled}
                    placeholder="Buscar por nombre o escanear código…"
                    value={query}
                    onChange={e => onQueryChange(e.target.value)}
                    className="pl-9 pr-9 h-11 text-base"
                    autoFocus
                />
                {searching ? (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                ) : query ? (
                    <button
                        type="button"
                        aria-label="Limpiar búsqueda"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => onQueryChange("")}
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : null}
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
                <Button
                    type="button"
                    size="xs"
                    variant={categoryId === "" ? "default" : "outline"}
                    className="rounded-full shrink-0"
                    onClick={() => setCategoryId("")}
                >
                    Todos
                </Button>
                {categories.map(c => (
                    <Button
                        key={c.id}
                        type="button"
                        size="xs"
                        variant={categoryId === c.id ? "default" : "outline"}
                        className="rounded-full shrink-0"
                        onClick={() => setCategoryId(c.id)}
                    >
                        {c.name}
                    </Button>
                ))}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            ) : shownProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
                    <PackageSearch className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm">
                        {searchingMode ? "Sin resultados para esta búsqueda" : "No hay productos en esta categoría"}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2">
                    {shownProducts.map(p => (
                        <ProductCard
                            key={p.id}
                            product={p}
                            workshopActive={workshopActive}
                            disabled={disabled}
                            onAdd={onAdd}
                        />
                    ))}
                </div>
            )}

            {!searchingMode && nextCursor && (
                <div className="flex justify-center pt-1">
                    <Button
                        type="button" variant="outline" size="sm"
                        disabled={loadingMore}
                        onClick={() => void loadBrowse(nextCursor, true)}
                    >
                        {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Cargar más productos
                    </Button>
                </div>
            )}
        </section>
    )
}
