"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Image from "next/image"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Pagination } from "@/components/ui/pagination"
import { EmptyState } from "@/components/admin/empty-state"
import { ExportButton } from "@/components/admin/export-button"
import {
    readPreferredBranchId,
    StockQtyEditor,
} from "@/components/admin/productos/stock-editor"
import { ProductoFormDialog, type MarketVisibility } from "@/components/admin/inventario/producto-form"
import { TraspasoBuscarDialog } from "@/components/admin/inventario/traspaso-buscar-dialog"
import { MermaDialog } from "@/components/admin/inventario/merma-dialog"
import { EtiquetasDialog } from "@/components/admin/inventario/etiquetas-dialog"
import { ConteoPanel } from "@/components/admin/inventario/conteo-panel"
import { CapturaRapidaPanel } from "@/components/admin/productos/captura-rapida"
import { CategoriesPanel } from "@/app/admin/categorias/panel"
import { BrandsPanel } from "@/app/admin/marcas/panel"
import { ModelsPanel } from "@/app/admin/modelos/panel"

import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { useCurrency } from "@/components/currency-provider"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    AlertTriangle,
    ArrowLeftRight,
    ClipboardList,
    Download,
    Edit,
    Eye,
    EyeOff,
    FolderTree,
    History,
    Loader2,
    Package,
    PackagePlus,
    PackageX,
    Plus,
    Printer,
    QrCode,
    ScanBarcode,
    Search,
    Store,
    Upload,
    Users,
    X,
    Zap,
} from "lucide-react"

interface ProductModelRef {
    model: { id: string; name: string; brand: { name: string } }
}

/** Producto tal como lo devuelve GET /api/products para staff (productDto). */
interface StockProductItem {
    id: string
    name: string
    barcode: string | null
    retailPrice: number
    wholesalePrice?: number
    internalPrice?: number | null
    /** Solo llega a ADMIN. */
    costPrice?: number | null
    marketVisibility?: MarketVisibility
    stock: number
    minStock: number
    images: string[]
    isUniversal: boolean
    models?: ProductModelRef[]
    category: { name: string } | null
    stocks?: { branchId: string; quantity: number; branch: { id: string; name: string } }[]
}

interface CategoryOption {
    id: string
    name: string
}

interface StockPanelProps {
    /** Rol y sucursal base del usuario que opera (viene del server component). */
    viewer: { role: string; homeBranchId: string | null }
    branches: { id: string; name: string }[]
    /** Al cambiar, recarga la lista (p.ej. tras una entrada rápida desde otra pestaña). */
    refreshKey?: number
}

type VisibilidadFiltro = "todos" | "publicos" | "aliados" | "ocultos"

const VISIBILIDAD_FILTROS: { value: VisibilidadFiltro; label: string }[] = [
    { value: "todos", label: "Todos" },
    { value: "publicos", label: "Público" },
    { value: "aliados", label: "Aliados" },
    { value: "ocultos", label: "Ocultos" },
]

