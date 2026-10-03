"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BarcodeScanner } from "@/components/barcode-scanner"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { readPreferredBranchId } from "@/components/admin/productos/stock-editor"
import {
    CheckCircle2,
    Copy,
    CornerDownLeft,
    Loader2,
    PackagePlus,
    Plus,
    ScanBarcode,
    Zap,
} from "lucide-react"
import { toast } from "sonner"

const selectClassName =
    "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

interface CatalogItem {
    id: string
    name: string
}

interface ModelItem extends CatalogItem {
    brandId: string
    brand: { name: string }
}

interface Branch {
    id: string
    name: string
    isActive: boolean
}

interface CaptureForm {
    barcode: string
    name: string
    categoryId: string
    brandId: string
    modelId: string
    costPrice: string
    retailPrice: string
    wholesalePrice: string
    stock: string
}

const EMPTY_FORM: CaptureForm = {
    barcode: "",
    name: "",
    categoryId: "",
    brandId: "",
    modelId: "",
    costPrice: "",
    retailPrice: "",
    wholesalePrice: "",
    stock: "1",
}

interface ExistingProduct {
    id: string
    name: string
    barcode: string | null
    /** Con branchId en la búsqueda, la API devuelve el stock de ESA sucursal. */
    stock: number
}

interface CapturedRow {
    id: string
    name: string
    stock: number
    branchName: string
}

type QuickAddKind = "category" | "brand" | "model"

/**
 * Captura dinámica de inventario: alta rápida de productos uno tras otro.
 * Enter guarda y reinicia el formulario (foco de vuelta al código), un código
 * de barras ya registrado ofrece sumar stock en vez de duplicar el producto,
 * y "Repetir anterior" precarga clasificación/precios para series similares.
 */
