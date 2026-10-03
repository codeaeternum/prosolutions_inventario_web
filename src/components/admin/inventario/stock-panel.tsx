"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { FotosImportDialog } from "@/components/admin/inventario/fotos-import-dialog"
import { CapturaRapidaPanel } from "@/components/admin/productos/captura-rapida"
import { CategoriesPanel } from "@/app/admin/categorias/panel"
import { BrandsPanel } from "@/app/admin/marcas/panel"
import { ModelsPanel } from "@/app/admin/modelos/panel"

import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { guardedClose } from "@/lib/dialog-guard"
import { useCurrency } from "@/components/currency-provider"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
    AlertTriangle,
    ArrowLeftRight,
    ClipboardList,
    Download,
    Edit,
    Ellipsis,
    Eye,
    EyeOff,
    FilterX,
    FolderTree,
    History,
    ImagePlus,
    LayoutGrid,
    List,
    Loader2,
    Package,
    PackagePlus,
    PackageX,
    Percent,
    Plus,
    Printer,
    QrCode,
    Rows3,
    Search,
    SlidersHorizontal,
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
type VistaStock = "lista" | "mosaico" | "compacta"

const VISTA_STORAGE_KEY = "inv-stock-vista"
const VISTAS: { value: VistaStock; label: string; icon: typeof List; title: string }[] = [
    { value: "lista", label: "Lista", icon: List, title: "Vista lista — detalle completo por fila" },
    { value: "mosaico", label: "Mosaico", icon: LayoutGrid, title: "Vista mosaico — fotos grandes para identificar piezas" },
    { value: "compacta", label: "Compacta", icon: Rows3, title: "Vista compacta — más productos por pantalla" },
]

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