const VISIBILIDAD_BADGE: Record<MarketVisibility, { label: string; icon: typeof Eye; className: string }> = {
    PUBLIC: { label: "Público", icon: Eye, className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300" },
    ALLIES: { label: "Aliados", icon: Users, className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300" },
    HIDDEN: { label: "Oculto", icon: EyeOff, className: "bg-muted text-muted-foreground border-border" },
}

const DEFAULT_LIMIT = 20
const SUBTABS_CLASIFICACION = ["categorias", "marcas", "modelos"] as const

export function StockPanel({ viewer, branches, refreshKey = 0 }: StockPanelProps) {
    const { formatPrice } = useCurrency()
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()

    const isAdmin = viewer.role === "ADMIN"
    // El empleado opera solo su sucursal; el admin elige la "sucursal de trabajo".
    const lockedBranchId = isAdmin ? null : viewer.homeBranchId
    const [chosenBranchId, setWorkBranchId] = useState<string | null>(null)
    // Sin efecto: la sucursal de trabajo del admin se deriva en render —
    // la elegida a mano, o la preferida guardada, o la primera activa.
    const actionBranchId = isAdmin
        ? (chosenBranchId && branches.some((b) => b.id === chosenBranchId) ? chosenBranchId
            : (() => { const preferred = readPreferredBranchId(); return preferred && branches.some((b) => b.id === preferred) ? preferred : branches[0]?.id ?? null })())
        : lockedBranchId
    const actionBranchName = branches.find((b) => b.id === actionBranchId)?.name ?? ""

    // --- Filtros persistidos en la URL -------------------------------------
    const search = searchParams.get("search") ?? ""
    const categoryId = searchParams.get("categoryId") ?? ""
    const visibilidadParam = searchParams.get("visibilidad")
    const visibilidad: VisibilidadFiltro =
        visibilidadParam === "publicos" || visibilidadParam === "aliados" || visibilidadParam === "ocultos"
            ? visibilidadParam : "todos"
    const lowStock = searchParams.get("lowStock") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))

    // --- Diálogos dirigidos por la URL (cubren los redirects de /productos) --
    const nuevoOpen = searchParams.get("nuevo") === "1"
    const editarId = searchParams.get("editar")
    const capturaOpen = searchParams.get("captura") === "1"
    const initialBarcode = searchParams.get("codigo")
    const herramientaParam = searchParams.get("herramienta")
    const herramienta = herramientaParam === "clasificacion" || herramientaParam === "etiquetas" ? herramientaParam : null
    const subParam = searchParams.get("sub")
    const subClasificacion = (SUBTABS_CLASIFICACION as readonly string[]).includes(subParam ?? "") ? (subParam as (typeof SUBTABS_CLASIFICACION)[number]) : "categorias"

    // --- Diálogos con estado local ------------------------------------------
    const [mermaOpen, setMermaOpen] = useState(false)
    const [traspasoOpen, setTraspasoOpen] = useState(false)
    const [importOpen, setImportOpen] = useState(false)

    // --- Etiquetas imprimibles ------------------------------------------------
    const [etiquetasOpen, setEtiquetasOpen] = useState(false)
    const [etiquetasProducts, setEtiquetasProducts] = useState<StockProductItem[]>([])
    // Multi-selección por id → producto completo: sobrevive a cambios de página/filtro.
    const [labelSelected, setLabelSelected] = useState<Map<string, StockProductItem>>(new Map())

    // --- Conteo físico -------------------------------------------------------
    const [countDialogOpen, setCountDialogOpen] = useState(false)
    const [countBranchId, setCountBranchId] = useState("")
    const [countNotes, setCountNotes] = useState("")
    const [countBlind, setCountBlind] = useState(false)
    const [creatingCount, setCreatingCount] = useState(false)
    const [focusCountId, setFocusCountId] = useState<string | null>(null)
    const [countsRefreshKey, setCountsRefreshKey] = useState(0)
    const createCountOp = useRef<ClientOperationKey | null>(null)

    // --- Datos ---------------------------------------------------------------
    const [products, setProducts] = useState<StockProductItem[]>([])
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(1)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [categories, setCategories] = useState<CategoryOption[]>([])

    // Búsqueda con debounce: el input vive en estado local y viaja a la URL.
    const [searchInput, setSearchInput] = useState(search)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const setParams = useCallback((patch: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString())
        for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") params.delete(key)
            else params.set(key, value)
        }
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, [pathname, router, searchParams])

    useEffect(() => {
        if (searchInput === search) return
        debounceRef.current = setTimeout(() => setParams({ search: searchInput.trim() || null, page: null }), 350)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput])

    const fetchProducts = useCallback(async (signal?: AbortSignal) => {
        setLoading(true)
        setLoadError(null)
        try {
            const params = new URLSearchParams()
            if (search) params.set("search", search)
            if (categoryId) params.set("categoryId", categoryId)
            if (visibilidad !== "todos") params.set("visibilidad", visibilidad)
            if (lowStock) params.set("lowStock", "true")
            params.set("page", String(page))
            params.set("limit", String(limit))
            const res = await fetch(`/api/products?${params}`, { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los productos")
            if (signal?.aborted) return
            if (data && typeof data === "object" && "products" in data) {
                setProducts(data.products ?? [])
                setTotal(data.total ?? 0)
                setTotalPages(data.totalPages ?? 1)
            } else {
                setProducts(Array.isArray(data) ? data : [])
                setTotal(Array.isArray(data) ? data.length : 0)
                setTotalPages(1)
            }
        } catch {
            if (!signal?.aborted) setLoadError("No se pudieron cargar los productos. Revisa tu conexión y vuelve a intentar.")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [search, categoryId, visibilidad, lowStock, page, limit])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchProducts(controller.signal))
        return () => controller.abort()
        // refreshKey: recarga externa (entrada rápida desde otra pestaña, etc.).
         
    }, [fetchProducts, refreshKey])

    useEffect(() => {
        fetch("/api/categories")
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => setCategories(Array.isArray(data) ? data : []))
            .catch(() => {})
    }, [])

    // --- Reflejar ajustes inline sin recargar --------------------------------
    const applyStockDelta = (productId: string, branchId: string | null, delta: number) => {
        setProducts((prev) =>
            prev.map((p) => {
                if (p.id !== productId) return p
                const stocks = [...(p.stocks ?? [])]
                if (branchId) {
                    const idx = stocks.findIndex((s) => s.branchId === branchId)
                    if (idx >= 0) {
                        stocks[idx] = { ...stocks[idx], quantity: stocks[idx].quantity + delta }
                    } else {
                        const branch = branches.find((b) => b.id === branchId)
                        stocks.push({ branchId, quantity: delta, branch: { id: branchId, name: branch?.name ?? "" } })
                    }
                }
                return { ...p, stock: p.stock + delta, stocks }
            })
        )
    }

    const branchQtyOf = (product: StockProductItem): number => {
        if (!actionBranchId || !product.stocks) return product.stock
        return product.stocks.find((s) => s.branchId === actionBranchId)?.quantity ?? 0
    }

    const getModelText = (product: StockProductItem) => {
        if (product.isUniversal) return "Universal"
        const list = product.models ?? []
        return list
            .slice(0, 2)
            .map((pm) => `${pm.model.brand.name} ${pm.model.name}`)
            .join(", ") + (list.length > 2 ? ` +${list.length - 2}` : "")
    }

    const getStockVariant = (product: StockProductItem): "destructive" | "warning" | "success" => {
        if (product.stock === 0) return "destructive"
        if (product.stock <= product.minStock) return "warning"
        return "success"
    }

    // --- Acciones ------------------------------------------------------------
    const openEtiquetas = (items: StockProductItem[]) => {
        if (items.length === 0) return
        setEtiquetasProducts(items)
        setEtiquetasOpen(true)
    }

    const toggleLabelSelected = (product: StockProductItem) => {
        setLabelSelected((prev) => {
            const next = new Map(prev)
            if (next.has(product.id)) next.delete(product.id)
            else next.set(product.id, product)
            return next
        })
    }

    const openCountDialog = () => {
        setCountBranchId(actionBranchId ?? branches[0]?.id ?? "")
        setCountNotes("")
        setCountBlind(false)
        setCountDialogOpen(true)
    }

    const createCount = async () => {
        if (creatingCount) return
        if (!countBranchId) return toast.error("Selecciona la sucursal a contar.")
        const payload = { branchId: countBranchId, notes: countNotes.trim() || undefined, blind: countBlind }
        createCountOp.current = getClientOperationKey(createCountOp.current, payload)
        setCreatingCount(true)
        try {
            const res = await fetch("/api/inventory/counts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: createCountOp.current.key }),
            })
            const json = await res.json().catch(() => null)
            if (!res.ok) throw new Error(json?.error || "No se pudo abrir el conteo.")
            createCountOp.current = null
            toast.success(`Conteo ${json?.folio ?? ""} abierto`, {
                description: `Captura lo que hay físicamente en ${json?.count?.branch?.name ?? "la sucursal"}.`,
            })
            setCountDialogOpen(false)
            setFocusCountId(json?.count?.id ?? null)
            setCountsRefreshKey((k) => k + 1)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta abrir el conteo.")
        } finally {
            setCreatingCount(false)
        }
    }

    const [exporting, setExporting] = useState(false)
    const [importing, setImporting] = useState(false)
    const [importResult, setImportResult] = useState<{ message: string; errors: string[] } | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleExport = async () => {
        setExporting(true)
        try {
            const res = await fetch("/api/products/excel")
            if (!res.ok) throw new Error("Error al exportar")
            const blob = await res.blob()
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `productos_${new Date().toISOString().split("T")[0]}.xlsx`
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
            a.remove()
        } catch {
            toast.error("Error al exportar productos. Reintenta en un momento.")
        } finally {
            setExporting(false)
        }
    }

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setImporting(true)
        setImportResult(null)
        try {
            const formData = new FormData()
            formData.append("file", file)
            const res = await fetch("/api/products/excel", { method: "POST", body: formData })
            const data = await res.json()
            if (!res.ok) {
                setImportResult({ message: data.error || "Error al importar", errors: [] })
            } else {
                setImportResult({ message: data.message, errors: data.errors || [] })
                void fetchProducts()
            }
        } catch {
            setImportResult({ message: "Error al importar archivo", errors: [] })
        } finally {
            setImporting(false)
            if (fileInputRef.current) fileInputRef.current.value = ""
        }
    }

    const hasFilters = search !== "" || categoryId !== "" || visibilidad !== "todos" || lowStock

    return (
        <div className="space-y-4">
            {/* Acciones globales sobre la lista */}
            <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setParams({ nuevo: "1" })}>
                    <Plus className="mr-2 h-4 w-4" />
                    Dar de alta
                </Button>
                <Button variant="outline" onClick={() => setParams({ entrada: "1" })}>
                    <PackagePlus className="mr-2 h-4 w-4" />
                    Entrada rápida
                </Button>
                {branches.length >= 2 && (
                    <Button variant="outline" onClick={() => setTraspasoOpen(true)}>
                        <ArrowLeftRight className="mr-2 h-4 w-4" />
                        <span className="hidden sm:inline">Mover entre sucursales</span>
                        <span className="sm:hidden">Mover</span>
                    </Button>
                )}
                <Button variant="outline" onClick={() => setMermaOpen(true)}>
                    <PackageX className="mr-2 h-4 w-4" />
                    Merma
                </Button>
                <Button variant="outline" onClick={openCountDialog} disabled={branches.length === 0}>
                    <ClipboardList className="mr-2 h-4 w-4" />
                    <span className="hidden sm:inline">Conteo físico</span>
                    <span className="sm:hidden">Conteo</span>
                </Button>
                {labelSelected.size > 0 && (
                    <>
                        <Button
                            variant="outline"
                            onClick={() => openEtiquetas(Array.from(labelSelected.values()))}
                        >
                            <Printer className="mr-2 h-4 w-4" />
                            Imprimir etiquetas ({labelSelected.size})
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            title="Limpiar selección de etiquetas"
                            aria-label="Limpiar selección de etiquetas"
                            onClick={() => setLabelSelected(new Map())}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </>
                )}

                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setParams({ captura: "1" })}>
                        <Zap className="mr-1 h-4 w-4" />
                        Captura rápida
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setParams({ herramienta: "clasificacion" })}>
                        <FolderTree className="mr-1 h-4 w-4" />
                        Clasificación
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setParams({ herramienta: "etiquetas" })}>
                        <QrCode className="mr-1 h-4 w-4" />
                        Etiquetas
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                        <Upload className="mr-1 h-4 w-4" />
                        <span className="hidden sm:inline">Importar</span>
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                        {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
                        <span className="hidden sm:inline">Exportar</span>
                    </Button>
                    <ExportButton type="products" label="CSV" />
                </div>
            </div>

            {/* Sucursal de trabajo: el empleado la tiene fija, el admin elige. */}
            <div className="flex items-center gap-2 text-sm">
                <ScanBarcode className="h-4 w-4 text-muted-foreground" />
                {isAdmin ? (
                    <>
                        <span className="text-muted-foreground">Operando en:</span>
                        <Select value={actionBranchId ?? ""} onValueChange={setWorkBranchId}>
                            <SelectTrigger className="h-8 w-auto min-w-40">
                                <SelectValue placeholder="Sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </>
                ) : (
                    <span className="text-muted-foreground">
                        Operando en: <span className="font-medium text-foreground">{actionBranchName || "tu sucursal"}</span>
                    </span>
                )}
            </div>

            {/* Filtros */}
            <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1 sm:max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Buscar por nombre o código..."
                            aria-label="Buscar productos por nombre o código"
                            className="pl-9"
                        />
                    </div>
                    <Select
                        value={categoryId || "ALL"}
                        onValueChange={(v) => setParams({ categoryId: v === "ALL" ? null : v, page: null })}
                    >
                        <SelectTrigger className="w-full sm:w-52">
                            <SelectValue placeholder="Categoría" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">Todas las categorías</SelectItem>
                            {categories.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant={lowStock ? "default" : "outline"}
                        size="sm"
                        className="self-start sm:self-center"
                        onClick={() => setParams({ lowStock: lowStock ? null : "true", page: null })}
                    >
                        <AlertTriangle className="mr-1 h-4 w-4" />
                        Stock bajo
                    </Button>
                </div>

                {/* Chips de visibilidad en el mercado → ?visibilidad= */}
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
                        <Store className="h-3.5 w-3.5" />
                        Visibilidad
                    </span>
                    {VISIBILIDAD_FILTROS.map((f) => (
                        <Button
                            key={f.value}
                            variant={visibilidad === f.value ? "default" : "outline"}
                            size="sm"
                            onClick={() => setParams({ visibilidad: f.value === "todos" ? null : f.value, page: null })}
                        >
                            {f.label}
                        </Button>
                    ))}
                </div>
            </div>

            {/* Lista única de productos */}
            {loadError ? (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{loadError}</p>
                    <Button variant="outline" onClick={() => void fetchProducts()}>Reintentar</Button>
                </div>
            ) : loading && products.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : products.length === 0 ? (
                <EmptyState
                    icon={Package}
                    title="No se encontraron productos"
                    description={hasFilters ? "Prueba con otros filtros o limpia la búsqueda." : "Agrega tu primer producto al inventario."}
                    action={!hasFilters ? { label: "Dar de alta el primer producto", href: `${pathname}?tab=stock&nuevo=1`, icon: Plus } : undefined}
                />
            ) : (
                <div className="space-y-2">
                    {/* Encabezado de columnas (desktop) */}
                    <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        <div className="col-span-4">Producto</div>
                        <div className="col-span-2">Categoría</div>
                        <div className="col-span-3">Existencias por sucursal</div>
                        <div className="col-span-1 text-center">Total</div>
                        <div className="col-span-1 text-right">Público</div>
                        <div className="col-span-1 text-right">Acciones</div>
                    </div>

                    {products.map((product) => {
                        const badge = VISIBILIDAD_BADGE[product.marketVisibility ?? "HIDDEN"]
                        const VisIcon = badge.icon
                        return (
                            <Card key={product.id} className={cn("hover:shadow-md transition-shadow", loading && "opacity-60")}>
                                <CardContent className="p-0">
                                    <div className="grid grid-cols-12 gap-4 items-center p-4">
                                        {/* Foto + nombre + visibilidad */}
                                        <div className="col-span-12 md:col-span-4 flex items-center gap-3 min-w-0">
                                            <Checkbox
                                                checked={labelSelected.has(product.id)}
                                                onCheckedChange={() => toggleLabelSelected(product)}
                                                aria-label={`Seleccionar ${product.name} para imprimir etiquetas`}
                                                title="Seleccionar para etiquetas"
                                                className="flex-shrink-0"
                                            />
                                            <div className="w-12 h-12 relative bg-muted rounded-lg flex-shrink-0 overflow-hidden">
                                                {product.images[0] ? (
                                                    <Image
                                                        src={product.images[0]}
                                                        alt={product.name}
                                                        fill
                                                        sizes="48px"
                                                        className="object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex items-center justify-center h-full">
                                                        <Package className="h-5 w-5 text-muted-foreground/30" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h3 className="font-medium truncate">{product.name}</h3>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {getModelText(product)}
                                                    {product.barcode ? ` · ${product.barcode}` : ""}
                                                </p>
                                                <Badge variant="outline" className={cn("mt-1 text-[10px] gap-1 font-normal", badge.className)}>
                                                    <VisIcon className="h-3 w-3" />
                                                    {badge.label}
                                                </Badge>
                                            </div>
                                        </div>

                                        {/* Categoría */}
                                        <div className="col-span-4 md:col-span-2">
                                            <Badge variant="outline" className="text-xs font-normal">
                                                {product.category?.name ?? "—"}
                                            </Badge>
                                        </div>

                                        {/* Chips por sucursal + editor inline */}
                                        <div className="col-span-4 md:col-span-3">
                                            {product.stocks && product.stocks.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {product.stocks.map((s) => (
                                                        <span
                                                            key={s.branchId}
                                                            className={cn(
                                                                "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums",
                                                                s.branchId === actionBranchId && "ring-1 ring-primary/50",
                                                                s.quantity <= 0 && "text-muted-foreground/60"
                                                            )}
                                                        >
                                                            {s.branch.name} {s.quantity}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">Sin existencias</span>
                                            )}
                                        </div>

                                        {/* Total + ajuste inline sobre la sucursal de trabajo */}
                                        <div className="col-span-4 md:col-span-1 text-left md:text-center">
                                            <Badge variant={getStockVariant(product)} title="Total en todas las sucursales">
                                                {product.stock}
                                            </Badge>
                                            <div className="mt-1 flex md:justify-center">
                                                <StockQtyEditor
                                                    productId={product.id}
                                                    productName={product.name}
                                                    quantity={branchQtyOf(product)}
                                                    branchId={actionBranchId}
                                                    reason={`Ajuste rápido en ${actionBranchName || "sucursal"}`}
                                                    onAdjusted={(delta) => applyStockDelta(product.id, actionBranchId, delta)}
                                                />
                                            </div>
                                        </div>

                                        {/* Precio público */}
                                        <div className="col-span-4 md:col-span-1 text-left md:text-right">
                                            <span className="text-xs text-muted-foreground md:hidden">Público: </span>
                                            <span className="font-bold text-primary">{formatPrice(product.retailPrice)}</span>
                                        </div>

                                        {/* Acciones por producto */}
                                        <div className="col-span-8 md:col-span-1 flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                title={`Imprimir etiquetas de ${product.name}`}
                                                aria-label={`Imprimir etiquetas de ${product.name}`}
                                                onClick={() => openEtiquetas([product])}
                                            >
                                                <QrCode className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8"
                                                onClick={() => setParams({ editar: product.id })}
                                            >
                                                <Edit className="h-4 w-4 mr-1" />
                                                Editar
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8"
                                                title={`Ver historial de ${product.name}`}
                                                aria-label={`Ver historial de ${product.name}`}
                                                onClick={() => {
                                                    const params = new URLSearchParams()
                                                    params.set("tab", "historial")
                                                    params.set("producto", product.id)
                                                    params.set("pnombre", product.name)
                                                    router.push(`${pathname}?${params}`)
                                                }}
                                            >
                                                <History className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {!loading && !loadError && products.length > 0 && (
                <div className="pt-4 border-t">
                    <Pagination
                        page={page}
                        limit={limit}
                        total={total}
                        totalPages={totalPages}
                        query={{
                            tab: "stock",
                            ...(search && { search }),
                            ...(categoryId && { categoryId }),
                            ...(visibilidad !== "todos" && { visibilidad }),
                            ...(lowStock && { lowStock: "true" }),
                        }}
                    />
                </div>
            )}

            {/* Sesiones de conteo físico (abiertas e historial) */}
            <ConteoPanel
                focusCountId={focusCountId}
                refreshKey={countsRefreshKey}
                onChanged={() => void fetchProducts()}
            />

            {/* Diálogo: alta / edición de producto */}
            <ProductoFormDialog
                open={nuevoOpen || editarId !== null}
                onOpenChange={(o) => { if (!o) setParams({ nuevo: null, editar: null, codigo: null }) }}
                productId={editarId}
                initialBarcode={initialBarcode}
                isAdmin={isAdmin}
                branches={branches}
                lockedBranchId={lockedBranchId}
                onSaved={() => void fetchProducts()}
            />

            {/* Diálogo: traspaso entre sucursales con búsqueda de producto */}
            <TraspasoBuscarDialog
                branches={branches}
                lockedFromId={lockedBranchId}
                open={traspasoOpen}
                onOpenChange={setTraspasoOpen}
                onSaved={() => void fetchProducts()}
            />

            {/* Diálogo: merma */}
            <MermaDialog
                branches={branches}
                lockedBranchId={lockedBranchId}
                open={mermaOpen}
                onOpenChange={setMermaOpen}
                onSaved={() => void fetchProducts()}
            />

            {/* Diálogo: captura rápida en serie (alta masiva) */}
            <Dialog open={capturaOpen} onOpenChange={(o) => { if (!o) { setParams({ captura: null }); void fetchProducts() } }}>
                <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Zap className="h-5 w-5 text-muted-foreground" />
                            Captura rápida
                        </DialogTitle>
                        <DialogDescription>
                            Alta en serie de productos: escanea el código y captura.
                        </DialogDescription>
                    </DialogHeader>
                    {capturaOpen && <CapturaRapidaPanel />}
                </DialogContent>
            </Dialog>

            {/* Diálogo: clasificación del catálogo (categorías/marcas/modelos) */}
            <Dialog open={herramienta === "clasificacion"} onOpenChange={(o) => { if (!o) setParams({ herramienta: null, sub: null }) }}>
                <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <FolderTree className="h-5 w-5 text-muted-foreground" />
                            Clasificación
                        </DialogTitle>
                        <DialogDescription>
                            Organiza tus productos por tipo de refacción, marca y modelo de equipo.
                        </DialogDescription>
                    </DialogHeader>
                    <Tabs
                        value={subClasificacion}
                        onValueChange={(v) => setParams({ herramienta: "clasificacion", sub: v })}
                        className="w-full"
                    >
                        <TabsList className="mb-4">
                            <TabsTrigger value="categorias">Categorías</TabsTrigger>
                            <TabsTrigger value="marcas">Marcas</TabsTrigger>
                            <TabsTrigger value="modelos">Modelos</TabsTrigger>
                        </TabsList>
                        <TabsContent value="categorias" className="mt-0">
                            <CategoriesPanel embedded />
                        </TabsContent>
                        <TabsContent value="marcas" className="mt-0">
                            <BrandsPanel embedded />
                        </TabsContent>
                        <TabsContent value="modelos" className="mt-0">
                            <ModelsPanel embedded />
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>

            {/* Diálogo único de etiquetas imprimibles (QR + nombre + precio):
                desde la fila del producto, la selección múltiple del stock, o
                la herramienta "Etiquetas" (abre vacío para buscar y agregar). */}
            <EtiquetasDialog
                open={etiquetasOpen || herramienta === "etiquetas"}
                onOpenChange={(o) => {
                    if (!o) {
                        setEtiquetasOpen(false)
                        if (herramienta === "etiquetas") setParams({ herramienta: null })
                    }
                }}
                products={etiquetasOpen ? etiquetasProducts : []}
            />

            {/* Diálogo: importar desde Excel */}
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Importar productos desde Excel</DialogTitle>
                        <DialogDescription>
                            Sube un archivo .xlsx con los productos. Los productos con ID existente se actualizarán.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx,.xls"
                            onChange={handleImport}
                            className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                            disabled={importing}
                        />
                        {importing && (
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Importando...
                            </div>
                        )}
                        {importResult && (
                            <div className={`p-3 rounded-lg border ${importResult.errors.length > 0 ? "bg-destructive/5 border-destructive/20 text-destructive" : "bg-primary/5 border-primary/20 text-foreground"}`} role="status">
                                <p className="font-medium">{importResult.message}</p>
                                {importResult.errors.length > 0 && (
                                    <ul className="mt-2 text-sm text-muted-foreground list-disc list-inside">
                                        {importResult.errors.map((err, i) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setImportOpen(false)}>Cerrar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Diálogo: iniciar conteo físico */}
            <Dialog open={countDialogOpen} onOpenChange={setCountDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ClipboardList className="h-5 w-5 text-muted-foreground" />
                            Nuevo conteo físico
                        </DialogTitle>
                        <DialogDescription>
                            Captura lo que hay realmente en la sucursal; al aplicar, el sistema
                            ajusta las diferencias y las deja auditadas en el historial.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="conteo-branch">Sucursal a contar</Label>
                            {lockedBranchId ? (
                                <p className="h-10 flex items-center rounded-md border bg-muted/40 px-3 text-sm">
                                    {branches.find((b) => b.id === countBranchId)?.name ?? actionBranchName ?? "Mi sucursal"}
                                </p>
                            ) : (
                                <Select value={countBranchId} onValueChange={setCountBranchId}>
                                    <SelectTrigger id="conteo-branch">
                                        <SelectValue placeholder="Sucursal" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="conteo-notes">Notas (opcional)</Label>
                            <Input
                                id="conteo-notes"
                                placeholder="Ej: conteo de fin de mes, auditoría sorpresa…"
                                value={countNotes}
                                onChange={(e) => setCountNotes(e.target.value)}
                                maxLength={1000}
                            />
                        </div>
                        <div className="flex items-start gap-2">
                            <Checkbox
                                id="conteo-blind"
                                checked={countBlind}
                                onCheckedChange={(v) => setCountBlind(v === true)}
                            />
                            <Label htmlFor="conteo-blind" className="text-sm font-normal leading-tight cursor-pointer">
                                Conteo ciego — el contador no ve el stock esperado
                            </Label>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setCountDialogOpen(false)} disabled={creatingCount}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void createCount()} disabled={creatingCount || !countBranchId}>
                            {creatingCount
                                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : <ClipboardList className="mr-2 h-4 w-4" />}
                            Abrir conteo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