export function CapturaRapidaPanel() {
    const [catalogs, setCatalogs] = useState<{
        categories: CatalogItem[]
        brands: CatalogItem[]
        models: ModelItem[]
        branches: Branch[]
    } | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const [form, setForm] = useState<CaptureForm>(EMPTY_FORM)
    const [branchId, setBranchId] = useState("")
    const [saving, setSaving] = useState(false)

    // Código ya registrado → flujo "+N stock" en lugar de alta duplicada.
    const [existing, setExisting] = useState<ExistingProduct | null>(null)
    const [addQty, setAddQty] = useState("1")
    const [addingStock, setAddingStock] = useState(false)
    const [scanOpen, setScanOpen] = useState(false)

    // Sesión: contador, últimos capturados y base para "Repetir anterior".
    const [captured, setCaptured] = useState<CapturedRow[]>([])
    const [lastForm, setLastForm] = useState<CaptureForm | null>(null)

    // Altas rápidas de clasificación sin salir de la captura.
    const [quickAdd, setQuickAdd] = useState<QuickAddKind | null>(null)
    const [quickAddName, setQuickAddName] = useState("")
    const [quickAddBrandId, setQuickAddBrandId] = useState("")
    const [quickAddSaving, setQuickAddSaving] = useState(false)

    const barcodeRef = useRef<HTMLInputElement>(null)
    const nameRef = useRef<HTMLInputElement>(null)
    const addQtyRef = useRef<HTMLInputElement>(null)
    const createOp = useRef<ClientOperationKey | null>(null)
    const stockOp = useRef<ClientOperationKey | null>(null)
    // Guards en ref: el estado `saving` llega un render tarde frente a Enter/doble-click.
    const savingRef = useRef(false)
    const addingRef = useRef(false)

    const fetchCatalogs = useCallback(async (signal?: AbortSignal) => {
        setLoadError(null)
        try {
            const [categoriesRes, brandsRes, modelsRes, branchesRes] = await Promise.all([
                fetch("/api/categories", { signal }),
                fetch("/api/brands", { signal }),
                fetch("/api/models", { signal }),
                fetch("/api/branches", { signal }),
            ])
            const [categories, brands, models, branchesJson] = await Promise.all([
                categoriesRes.json(),
                brandsRes.json(),
                modelsRes.json(),
                branchesRes.json(),
            ])
            if (signal?.aborted) return
            const branches: Branch[] = (branchesJson?.branches ?? []).filter((b: Branch) => b.isActive)
            setCatalogs({ categories: categories ?? [], brands: brands ?? [], models: models ?? [], branches })
            setBranchId((current) => {
                if (current && branches.some((b) => b.id === current)) return current
                const preferred = readPreferredBranchId()
                return preferred && branches.some((b) => b.id === preferred) ? preferred : branches[0]?.id ?? ""
            })
        } catch {
            if (!signal?.aborted) setLoadError("No se pudieron cargar catálogos y sucursales.")
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchCatalogs(controller.signal))
        return () => controller.abort()
    }, [fetchCatalogs])

    const set = <K extends keyof CaptureForm>(key: K, value: CaptureForm[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }))

    const focusBarcode = () => setTimeout(() => barcodeRef.current?.focus(), 0)

    const branchName = catalogs?.branches.find((b) => b.id === branchId)?.name ?? ""

    /** Código ya existe → muestra el panel "+N stock"; si no, sigue el alta. */
    const lookupBarcode = async (scanned?: string) => {
        const code = (scanned ?? form.barcode).trim()
        if (scanned) set("barcode", scanned)
        if (code.length < 2) {
            nameRef.current?.focus()
            return
        }
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(code)}${branchId ? `&branchId=${branchId}` : ""}`)
            const data = await res.json().catch(() => null)
            const products: ExistingProduct[] = Array.isArray(data?.products) ? data.products : []
            const exact = products.find((p) => p.barcode === code || p.id === code)
            if (exact) {
                setExisting(exact)
                setAddQty("1")
                setTimeout(() => addQtyRef.current?.focus(), 0)
            } else {
                setExisting(null)
                nameRef.current?.focus()
            }
        } catch {
            // Sin red: deja seguir capturando; el POST valida el duplicado igual.
            nameRef.current?.focus()
        }
    }

    const addStockToExisting = async () => {
        if (!existing || addingRef.current) return
        const qty = parseInt(addQty, 10)
        if (!Number.isInteger(qty) || qty < 1) {
            toast.error("Indica cuántas unidades entran (mínimo 1).")
            return
        }
        const payload = {
            productId: existing.id,
            type: "IN",
            quantity: qty,
            reason: "Entrada rápida durante captura",
            ...(branchId ? { branchId } : {}),
        }
        stockOp.current = getClientOperationKey(stockOp.current, payload)
        addingRef.current = true
        setAddingStock(true)
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: stockOp.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo sumar el stock.")
            stockOp.current = null
            toast.success(`+${qty} a "${existing.name}"`, { duration: 2000 })
            // Listo para el siguiente escaneo.
            setExisting(null)
            set("barcode", "")
            focusBarcode()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sumar.")
        } finally {
            addingRef.current = false
            setAddingStock(false)
        }
    }

    const submit = async () => {
        if (savingRef.current || !catalogs) return
        // Con el panel de "código existente" abierto, Enter no crea duplicado.
        if (existing && existing.barcode === form.barcode.trim()) {
            toast.error("Ese código ya existe: suma stock o usa otro código.")
            return
        }
        const name = form.name.trim()
        const retail = parseFloat(form.retailPrice)
        const wholesale = form.wholesalePrice.trim() ? parseFloat(form.wholesalePrice) : retail
        const cost = form.costPrice.trim() ? parseFloat(form.costPrice) : null
        const stock = parseInt(form.stock || "0", 10)

        if (!name) return toast.error("Escribe el nombre del producto."), nameRef.current?.focus()
        if (!form.categoryId) return toast.error("Selecciona la categoría.")
        if (!Number.isFinite(retail) || retail < 0) return toast.error("Captura el precio al público.")
        if (!Number.isFinite(wholesale) || wholesale < 0) return toast.error("El precio de taller debe ser ≥ 0.")
        if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return toast.error("El costo debe ser ≥ 0.")
        if (!Number.isInteger(stock) || stock < 0) return toast.error("El stock inicial debe ser un entero ≥ 0.")
        if (stock > 0 && !branchId) return toast.error("Selecciona la sucursal que recibe el stock inicial.")

        const payload = {
            name,
            barcode: form.barcode.trim(),
            categoryId: form.categoryId,
            costPrice: cost,
            retailPrice: retail,
            wholesalePrice: wholesale,
            stock,
            minStock: 1,
            // Sin modelo elegido el producto queda universal (editable después
            // en la ficha completa del producto).
            isUniversal: !form.modelId,
            modelIds: form.modelId ? [form.modelId] : [],
            stockBranchId: branchId || undefined,
        }
        createOp.current = getClientOperationKey(createOp.current, payload)
        savingRef.current = true
        setSaving(true)
        try {
            const res = await fetch("/api/products", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: createOp.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                // Código duplicado detectado por el servidor (p.ej. si el usuario
                // saltó la verificación con Enter): muestra el panel "+N stock".
                if (res.status === 400 && typeof data?.error === "string" && data.error.toLowerCase().includes("código")) {
                    await lookupBarcode()
                }
                throw new Error(data?.error || "No se pudo guardar el producto.")
            }
            createOp.current = null
            setLastForm(form)
            setCaptured((prev) => [{ id: data.id ?? "", name, stock, branchName }, ...prev].slice(0, 8))
            toast.success(`"${name}" capturado`, { duration: 2000 })
            setForm(EMPTY_FORM)
            setExisting(null)
            focusBarcode()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta guardar.")
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }

    /** Serie de productos similares: repite clasificación y precios, pide nombre/código nuevos. */
    const repeatLast = () => {
        if (!lastForm) return
        setForm({ ...lastForm, name: "", barcode: "" })
        setExisting(null)
        setTimeout(() => nameRef.current?.focus(), 0)
    }

    const openQuickAdd = (kind: QuickAddKind) => {
        setQuickAdd(kind)
        setQuickAddName("")
        setQuickAddBrandId(kind === "model" ? form.brandId : "")
    }

    const saveQuickAdd = async () => {
        if (!quickAdd || quickAddSaving) return
        const name = quickAddName.trim()
        if (!name) return toast.error("Escribe el nombre.")
        const url = quickAdd === "category" ? "/api/categories" : quickAdd === "brand" ? "/api/brands" : "/api/models"
        const body = quickAdd === "model" ? { name, brandId: quickAddBrandId } : { name }
        if (quickAdd === "model" && !quickAddBrandId) return toast.error("Selecciona la marca del modelo.")
        setQuickAddSaving(true)
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const created = await res.json().catch(() => null)
            if (!res.ok) throw new Error(created?.error || "No se pudo crear.")
            await fetchCatalogs()
            if (quickAdd === "category") set("categoryId", created.id)
            if (quickAdd === "brand") set("brandId", created.id)
            if (quickAdd === "model") set("modelId", created.id)
            setQuickAdd(null)
            toast.success(`"${name}" agregado`)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión.")
        } finally {
            setQuickAddSaving(false)
        }
    }

    const filteredModels = form.brandId
        ? (catalogs?.models ?? []).filter((m) => m.brandId === form.brandId)
        : []

    if (loadError) {
        return (
            <div role="alert" className="rounded-lg border p-6 space-y-3">
                <p>{loadError}</p>
                <Button variant="outline" onClick={() => void fetchCatalogs()}>Reintentar</Button>
            </div>
        )
    }

    if (!catalogs) {
        return (
            <div className="flex items-center justify-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Zap className="h-5 w-5 text-muted-foreground" />
                        Captura rápida
                    </CardTitle>
                    <CardDescription>
                        Alta en serie: Enter guarda y el formulario queda listo para el siguiente producto.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {catalogs.categories.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Necesitas al menos una categoría para capturar productos.
                            </p>
                            <Button variant="outline" onClick={() => openQuickAdd("category")}>
                                <Plus className="mr-2 h-4 w-4" />
                                Crear primera categoría
                            </Button>
                        </div>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                void submit()
                            }}
                            className="space-y-4"
                        >
                            {/* Código existente → sumar stock en vez de duplicar */}
                            {existing && (
                                <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 space-y-2" role="status">
                                    <p className="text-sm font-medium flex items-center gap-2">
                                        <ScanBarcode className="h-4 w-4" />
                                        El código {existing.barcode} ya existe:
                                    </p>
                                    <p className="text-sm">
                                        <span className="font-semibold">{existing.name}</span>
                                        {" · "}
                                        <span className="text-muted-foreground">
                                            {existing.stock} en {branchName || "la sucursal"}
                                        </span>
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            ref={addQtyRef}
                                            type="number"
                                            min={1}
                                            value={addQty}
                                            onChange={(e) => setAddQty(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault()
                                                    void addStockToExisting()
                                                }
                                            }}
                                            className="h-9 w-24"
                                            aria-label="Unidades a sumar"
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void addStockToExisting()}
                                            disabled={addingStock}
                                        >
                                            {addingStock ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-1 h-4 w-4" />}
                                            Sumar stock
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => {
                                                setExisting(null)
                                                set("barcode", "")
                                                focusBarcode()
                                            }}
                                        >
                                            Otro código
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-barcode">Código / barras</Label>
                                    <div className="flex gap-1">
                                        <Input
                                            ref={barcodeRef}
                                            id="qc-barcode"
                                            autoFocus
                                            value={form.barcode}
                                            onChange={(e) => {
                                                set("barcode", e.target.value)
                                                if (existing) setExisting(null)
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault()
                                                    void lookupBarcode()
                                                }
                                            }}
                                            placeholder="Escanea o escribe; Enter verifica"
                                            autoComplete="off"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="h-9 w-9 shrink-0"
                                            onClick={() => setScanOpen(true)}
                                            title="Escanear con la cámara"
                                        >
                                            <ScanBarcode className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-name">Nombre *</Label>
                                    <Input
                                        ref={nameRef}
                                        id="qc-name"
                                        value={form.name}
                                        onChange={(e) => set("name", e.target.value)}
                                        placeholder="Ej: Pantalla iPhone 11"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-category">Categoría *</Label>
                                    <div className="flex gap-1">
                                        <select
                                            id="qc-category"
                                            value={form.categoryId}
                                            onChange={(e) => set("categoryId", e.target.value)}
                                            className={selectClassName}
                                            required
                                        >
                                            <option value="">Selecciona…</option>
                                            {catalogs.categories.map((c) => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => openQuickAdd("category")} title="Nueva categoría">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-brand">Marca (opc.)</Label>
                                    <div className="flex gap-1">
                                        <select
                                            id="qc-brand"
                                            value={form.brandId}
                                            onChange={(e) => setForm((prev) => ({ ...prev, brandId: e.target.value, modelId: "" }))}
                                            className={selectClassName}
                                        >
                                            <option value="">—</option>
                                            {catalogs.brands.map((b) => (
                                                <option key={b.id} value={b.id}>{b.name}</option>
                                            ))}
                                        </select>
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => openQuickAdd("brand")} title="Nueva marca">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-model">Modelo (opc.)</Label>
                                    <div className="flex gap-1">
                                        <select
                                            id="qc-model"
                                            value={form.modelId}
                                            onChange={(e) => set("modelId", e.target.value)}
                                            className={selectClassName}
                                            disabled={!form.brandId}
                                        >
                                            <option value="">{form.brandId ? "Universal" : "Elige marca primero"}</option>
                                            {filteredModels.map((m) => (
                                                <option key={m.id} value={m.id}>{m.name}</option>
                                            ))}
                                        </select>
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => openQuickAdd("model")} disabled={!form.brandId} title="Nuevo modelo">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-cost">Costo</Label>
                                    <Input
                                        id="qc-cost"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={form.costPrice}
                                        onChange={(e) => set("costPrice", e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-retail">Precio público *</Label>
                                    <Input
                                        id="qc-retail"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={form.retailPrice}
                                        onChange={(e) => set("retailPrice", e.target.value)}
                                        placeholder="0.00"
                                        required
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-wholesale">Taller (opc.)</Label>
                                    <Input
                                        id="qc-wholesale"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={form.wholesalePrice}
                                        onChange={(e) => set("wholesalePrice", e.target.value)}
                                        placeholder={form.retailPrice || "= público"}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="qc-stock">Stock inicial</Label>
                                    <Input
                                        id="qc-stock"
                                        type="number"
                                        min="0"
                                        step="1"
                                        inputMode="numeric"
                                        value={form.stock}
                                        onChange={(e) => set("stock", e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                                <div className="space-y-1.5 sm:w-56">
                                    <Label htmlFor="qc-branch">Sucursal destino</Label>
                                    <select
                                        id="qc-branch"
                                        value={branchId}
                                        onChange={(e) => setBranchId(e.target.value)}
                                        className={selectClassName}
                                        disabled={catalogs.branches.length === 0}
                                    >
                                        {catalogs.branches.length === 0 && <option value="">Sin sucursales</option>}
                                        {catalogs.branches.map((b) => (
                                            <option key={b.id} value={b.id}>{b.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex gap-2 sm:ml-auto">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={repeatLast}
                                        disabled={!lastForm || saving}
                                        title="Precarga categoría, marca, modelo y precios del último producto"
                                    >
                                        <Copy className="mr-2 h-4 w-4" />
                                        Repetir anterior
                                    </Button>
                                    <Button type="submit" disabled={saving} className="min-w-44">
                                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CornerDownLeft className="mr-2 h-4 w-4" />}
                                        Guardar y siguiente
                                    </Button>
                                </div>
                            </div>
                        </form>
                    )}
                </CardContent>
            </Card>

            {/* Sesión de captura */}
            <Card className="h-fit">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Sesión</CardTitle>
                    <CardDescription>
                        {captured.length === 0
                            ? "Aún no capturas productos."
                            : `${captured.length} producto${captured.length === 1 ? "" : "s"} capturado${captured.length === 1 ? "" : "s"}${captured.length === 8 ? "+" : ""} en esta sesión`}
                    </CardDescription>
                </CardHeader>
                {captured.length > 0 && (
                    <CardContent>
                        <ul className="space-y-2">
                            {captured.map((row, i) => (
                                <li key={`${row.id}-${i}`} className="flex items-start gap-2 text-sm">
                                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{row.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {row.stock} ud → {row.branchName || "sucursal"}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                )}
            </Card>

            {/* Escáner con cámara: el código cae al campo y dispara la verificación. */}
            <Dialog open={scanOpen} onOpenChange={setScanOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Escanear código</DialogTitle>
                    </DialogHeader>
                    <BarcodeScanner
                        onScan={(code) => {
                            setScanOpen(false)
                            void lookupBarcode(code)
                        }}
                        onClose={() => setScanOpen(false)}
                    />
                </DialogContent>
            </Dialog>

            {/* Alta rápida de categoría / marca / modelo */}
            <Dialog open={quickAdd !== null} onOpenChange={(open) => !open && setQuickAdd(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>
                            {quickAdd === "category" ? "Nueva categoría" : quickAdd === "brand" ? "Nueva marca" : "Nuevo modelo"}
                        </DialogTitle>
                    </DialogHeader>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            void saveQuickAdd()
                        }}
                        className="space-y-3 pt-1"
                    >
                        {quickAdd === "model" && (
                            <div className="space-y-1.5">
                                <Label htmlFor="qa-brand">Marca</Label>
                                <select
                                    id="qa-brand"
                                    value={quickAddBrandId}
                                    onChange={(e) => setQuickAddBrandId(e.target.value)}
                                    className={selectClassName}
                                    required
                                >
                                    <option value="">Selecciona marca…</option>
                                    {catalogs.brands.map((b) => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label htmlFor="qa-name">Nombre</Label>
                            <Input
                                id="qa-name"
                                autoFocus
                                value={quickAddName}
                                onChange={(e) => setQuickAddName(e.target.value)}
                                placeholder={quickAdd === "category" ? "Ej: Pantallas" : quickAdd === "brand" ? "Ej: Samsung" : "Ej: Galaxy S24"}
                                required
                            />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setQuickAdd(null)} disabled={quickAddSaving}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={quickAddSaving}>
                                {quickAddSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Agregar
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