// Placeholder de foto: tinte determinista por categoría (misma categoría =
// mismo color en toda la app) + inicial, para distinguir piezas sin imagen.
const CATEGORY_TINTS = [
    "bg-sky-100 text-sky-600 dark:bg-sky-950/70 dark:text-sky-400",
    "bg-violet-100 text-violet-600 dark:bg-violet-950/70 dark:text-violet-400",
    "bg-amber-100 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400",
    "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400",
    "bg-rose-100 text-rose-600 dark:bg-rose-950/70 dark:text-rose-400",
    "bg-cyan-100 text-cyan-600 dark:bg-cyan-950/70 dark:text-cyan-400",
    "bg-orange-100 text-orange-600 dark:bg-orange-950/70 dark:text-orange-400",
    "bg-indigo-100 text-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-400",
]
function categoryTint(name: string | null | undefined) {
    if (!name) return "bg-muted text-muted-foreground/40"
    const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0)
    return CATEGORY_TINTS[hash % CATEGORY_TINTS.length]
}
function CategoryPlaceholder({ name, letterCls, iconCls }: { name: string | null | undefined; letterCls: string; iconCls: string }) {
    const initial = name?.trim().charAt(0).toUpperCase()
    return (
        <div className={cn("flex h-full w-full items-center justify-center", categoryTint(name))}>
            {initial ? <span className={cn("font-semibold", letterCls)}>{initial}</span> : <Package className={iconCls} />}
        </div>
    )
}

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
    // Filtros de salud del catálogo (el API solo los honra para staff).
    const sinPrecio = searchParams.get("sinPrecio") === "true"
    const sinFoto = searchParams.get("sinFoto") === "true"
    const sinCompat = searchParams.get("sinCompat") === "true"
    const sinStockF = searchParams.get("sinStock") === "true"
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
    const [fotosOpen, setFotosOpen] = useState(false)

    // --- Etiquetas imprimibles ------------------------------------------------
    const [etiquetasOpen, setEtiquetasOpen] = useState(false)
    const [etiquetasProducts, setEtiquetasProducts] = useState<StockProductItem[]>([])
    // Multi-selección por id → producto completo: sobrevive a cambios de página/filtro.
    const [labelSelected, setLabelSelected] = useState<Map<string, StockProductItem>>(new Map())
    // Ajuste masivo de precios sobre la selección (checkbox de cada fila).
    const [bulkOpen, setBulkOpen] = useState(false)
    // La barra de selección va en portal a body: hay ancestros con transform
    // que convertirían el `fixed` en `absolute` (quedaba fuera del viewport).
    const [barMounted, setBarMounted] = useState(false)
    useEffect(() => {
        // Diferido: setState sincrónico en efecto está prohibido por la regla.
        void Promise.resolve().then(() => setBarMounted(true))
    }, [])
    const [bulkMode, setBulkMode] = useState<"set" | "percent">("set")
    const [bulkRetail, setBulkRetail] = useState("")
    const [bulkWholesale, setBulkWholesale] = useState("")
    const [bulkCost, setBulkCost] = useState("")
    const [bulkPercent, setBulkPercent] = useState("")
    const [bulkBusy, setBulkBusy] = useState(false)
    const bulkOp = useRef<ClientOperationKey | null>(null)

    // --- Conteo físico -------------------------------------------------------
    const [countDialogOpen, setCountDialogOpen] = useState(false)
    const [countBranchId, setCountBranchId] = useState("")
    const [countNotes, setCountNotes] = useState("")
    const [countBlind, setCountBlind] = useState(false)
    const [creatingCount, setCreatingCount] = useState(false)
    const [focusCountId, setFocusCountId] = useState<string | null>(null)
    const [countsRefreshKey, setCountsRefreshKey] = useState(0)
    const createCountOp = useRef<ClientOperationKey | null>(null)

    // --- Vista de la lista: lista | mosaico | compacta (preferencia local) ---
    // useSyncExternalStore lee localStorage sin efecto: el SSR siempre pinta
    // "lista" (getServerSnapshot) y el cliente hidrata con lo guardado.
    const vistaGuardada = useSyncExternalStore(
        useCallback((onStoreChange: () => void) => {
            window.addEventListener("storage", onStoreChange)
            window.addEventListener("inv-stock-vista", onStoreChange)
            return () => {
                window.removeEventListener("storage", onStoreChange)
                window.removeEventListener("inv-stock-vista", onStoreChange)
            }
        }, []),
        () => window.localStorage.getItem(VISTA_STORAGE_KEY),
        () => null,
    )
    const vista: VistaStock = vistaGuardada === "mosaico" || vistaGuardada === "compacta" ? vistaGuardada : "lista"
    const cambiarVista = (v: VistaStock) => {
        window.localStorage.setItem(VISTA_STORAGE_KEY, v)
        window.dispatchEvent(new Event("inv-stock-vista"))
    }

    // --- Datos ---------------------------------------------------------------
    interface InventoryStats { productos: number; unidades: number; bajoMinimo: number; sinStock: number; sinPrecio: number; sinFoto: number; sinCompat: number }
    const [stats, setStats] = useState<InventoryStats | null>(null)
    const [products, setProducts] = useState<StockProductItem[]>([])
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(1)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [categories, setCategories] = useState<CategoryOption[]>([])

    // Búsqueda con debounce: el input vive en estado local y viaja a la URL.
    const [searchInput, setSearchInput] = useState(search)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const searchRef = useRef<HTMLInputElement>(null)

    // "/" enfoca el buscador desde cualquier punto de la pantalla.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null
            if (e.key !== "/" || !t) return
            if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return
            e.preventDefault()
            searchRef.current?.focus()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [])

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
            if (sinPrecio) params.set("sinPrecio", "true")
            if (sinFoto) params.set("sinFoto", "true")
            if (sinCompat) params.set("sinCompat", "true")
            if (sinStockF) params.set("sinStock", "true")
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
                setStats(data.stats ?? null)
            } else {
                setProducts(Array.isArray(data) ? data : [])
                setTotal(Array.isArray(data) ? data.length : 0)
                setTotalPages(1)
                setStats(null)
            }
        } catch {
            if (!signal?.aborted) setLoadError("No se pudieron cargar los productos. Revisa tu conexión y vuelve a intentar.")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [search, categoryId, visibilidad, lowStock, sinPrecio, sinFoto, sinCompat, sinStockF, page, limit])

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
        // Mismo criterio que el SQL del API: bajoMinimo = stock <= minStock,
        // sinStock = stock = 0, unidades = Σ stock. Se actualiza optimista para
        // que los chips no queden viejos tras el ajuste rápido.
        setStats((prev) => {
            if (!prev) return prev
            const p = products.find((x) => x.id === productId)
            if (!p) return { ...prev, unidades: prev.unidades + delta }
            const before = p.stock
            const after = before + delta
            const crossedLow = (before <= p.minStock) !== (after <= p.minStock)
            const crossedEmpty = (before === 0) !== (after === 0)
            return {
                ...prev,
                unidades: prev.unidades + delta,
                bajoMinimo: prev.bajoMinimo + (crossedLow ? (after <= p.minStock ? 1 : -1) : 0),
                sinStock: prev.sinStock + (crossedEmpty ? (after === 0 ? 1 : -1) : 0),
            }
        })
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

    /** Sin compatibilidad: no es universal y no tiene modelos mapeados. */
    const faltaCompat = (product: StockProductItem) =>
        !product.isUniversal && (product.models?.length ?? 0) === 0

    /** Chip ámbar clickeable → abre el formulario en edición para asignar modelos. */
    const compatBadge = (product: StockProductItem) =>
        faltaCompat(product) ? (
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation()
                    setParams({ editar: product.id })
                }}
                title="Sin modelos compatibles — clic para asignarlos"
                aria-label={`${product.name} no tiene modelos compatibles, editar`}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/60"
            >
                <AlertTriangle className="h-3 w-3" />
                Sin compat
            </button>
        ) : null

    // Existencias por sucursal — la sucursal de trabajo resalta en todas las vistas.
    const branchChips = (product: StockProductItem) =>
        product.stocks && product.stocks.length > 0 ? (
            <div className="flex flex-wrap gap-1">
                {product.stocks.map((s) => (
                    <span
                        key={s.branchId}
                        className={cn(
                            "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums",
                            s.branchId === actionBranchId && "bg-primary/10 font-semibold text-primary ring-1 ring-primary/40",
                            s.quantity <= 0 && "text-muted-foreground/60"
                        )}
                    >
                        {s.branch.name} {s.quantity}
                    </span>
                ))}
            </div>
        ) : (
            <span className="text-xs text-muted-foreground">Sin existencias</span>
        )

    // Acciones de producto compartidas por las tres vistas.
    const productActions = (product: StockProductItem, showEditLabel = false) => (
        <>
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
                size={showEditLabel ? "sm" : "icon"}
                className="h-8"
                title={showEditLabel ? undefined : `Editar ${product.name}`}
                aria-label={`Editar ${product.name}`}
                onClick={() => setParams({ editar: product.id })}
            >
                <Edit className="h-4 w-4" />
                {showEditLabel && <span className="ml-1">Editar</span>}
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
        </>
    )

    // --- Acciones ------------------------------------------------------------
    const openEtiquetas = (items: StockProductItem[]) => {
        if (items.length === 0) return
        setEtiquetasProducts(items)
        setEtiquetasOpen(true)
    }

    // Ajuste masivo: asigna precios o aplica un % sobre la selección actual.
    // El endpoint registra cada cambio en PriceHistory vía su auditoría.
    const applyBulkPrices = async () => {
        const ids = Array.from(labelSelected.keys())
        if (ids.length === 0) return
        const num = (v: string) => {
            const n = parseFloat(v)
            return v.trim() !== "" && Number.isFinite(n) ? n : undefined
        }
        const body: Record<string, unknown> = { ids }
        if (bulkMode === "set") {
            const set: Record<string, number> = {}
            for (const [field, raw] of [
                ["retailPrice", bulkRetail],
                ["wholesalePrice", bulkWholesale],
                ["costPrice", bulkCost],
            ] as const) {
                const n = num(raw)
                if (n !== undefined) set[field] = n
            }
            if (Object.keys(set).length === 0) {
                toast.error("Captura al menos un precio para asignar.")
                return
            }
            body.set = set
        } else {
            const p = num(bulkPercent)
            if (p === undefined) {
                toast.error("Captura el porcentaje (ej. 10 o -15).")
                return
            }
            body.percent = p
        }
        bulkOp.current = getClientOperationKey(bulkOp.current, body)
        setBulkBusy(true)
        try {
            const res = await fetch("/api/products/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...body, idempotencyKey: bulkOp.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo aplicar el ajuste")
            bulkOp.current = null
            toast.success(`${data.updated ?? ids.length} producto(s) actualizados`, {
                description: data?.skipped?.length ? `${data.skipped.length} omitido(s): inactivos o sin acceso` : undefined,
            })
            setBulkOpen(false)
            setBulkRetail(""); setBulkWholesale(""); setBulkCost(""); setBulkPercent("")
            setLabelSelected(new Map())
            void fetchProducts()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "No se pudo aplicar el ajuste. Reintenta.")
        } finally {
            setBulkBusy(false)
        }
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

    const hasSaludFilter = sinPrecio || sinFoto || sinCompat || sinStockF
    const hasFilters = search !== "" || categoryId !== "" || visibilidad !== "todos" || lowStock || hasSaludFilter
    // En móvil los filtros van colapsados; el badge cuenta los activos
    // (la búsqueda no cuenta — el propio campo ya lo muestra).
    const [filtersOpen, setFiltersOpen] = useState(false)
    const activeFilterCount = (categoryId !== "" ? 1 : 0) + (lowStock ? 1 : 0) + (visibilidad !== "todos" ? 1 : 0)
        + (sinPrecio ? 1 : 0) + (sinFoto ? 1 : 0) + (sinCompat ? 1 : 0) + (sinStockF ? 1 : 0)

    const limpiarFiltros = () => {
        setSearchInput("")
        setParams({ search: null, categoryId: null, visibilidad: null, lowStock: null, sinPrecio: null, sinFoto: null, sinCompat: null, sinStock: null, page: null })
    }

    return (
        <div className="space-y-4">
            {/* ── Fila 1: acciones primarias + sucursal de trabajo + herramientas ── */}
            <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setParams({ nuevo: "1" })}>
                    <Plus className="mr-2 h-4 w-4" />
                    Dar de alta
                </Button>
                <Button variant="outline" onClick={() => setParams({ entrada: "1" })}>
                    <PackagePlus className="mr-2 h-4 w-4" />
                    Entrada rápida
                </Button>
                {/* Sucursal de trabajo: contexto de los ajustes rápidos. El
                    empleado la tiene fija como badge; el admin la elige. */}
                <div className="ml-auto flex items-center gap-2">
                    <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                        <Store className="h-3.5 w-3.5" />
                        Operando en:
                    </span>
                    {isAdmin ? (
                        <Select value={actionBranchId ?? ""} onValueChange={setWorkBranchId}>
                            <SelectTrigger className="h-9 w-auto min-w-36" aria-label="Sucursal de trabajo">
                                <SelectValue placeholder="Sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm font-medium">
                            <Store className="h-3.5 w-3.5" />
                            {actionBranchName || "Tu sucursal"}
                        </Badge>
                    )}

                    {/* Herramientas de uso ocasional: fuera del camino pero a un click. */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Herramientas de inventario" title="Herramientas de inventario">
                                <Ellipsis className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuLabel>Herramientas</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setTraspasoOpen(true)} disabled={branches.length < 2}>
                                <ArrowLeftRight className="mr-2 h-4 w-4" />
                                Mover entre sucursales
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setMermaOpen(true)}>
                                <PackageX className="mr-2 h-4 w-4" />
                                Registrar merma
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={openCountDialog} disabled={branches.length === 0}>
                                <ClipboardList className="mr-2 h-4 w-4" />
                                Conteo físico
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setParams({ captura: "1" })}>
                                <Zap className="mr-2 h-4 w-4" />
                                Captura rápida
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setParams({ herramienta: "clasificacion" })}>
                                <FolderTree className="mr-2 h-4 w-4" />
                                Clasificación (categorías, marcas, modelos)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setParams({ herramienta: "etiquetas" })}>
                                <QrCode className="mr-2 h-4 w-4" />
                                Imprimir etiquetas
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setImportOpen(true)}>
                                <Upload className="mr-2 h-4 w-4" />
                                Importar Excel
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setFotosOpen(true)}>
                                <ImagePlus className="mr-2 h-4 w-4" />
                                Importar fotos por archivo
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleExport} disabled={exporting}>
                                {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                Exportar Excel
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <ExportButton type="products" label="CSV" className="h-9" />
                </div>
            </div>

            {/* ── Fila 2: filtros + vista. En móvil solo el buscador queda
                   siempre visible; el resto se colapsa tras "Filtros" con
                   badge de cuántos están activos ── */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="flex gap-2">
                    <div className="relative flex-1 sm:max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            ref={searchRef}
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Buscar por nombre o código…"
                            aria-label="Buscar productos por nombre o código (atajo: tecla /)"
                            className="pl-9 pr-8"
                        />
                        {searchInput && (
                            <button
                                type="button"
                                onClick={() => setSearchInput("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                                aria-label="Limpiar búsqueda"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <Button
                        variant={filtersOpen ? "secondary" : "outline"}
                        size="sm"
                        className="h-9 shrink-0 gap-1.5 sm:hidden"
                        onClick={() => setFiltersOpen((o) => !o)}
                        aria-expanded={filtersOpen}
                    >
                        <SlidersHorizontal className="h-4 w-4" />
                        Filtros
                        {activeFilterCount > 0 && (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
                                {activeFilterCount}
                            </span>
                        )}
                    </Button>
                </div>
                <div className={cn("gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center", filtersOpen ? "flex flex-col" : "hidden sm:flex")}>
                <Select
                    value={categoryId || "ALL"}
                    onValueChange={(v) => setParams({ categoryId: v === "ALL" ? null : v, page: null })}
                >
                    <SelectTrigger className="w-full sm:w-48">
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
                    className="h-9 self-start sm:self-center"
                    onClick={() => setParams({ lowStock: lowStock ? null : "true", page: null })}
                >
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    Stock bajo
                </Button>

                {/* Chips de visibilidad en el mercado → ?visibilidad= */}
                <div className="flex flex-wrap items-center gap-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground mr-0.5">
                        Visibilidad
                    </span>
                    {VISIBILIDAD_FILTROS.map((f) => (
                        <Button
                            key={f.value}
                            variant={visibilidad === f.value ? "default" : "outline"}
                            size="sm"
                            className="h-8"
                            onClick={() => setParams({ visibilidad: f.value === "todos" ? null : f.value, page: null })}
                        >
                            {f.label}
                        </Button>
                    ))}
                </div>

                {/* Selector de vista — preferencia guardada en el equipo. */}
                <div className="inline-flex items-center self-start rounded-md border sm:ml-auto" role="group" aria-label="Cambiar vista de la lista">
                    {VISTAS.map((v) => {
                        const VIcon = v.icon
                        return (
                            <Button
                                key={v.value}
                                variant={vista === v.value ? "secondary" : "ghost"}
                                size="icon"
                                className="h-8 w-9 first:rounded-r-none last:rounded-l-none [&:not(:first-child):not(:last-child)]:rounded-none"
                                title={v.title}
                                aria-label={v.label}
                                aria-pressed={vista === v.value}
                                onClick={() => cambiarVista(v.value)}
                            >
                                <VIcon className="h-4 w-4" />
                            </Button>
                        )
                    })}
                </div>
                </div>
            </div>

            {/* ── Fila 3: resumen del inventario (los números bajo mínimo/sin
                   stock también activan el filtro de stock bajo) ── */}
            {(stats || hasFilters) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {stats && (
                        <>
                            <span><span className="font-semibold text-foreground">{stats.productos.toLocaleString("es-MX")}</span> productos</span>
                            <span><span className="font-semibold text-foreground">{stats.unidades.toLocaleString("es-MX")}</span> unidades</span>
                            <button
                                type="button"
                                onClick={() => setParams({ lowStock: lowStock ? null : "true", page: null })}
                                title="Ver solo los productos bajo mínimo"
                                aria-pressed={lowStock}
                                className={cn(
                                    "rounded-sm underline-offset-2 hover:underline",
                                    stats.bajoMinimo > 0 && "font-medium text-amber-600 dark:text-amber-400",
                                    lowStock && "font-semibold underline",
                                )}
                            >
                                {stats.bajoMinimo} bajo mínimo
                            </button>
                            <button
                                type="button"
                                onClick={() => setParams({ sinStock: sinStockF ? null : "true", page: null })}
                                title="Ver solo los productos agotados"
                                aria-pressed={sinStockF}
                                className={cn(
                                    "rounded-sm underline-offset-2 hover:underline",
                                    stats.sinStock > 0 && "font-medium text-destructive",
                                    sinStockF && "font-semibold underline",
                                )}
                            >
                                {stats.sinStock} sin stock
                            </button>
                            {/* Salud del catálogo: datos incompletos que conviene
                                ir limpiando. Cada métrica es un filtro clickeable. */}
                            {(stats.sinPrecio > 0 || stats.sinFoto > 0 || stats.sinCompat > 0) && (
                                <span className="text-muted-foreground/80">
                                    · salud:{" "}
                                    {([
                                        ["sinPrecio", stats.sinPrecio, "sin precio real", sinPrecio],
                                        ["sinFoto", stats.sinFoto, "sin foto", sinFoto],
                                        ["sinCompat", stats.sinCompat, "sin compatibilidad", sinCompat],
                                    ] as const)
                                        .filter(([, n]) => n > 0)
                                        .map(([key, n, label, active], i) => (
                                            <span key={key}>
                                                {i > 0 && " · "}
                                                <button
                                                    type="button"
                                                    onClick={() => setParams({ [key]: active ? null : "true", page: null })}
                                                    title={`Ver solo productos ${label}`}
                                                    aria-pressed={active}
                                                    className={cn(
                                                        "rounded-sm underline-offset-2 hover:underline",
                                                        active && "font-semibold text-primary underline",
                                                    )}
                                                >
                                                    {n} {label}
                                                </button>
                                            </span>
                                        ))}
                                </span>
                            )}
                        </>
                    )}
                    {hasFilters && (
                        <Button variant="ghost" size="sm" className="-my-1 ml-auto h-6 gap-1 px-2 text-muted-foreground hover:text-foreground" onClick={limpiarFiltros}>
                            <FilterX className="h-3.5 w-3.5" />
                            Limpiar filtros
                        </Button>
                    )}
                </div>
            )}

            {/* Lista única de productos */}
            {loadError ? (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{loadError}</p>
                    <Button variant="outline" onClick={() => void fetchProducts()}>Reintentar</Button>
                </div>
            ) : loading && products.length === 0 ? (
                <div className="space-y-2" aria-busy="true" aria-label="Cargando productos">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-[92px] animate-pulse rounded-lg border bg-muted/40" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                </div>
            ) : products.length === 0 ? (
                <EmptyState
                    icon={Package}
                    title="No se encontraron productos"
                    description={hasFilters ? "Prueba con otros filtros o limpia la búsqueda." : "Agrega tu primer producto al inventario."}
                    action={!hasFilters ? { label: "Dar de alta el primer producto", href: `${pathname}?tab=stock&nuevo=1`, icon: Plus } : undefined}
                />
            ) : vista === "mosaico" ? (
                /* ── Mosaico: fotos grandes para ubicar la pieza de un vistazo ── */
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {products.map((product) => {
                        const badge = VISIBILIDAD_BADGE[product.marketVisibility ?? "HIDDEN"]
                        return (
                            <Card key={product.id} className={cn("overflow-hidden hover:shadow-md transition-shadow", loading && "opacity-60")}>
                                <div
                                    className="relative aspect-square cursor-pointer bg-muted"
                                    role="button"
                                    tabIndex={0}
                                    title={`Editar ${product.name}`}
                                    onClick={() => setParams({ editar: product.id })}
                                    onKeyDown={(e) => { if (e.key === "Enter") setParams({ editar: product.id }) }}
                                >
                                    {product.images[0] ? (
                                        <Image
                                            src={product.images[0]}
                                            alt={product.name}
                                            fill
                                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                                            className="object-cover"
                                        />
                                    ) : (
                                        <CategoryPlaceholder name={product.category?.name} letterCls="text-4xl" iconCls="h-10 w-10" />
                                    )}
                                    <Checkbox
                                        checked={labelSelected.has(product.id)}
                                        onCheckedChange={() => toggleLabelSelected(product)}
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label={`Seleccionar ${product.name} para imprimir etiquetas`}
                                        title="Seleccionar para etiquetas"
                                        className="absolute left-2 top-2 bg-background/90"
                                    />
                                </div>
                                <CardContent className="p-3 space-y-1.5">
                                    <h3 className="min-h-9 text-sm font-medium leading-tight line-clamp-2" title={product.name}>
                                        {product.name}
                                    </h3>
                                    <p className="truncate text-xs text-muted-foreground" title={[product.category?.name, getModelText(product)].filter(Boolean).join(" · ")}>
                                        {[product.category?.name, getModelText(product)].filter(Boolean).join(" · ") || "—"}
                                    </p>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-bold text-primary">{formatPrice(product.retailPrice)}</span>
                                        <Badge variant="outline" className={cn("text-[10px] gap-1 font-normal", badge.className)}>
                                            <badge.icon className="h-3 w-3" />
                                            {badge.label}
                                        </Badge>
                                    </div>
                                    {compatBadge(product)}
                                    {branchChips(product)}
                                    <div className="flex items-center justify-between gap-1 border-t pt-1.5">
                                        <StockQtyEditor
                                            productId={product.id}
                                            productName={product.name}
                                            quantity={branchQtyOf(product)}
                                            branchId={actionBranchId}
                                            reason={`Ajuste rápido en ${actionBranchName || "sucursal"}`}
                                            onAdjusted={(delta) => applyStockDelta(product.id, actionBranchId, delta)}
                                        />
                                        <div className="flex gap-0.5">
                                            {productActions(product)}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            ) : vista === "compacta" ? (
                /* ── Compacta: renglones densos, más productos por pantalla ── */
                <div className="overflow-hidden rounded-lg border">
                    <div className="hidden md:grid grid-cols-12 gap-2 border-b bg-muted/50 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        <div className="col-span-4">Producto</div>
                        <div className="col-span-2">Categoría</div>
                        <div className="col-span-2">Sucursales</div>
                        <div className="col-span-1 text-center">Stock</div>
                        <div className="col-span-1 text-right">Público</div>
                        <div className="col-span-2 text-right">Acciones</div>
                    </div>
                    {products.map((product, i) => (
                        <div
                            key={product.id}
                            className={cn(
                                "grid grid-cols-12 items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/40",
                                i > 0 && "border-t",
                                loading && "opacity-60",
                            )}
                        >
                            <div className="col-span-12 flex items-center gap-2 min-w-0 md:col-span-4">
                                <Checkbox
                                    checked={labelSelected.has(product.id)}
                                    onCheckedChange={() => toggleLabelSelected(product)}
                                    aria-label={`Seleccionar ${product.name} para imprimir etiquetas`}
                                    title="Seleccionar para etiquetas"
                                    className="flex-shrink-0"
                                />
                                <div className="h-8 w-8 relative flex-shrink-0 overflow-hidden rounded bg-muted">
                                    {product.images[0] ? (
                                        <Image src={product.images[0]} alt="" fill sizes="32px" className="object-cover" />
                                    ) : (
                                        <CategoryPlaceholder name={product.category?.name} letterCls="text-xs" iconCls="h-3.5 w-3.5" />
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate font-medium leading-tight">{product.name}</p>
                                    <p className="truncate text-[11px] text-muted-foreground">
                                        {compatBadge(product) ?? <>{getModelText(product)}{product.barcode ? ` · ${product.barcode}` : ""}</>}
                                    </p>
                                </div>
                            </div>
                            <div className="col-span-3 text-xs text-muted-foreground md:col-span-2">
                                {product.category?.name ?? "—"}
                            </div>
                            <div className="col-span-3 md:col-span-2">{branchChips(product)}</div>
                            <div className="col-span-2 text-left md:col-span-1 md:text-center">
                                <StockQtyEditor
                                    productId={product.id}
                                    productName={product.name}
                                    quantity={branchQtyOf(product)}
                                    branchId={actionBranchId}
                                    reason={`Ajuste rápido en ${actionBranchName || "sucursal"}`}
                                    onAdjusted={(delta) => applyStockDelta(product.id, actionBranchId, delta)}
                                />
                            </div>
                            <div className="col-span-2 text-right font-semibold text-primary md:col-span-1">
                                {formatPrice(product.retailPrice)}
                            </div>
                            <div className="col-span-2 flex justify-end gap-0.5 md:col-span-2">
                                {productActions(product)}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                /* ── Lista: detalle completo por renglón (vista original) ── */
                <div className="space-y-2">
                    <div className="sticky top-16 z-10 hidden md:grid grid-cols-12 gap-4 border-b bg-background/95 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide backdrop-blur">
                        <div className="col-span-4">Producto</div>
                        <div className="col-span-2">Categoría</div>
                        <div className="col-span-2">Existencias por sucursal</div>
                        <div className="col-span-1 text-center">Stock</div>
                        <div className="col-span-1 text-right">Público</div>
                        <div className="col-span-2 text-right">Acciones</div>
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
                                                    <CategoryPlaceholder name={product.category?.name} letterCls="text-lg" iconCls="h-5 w-5" />
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <h3 className="font-medium truncate">
                                                    <button
                                                        type="button"
                                                        className="truncate text-left hover:underline"
                                                        title={`Editar ${product.name}`}
                                                        onClick={() => setParams({ editar: product.id })}
                                                    >
                                                        {product.name}
                                                    </button>
                                                </h3>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {compatBadge(product) ?? <>{getModelText(product)}{product.barcode ? ` · ${product.barcode}` : ""}</>}
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
                                        <div className="col-span-4 md:col-span-2">{branchChips(product)}</div>

                                        {/* Total + ajuste inline sobre la sucursal de trabajo */}
                                        <div className="col-span-4 md:col-span-1 text-left md:text-center">
                                            <div className="flex md:justify-center">
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
                                        <div className="col-span-8 md:col-span-2 flex justify-end gap-1">
                                            {productActions(product, true)}
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
                            ...(sinPrecio && { sinPrecio: "true" }),
                            ...(sinFoto && { sinFoto: "true" }),
                            ...(sinCompat && { sinCompat: "true" }),
                            ...(sinStockF && { sinStock: "true" }),
                        }}
                    />
                </div>
            )}

            {/* Barra flotante de selección: queda fija sobre la nav inferior
                en móvil (h-16) y al pie en desktop — siempre visible mientras
                haya productos marcados, sin importar el scroll. Va en portal
                porque un ancestro con transform rompería el `fixed`. */}
            {barMounted && labelSelected.size > 0 && createPortal(
                <div
                    role="toolbar"
                    aria-label="Acciones para la selección"
                    className="fixed inset-x-3 bottom-20 z-40 flex items-center justify-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm lg:inset-x-auto lg:bottom-6 lg:left-1/2 lg:-translate-x-1/2"
                >
                    <span className="pl-1 text-sm font-medium tabular-nums">
                        {labelSelected.size} sel.
                    </span>
                    <Button
                        size="sm"
                        onClick={() => setBulkOpen(true)}
                        title="Asignar precios o aplicar un porcentaje a la selección"
                    >
                        <Percent className="mr-1.5 h-4 w-4" />
                        Ajustar precios
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEtiquetas(Array.from(labelSelected.values()))}
                    >
                        <Printer className="mr-1.5 h-4 w-4" />
                        Etiquetas
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Limpiar selección"
                        aria-label="Limpiar selección"
                        onClick={() => setLabelSelected(new Map())}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>,
                document.body
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
                <DialogContent className="sm:max-w-5xl">
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
                <DialogContent className="sm:max-w-4xl">
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

            {/* Diálogo: ajuste masivo de precios sobre la selección */}
            <Dialog open={bulkOpen} onOpenChange={guardedClose(setBulkOpen, bulkBusy)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Ajustar precios · {labelSelected.size} producto(s)</DialogTitle>
                        <DialogDescription>
                            Asigna valores directos o aplica un porcentaje. Los campos vacíos no se tocan;
                            cada cambio queda en el historial de precios del producto.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant={bulkMode === "set" ? "default" : "outline"}
                            onClick={() => setBulkMode("set")}
                        >
                            Asignar precios
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={bulkMode === "percent" ? "default" : "outline"}
                            onClick={() => setBulkMode("percent")}
                        >
                            Porcentaje %
                        </Button>
                    </div>

                    {bulkMode === "set" ? (
                        <div className="grid grid-cols-2 gap-3">
                            {(([
                                ["Público", bulkRetail, setBulkRetail],
                                ["Aliados", bulkWholesale, setBulkWholesale],
                                // El costo solo lo puede fijar el dueño (el API lo
                                // ignora para empleados, igual que en la edición).
                                ...(isAdmin ? [["Costo", bulkCost, setBulkCost]] : []),
                            ]) as [string, string, (v: string) => void][]).map(([label, value, setter]) => (
                                <div key={label} className="space-y-1">
                                    <Label className="text-xs">{label}</Label>
                                    <div className="relative">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                        <Input
                                            type="number" min="0" step="0.01" inputMode="decimal"
                                            value={value} onChange={(e) => setter(e.target.value)}
                                            className="pl-6" placeholder="sin cambio"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <Label className="text-xs">Porcentaje sobre precio público y aliados</Label>
                            <div className="relative">
                                <Input
                                    type="number" step="0.1" inputMode="decimal"
                                    value={bulkPercent} onChange={(e) => setBulkPercent(e.target.value)}
                                    className="pr-8" placeholder="ej. 10 o -15"
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Un producto a $100 con +10% queda a $110. No aplica a costo ni taller propio.
                            </p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void applyBulkPrices()} disabled={bulkBusy}>
                            {bulkBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Aplicar a {labelSelected.size}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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

            {/* Diálogo: importar fotos por nombre de archivo */}
            <FotosImportDialog
                open={fotosOpen}
                onOpenChange={setFotosOpen}
                products={products}
                onDone={() => void fetchProducts()}
            />
        </div>
    )
}
