"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { ImageUpload } from "@/components/image-upload"
import { Globe, Loader2, Plus, Store, Wand2, X } from "lucide-react"
import { toast } from "sonner"

const selectClassName =
    "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

export type MarketVisibility = "HIDDEN" | "ALLIES" | "PUBLIC"

/** Vocabulario del negocio: Oculto / solo Aliados / Público general. */
export const VISIBILIDAD_LABELS: Record<MarketVisibility, string> = {
    HIDDEN: "Oculto",
    ALLIES: "Aliados",
    PUBLIC: "Público",
}

interface Brand {
    id: string
    name: string
}

interface Model {
    id: string
    name: string
    brand: { name: string }
}

interface Category {
    id: string
    name: string
}

interface BranchOption {
    id: string
    name: string
}

interface ProductDetail {
    id: string
    name: string
    description: string | null
    barcode: string | null
    retailPrice: number | null
    wholesalePrice: number | null
    internalPrice: number | null
    /** Solo llega para ADMIN (el DTO lo omite al empleado). */
    costPrice?: number | null
    marketVisibility?: MarketVisibility
    stock: number
    minStock: number
    categoryId: string
    isActive: boolean
    isUniversal: boolean
    images: string[]
    models: Model[]
}

interface ProductoFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** null/undefined = alta; id = edición. */
    productId?: string | null
    /** Código prellenado (deep-link ?codigo= desde el viejo /productos/escanear). */
    initialBarcode?: string | null
    /** Solo el dueño ve/captura el costo (el API igual lo ignora para empleados). */
    isAdmin: boolean
    branches: BranchOption[]
    /** Sucursal fija para empleados (su homeBranchId); null = el admin elige. */
    lockedBranchId?: string | null
    onSaved: () => void
}

export function ProductoFormDialog({
    open,
    onOpenChange,
    productId,
    initialBarcode,
    isAdmin,
    branches,
    lockedBranchId,
    onSaved,
}: ProductoFormDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl">
                {/* Desmontar al cerrar reinicia el formulario en cada apertura. */}
                {open && (
                    <ProductoForm
                        productId={productId ?? null}
                        initialBarcode={initialBarcode ?? null}
                        isAdmin={isAdmin}
                        branches={branches}
                        lockedBranchId={lockedBranchId ?? null}
                        onSaved={onSaved}
                        close={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

// Abreviaturas para el auto-generador de SKU (mismo criterio que el alta vieja).
const categoryAbbrevs: Record<string, string> = {
    pantalla: "SCR", pantallas: "SCR", screen: "SCR",
    bateria: "BAT", baterias: "BAT", battery: "BAT", batería: "BAT", baterías: "BAT",
    cargador: "CHG", cargadores: "CHG", charger: "CHG",
    cable: "CBL", cables: "CBL",
    funda: "CSE", fundas: "CSE", case: "CSE",
    flex: "FLX", "flex cable": "FLX",
    camara: "CAM", cámara: "CAM", camaras: "CAM",
    altavoz: "SPK", bocina: "SPK", speaker: "SPK",
    conector: "CON", "conector de carga": "CON",
    tapa: "BCK", "tapa trasera": "BCK",
    cristal: "GLS", vidrio: "GLS", mica: "GLS",
    boton: "BTN", botón: "BTN",
    sensor: "SNS",
    chip: "CHP", ic: "CHP",
    herramienta: "TLS", herramientas: "TLS", tool: "TLS",
    adhesivo: "ADH", pegamento: "ADH",
    tornillo: "SCW", tornillos: "SCW",
}
const brandAbbrevs: Record<string, string> = {
    apple: "AP", samsung: "SM", huawei: "HW", xiaomi: "XI",
    motorola: "MT", lg: "LG", google: "GG", sony: "SN",
    oppo: "OP", realme: "RM", oneplus: "1P", nokia: "NK",
    honor: "HN", vivo: "VV", tcl: "TC", zte: "ZT",
}
function abbreviateModel(name: string): string {
    return name
        .replace(/iPhone\s*/i, "I")
        .replace(/iPad\s*/i, "PD")
        .replace(/Galaxy\s*/i, "G")
        .replace(/Pro Max/i, "PM")
        .replace(/Pro/i, "P")
        .replace(/Plus/i, "PL")
        .replace(/Ultra/i, "U")
        .replace(/mini/i, "MN")
        .replace(/Max/i, "MX")
        .replace(/SE/i, "SE")
        .replace(/Air/i, "A")
        .replace(/\s*\(.+?\)\s*/g, "")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .substring(0, 8)
}

interface ProductoFormProps {
    productId: string | null
    initialBarcode: string | null
    isAdmin: boolean
    branches: BranchOption[]
    lockedBranchId: string | null
    onSaved: () => void
    close: () => void
}

function ProductoForm({ productId, initialBarcode, isAdmin, branches, lockedBranchId, onSaved, close }: ProductoFormProps) {
    const editing = Boolean(productId)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")
    const [loadError, setLoadError] = useState<string | null>(null)

    const [brands, setBrands] = useState<Brand[]>([])
    const [models, setModels] = useState<Model[]>([])
    const [categories, setCategories] = useState<Category[]>([])

    const [selectedBrand, setSelectedBrand] = useState("")
    const [selectedModels, setSelectedModels] = useState<Model[]>([])
    const [images, setImages] = useState<string[]>([])

    // Altas rápidas de clasificación sin salir del diálogo.
    const [dialogCategory, setDialogCategory] = useState(false)
    const [dialogBrand, setDialogBrand] = useState(false)
    const [dialogModel, setDialogModel] = useState(false)
    const [newCategoryName, setNewCategoryName] = useState("")
    const [newBrandName, setNewBrandName] = useState("")
    const [newModelName, setNewModelName] = useState("")
    const [newModelBrandId, setNewModelBrandId] = useState("")
    const [adding, setAdding] = useState(false)

    // Bloquea el submit mientras una foto sigue subiendo (evita guardar sin ella).
    const [uploadingImages, setUploadingImages] = useState(false)

    const [formData, setFormData] = useState({
        name: "",
        description: "",
        barcode: initialBarcode ?? "",
        retailPrice: "",
        wholesalePrice: "",
        internalPrice: "",
        costPrice: "",
        marketVisibility: "HIDDEN" as MarketVisibility,
        stock: "0",
        minStock: "1",
        categoryId: "",
        isUniversal: false,
        isActive: true,
    })
    // Sucursal que recibe el ajuste de existencias en edición.
    // Empleado: fija en su homeBranch; admin: elegible.
    const [stockBranchId, setStockBranchId] = useState(lockedBranchId ?? branches[0]?.id ?? "")
    const stockBranchName = branches.find((b) => b.id === stockBranchId)?.name ?? ""

    // Alta: existencias iniciales capturadas por sucursal. El empleado solo
    // captura en su sucursal (fija); el admin puede repartir entre todas.
    const stockBranches = lockedBranchId ? branches.filter((b) => b.id === lockedBranchId) : branches
    const [stockByBranch, setStockByBranch] = useState<Record<string, string>>({})

    const saveOp = useRef<ClientOperationKey | null>(null)

    const fetchCatalogs = useCallback(async () => {
        const [brandsRes, modelsRes, categoriesRes] = await Promise.all([
            fetch("/api/brands"),
            fetch("/api/models"),
            fetch("/api/categories"),
        ])
        const [brandsData, modelsData, categoriesData] = await Promise.all([
            brandsRes.json(),
            modelsRes.json(),
            categoriesRes.json(),
        ])
        setBrands(brandsData ?? [])
        setModels(modelsData ?? [])
        setCategories(categoriesData ?? [])
    }, [])

    useEffect(() => {
        let cancelled = false
        const run = async () => {
            try {
                await fetchCatalogs()
                if (productId) {
                    const res = await fetch(`/api/products/${productId}`)
                    const data: ProductDetail = await res.json()
                    if (!res.ok) throw new Error((data as { error?: string }).error || "Producto no encontrado")
                    if (cancelled) return
                    setSelectedModels(data.models ?? [])
                    setImages(data.images ?? [])
                    setFormData({
                        name: data.name,
                        description: data.description ?? "",
                        barcode: data.barcode ?? "",
                        retailPrice: data.retailPrice?.toString() ?? "",
                        wholesalePrice: data.wholesalePrice?.toString() ?? "",
                        internalPrice: data.internalPrice?.toString() ?? "",
                        costPrice: data.costPrice?.toString() ?? "",
                        marketVisibility: data.marketVisibility ?? "HIDDEN",
                        stock: data.stock.toString(),
                        minStock: data.minStock.toString(),
                        categoryId: data.categoryId,
                        isUniversal: data.isUniversal,
                        isActive: data.isActive,
                    })
                }
            } catch (e) {
                if (!cancelled) setLoadError(e instanceof Error ? e.message : "Error al cargar datos")
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        void run()
        return () => { cancelled = true }
    }, [productId, fetchCatalogs])

    const filteredModels = useMemo(
        () => (selectedBrand ? models.filter((m) => m.brand.name === selectedBrand) : []),
        [selectedBrand, models]
    )

    function generateSKU() {
        const catName = categories.find(c => c.id === formData.categoryId)?.name || ""
        const catCode = categoryAbbrevs[catName.toLowerCase()] || catName.substring(0, 3).toUpperCase()
        if (selectedModels.length === 0) {
            setFormData(prev => ({ ...prev, barcode: catCode + "-UNI" }))
            return
        }
        const firstModel = selectedModels[0]
        const brandCode = brandAbbrevs[firstModel.brand.name.toLowerCase()] || firstModel.brand.name.substring(0, 2).toUpperCase()
        setFormData(prev => ({ ...prev, barcode: `${catCode}-${brandCode}-${abbreviateModel(firstModel.name)}` }))
    }

    async function handleAddCategory() {
        if (!newCategoryName.trim()) return toast.error("Escribe el nombre de la categoría")
        setAdding(true)
        try {
            const res = await fetch("/api/categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newCategoryName.trim() }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al crear categoría")
            await fetchCatalogs()
            setFormData((prev) => ({ ...prev, categoryId: data.id }))
            setNewCategoryName("")
            setDialogCategory(false)
            toast.success("Categoría agregada")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión")
        } finally {
            setAdding(false)
        }
    }

    async function handleAddBrand() {
        if (!newBrandName.trim()) return toast.error("Escribe el nombre de la marca")
        setAdding(true)
        try {
            const res = await fetch("/api/brands", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newBrandName.trim() }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al crear marca")
            await fetchCatalogs()
            setSelectedBrand(data.name)
            setNewBrandName("")
            setDialogBrand(false)
            toast.success("Marca agregada")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión")
        } finally {
            setAdding(false)
        }
    }

    async function handleCreateModel() {
        if (!newModelName.trim() || !newModelBrandId) return toast.error("Escribe el nombre y selecciona la marca")
        setAdding(true)
        try {
            const res = await fetch("/api/models", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newModelName.trim(), brandId: newModelBrandId }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al crear modelo")
            await fetchCatalogs()
            setSelectedModels((prev) => prev.some((m) => m.id === data.id) ? prev : [...prev, data])
            setNewModelName("")
            setNewModelBrandId("")
            setDialogModel(false)
            toast.success("Modelo agregado")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión")
        } finally {
            setAdding(false)
        }
    }

    const handleAddModel = (model: Model) => {
        if (!selectedModels.find((m) => m.id === model.id)) {
            setSelectedModels([...selectedModels, model])
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (saving) return
        setError("")

        if (!formData.isUniversal && selectedModels.length === 0) {
            setError("Selecciona al menos un modelo o marca como universal")
            return
        }
        let stock = 0
        let stockBranch = ""
        // En edición, `stock` es el total y el diff cae en la sucursal elegida.
        // En alta, cada sucursal tiene su propia captura: la primera con qty>0
        // viaja en el POST del producto y el resto como movimientos IN en lote.
        let extraStock: { branchId: string; quantity: number }[] = []
        if (editing) {
            stock = parseInt(formData.stock || "0", 10)
            stockBranch = stockBranchId
            if (stock > 0 && !stockBranchId) {
                setError("Selecciona la sucursal que recibe las existencias")
                return
            }
        } else {
            const entries: { branchId: string; quantity: number }[] = []
            for (const b of stockBranches) {
                const raw = (stockByBranch[b.id] ?? "").trim()
                if (!raw) continue
                const qty = parseInt(raw, 10)
                if (Number.isNaN(qty) || qty < 0) {
                    setError(`Existencias inválidas en ${b.name}`)
                    return
                }
                if (qty > 0) entries.push({ branchId: b.id, quantity: qty })
            }
            stock = entries[0]?.quantity ?? 0
            stockBranch = entries[0]?.branchId ?? ""
            extraStock = entries.slice(1)
        }

        const basePayload = {
            name: formData.name.trim(),
            description: formData.description.trim(),
            barcode: formData.barcode.trim(),
            retailPrice: formData.retailPrice,
            wholesalePrice: formData.wholesalePrice,
            internalPrice: formData.internalPrice.trim() === "" ? null : formData.internalPrice,
            // El costo solo se manda si el viewer es ADMIN (el servidor igual lo ignora si no).
            ...(isAdmin ? { costPrice: formData.costPrice.trim() === "" ? null : formData.costPrice } : {}),
            stock,
            minStock: formData.minStock,
            images,
            isUniversal: formData.isUniversal,
            isActive: formData.isActive,
            categoryId: formData.categoryId,
            modelIds: selectedModels.map((m) => m.id),
            stockBranchId: stockBranch || undefined,
            // Publicar al mercado es decisión del dueño: el empleado no manda
            // el campo y el PUT conserva el valor existente.
            ...(isAdmin ? { marketVisibility: formData.marketVisibility } : {}),
        }

        setSaving(true)
        try {
            if (editing) {
                const res = await fetch(`/api/products/${productId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(basePayload),
                })
                const data = await res.json().catch(() => null)
                if (!res.ok) throw new Error(data?.error || "Error al actualizar producto")
            } else {
                saveOp.current = getClientOperationKey(saveOp.current, basePayload)
                const res = await fetch("/api/products", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...basePayload, idempotencyKey: saveOp.current.key }),
                })
                const data = await res.json().catch(() => null)
                if (!res.ok) throw new Error(data?.error || "Error al crear producto")
                const saveKey = saveOp.current?.key ?? crypto.randomUUID()
                saveOp.current = null
                // El POST no acepta marketVisibility (nace HIDDEN); si se pidió
                // otra visibilidad se aplica con un PUT inmediato. Se manda el
                // mismo stock total para que el diff de existencias quede en 0
                // (el alta ya registró el stock inicial en su sucursal). Debe
                // ir ANTES de cargar las demás sucursales para que el diff no
                // genere un ajuste fantasma.
                if (isAdmin && data?.id && formData.marketVisibility !== "HIDDEN") {
                    const putRes = await fetch(`/api/products/${data.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ...basePayload, stockBranchId: undefined }),
                    })
                    if (!putRes.ok) {
                        const putData = await putRes.json().catch(() => null)
                        toast.error(putData?.error || "Producto creado, pero no se pudo fijar la visibilidad.")
                    }
                }
                // El resto de sucursales capturadas: entradas IN en una sola
                // llamada batch (también idempotente).
                if (data?.id && extraStock.length > 0) {
                    const inRes = await fetch("/api/inventory", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            items: extraStock.map((e) => ({
                                productId: data.id,
                                type: "IN",
                                quantity: e.quantity,
                                reason: "Stock inicial",
                                branchId: e.branchId,
                            })),
                            idempotencyKey: `${saveKey}:stock-extra`,
                        }),
                    })
                    if (!inRes.ok) {
                        const inData = await inRes.json().catch(() => null)
                        toast.error(inData?.error || "Producto creado, pero el stock de otras sucursales no se cargó. Complétalo desde Entrada rápida.")
                    }
                }
            }
            toast.success(editing ? "Producto actualizado" : "Producto dado de alta")
            close()
            onSaved()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error al guardar")
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (loadError) {
        return (
            <div role="alert" className="space-y-4 py-6">
                <p className="text-sm text-destructive">{loadError}</p>
                <DialogFooter>
                    <Button variant="outline" onClick={close}>Cerrar</Button>
                </DialogFooter>
            </div>
        )
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <DialogHeader>
                <DialogTitle>{editing ? "Editar producto" : "Dar de alta producto"}</DialogTitle>
                <DialogDescription>
                    {editing
                        ? "Modifica la información del producto; el ajuste de existencias se aplica sobre una sola sucursal."
                        : "Registra una nueva pieza en el inventario."}
                </DialogDescription>
            </DialogHeader>

            {error && (
                <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md" role="alert">
                    {error}
                </div>
            )}

            {/* Fotografías */}
            <div className="space-y-2">
                <Label>Fotografías</Label>
                <ImageUpload images={images} onChange={setImages} maxImages={5} onUploadingChange={setUploadingImages} />
                <p className="text-xs text-muted-foreground">Hasta 5 imágenes; la primera es la principal.</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Información básica */}
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="pf-name">Nombre del producto *</Label>
                        <Input
                            id="pf-name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Ej: Pantalla LCD Original"
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="pf-description">Descripción</Label>
                        <textarea
                            id="pf-description"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Descripción detallada del producto..."
                            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="pf-barcode">Código SKU / barras</Label>
                        <div className="flex gap-2">
                            <Input
                                id="pf-barcode"
                                value={formData.barcode}
                                onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                                placeholder="Se auto-genera o captura manual"
                                className="min-w-0"
                            />
                            <Button type="button" variant="outline" onClick={generateSKU} title="Auto-generar SKU">
                                <Wand2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="pf-category">Categoría *</Label>
                        <div className="flex gap-2">
                            <select
                                id="pf-category"
                                value={formData.categoryId}
                                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                                className={selectClassName}
                                required
                            >
                                <option value="">Selecciona categoría</option>
                                {categories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                            </select>
                            <Dialog open={dialogCategory} onOpenChange={setDialogCategory}>
                                <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="icon" title="Agregar categoría">
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Nueva categoría</DialogTitle>
                                    </DialogHeader>
                                    <div className="space-y-2 py-2">
                                        <Label htmlFor="pf-new-category">Nombre</Label>
                                        <Input
                                            id="pf-new-category"
                                            value={newCategoryName}
                                            onChange={(e) => setNewCategoryName(e.target.value)}
                                            placeholder="Ej: Pantallas"
                                        />
                                    </div>
                                    <DialogFooter>
                                        <Button type="button" variant="outline" onClick={() => setDialogCategory(false)}>Cancelar</Button>
                                        <Button type="button" onClick={() => void handleAddCategory()} disabled={adding}>
                                            {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                            Agregar
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </div>
                    </div>

                    {editing && (
                        <div className="flex items-center gap-2 pt-2">
                            <input
                                type="checkbox"
                                id="pf-active"
                                checked={formData.isActive}
                                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                className="h-4 w-4"
                            />
                            <Label htmlFor="pf-active" className="cursor-pointer">
                                Producto activo (visible en sistema, catálogo y bot)
                            </Label>
                        </div>
                    )}
                </div>

                {/* Precios y stock */}
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="pf-retail">Precio público *</Label>
                            <Input
                                id="pf-retail"
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.retailPrice}
                                onChange={(e) => setFormData({ ...formData, retailPrice: e.target.value })}
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="pf-wholesale">Precio aliado</Label>
                            <Input
                                id="pf-wholesale"
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.wholesalePrice}
                                onChange={(e) => setFormData({ ...formData, wholesalePrice: e.target.value })}
                                placeholder="Vacío = igual al público"
                            />
                        </div>
                    </div>

                    <div className={`grid gap-4 ${isAdmin ? "grid-cols-2" : "grid-cols-1"}`}>
                        <div className="space-y-2">
                            <Label htmlFor="pf-internal">Taller propio</Label>
                            <Input
                                id="pf-internal"
                                type="number"
                                step="0.01"
                                min="0"
                                value={formData.internalPrice}
                                onChange={(e) => setFormData({ ...formData, internalPrice: e.target.value })}
                                placeholder="Vacío = cobra precio público"
                            />
                            <p className="text-xs text-muted-foreground">
                                Pieza usada en una reparación propia; sin precio se cobra al público.
                            </p>
                        </div>
                        {/* El costo revela el margen: solo el dueño lo ve/captura. */}
                        {isAdmin && (
                            <div className="space-y-2">
                                <Label htmlFor="pf-cost">Costo</Label>
                                <Input
                                    id="pf-cost"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={formData.costPrice}
                                    onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })}
                                    placeholder="0.00"
                                />
                            </div>
                        )}
                    </div>

                    {isAdmin && formData.costPrice && formData.retailPrice && parseFloat(formData.costPrice) > 0 && (
                        <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                            <p className="font-medium">Ganancia estimada:</p>
                            <div className="flex flex-wrap gap-4">
                                <span className="text-green-600">
                                    Público: ${(parseFloat(formData.retailPrice) - parseFloat(formData.costPrice)).toFixed(2)} ({((parseFloat(formData.retailPrice) - parseFloat(formData.costPrice)) / parseFloat(formData.costPrice) * 100).toFixed(0)}%)
                                </span>
                                {formData.wholesalePrice && (
                                    <span className="text-blue-600">
                                        Aliado: ${(parseFloat(formData.wholesalePrice) - parseFloat(formData.costPrice)).toFixed(2)} ({((parseFloat(formData.wholesalePrice) - parseFloat(formData.costPrice)) / parseFloat(formData.costPrice) * 100).toFixed(0)}%)
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Visibilidad en el mercado: publicar fuera del taller es
                        decisión del dueño (como el costo), no del empleado. */}
                    {isAdmin && (
                        <div className="space-y-2">
                            <Label htmlFor="pf-visibility" className="flex items-center gap-1.5">
                                <Store className="h-4 w-4 text-muted-foreground" />
                                Visibilidad en el mercado
                            </Label>
                            <Select
                                value={formData.marketVisibility}
                                onValueChange={(v) => setFormData({ ...formData, marketVisibility: v as MarketVisibility })}
                            >
                                <SelectTrigger id="pf-visibility">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="HIDDEN">Oculto — nadie lo ve fuera del taller</SelectItem>
                                    <SelectItem value="ALLIES">Aliados — solo talleres con cuenta</SelectItem>
                                    <SelectItem value="PUBLIC">Público — también el público general</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className={`grid gap-4 ${editing ? "grid-cols-2" : "grid-cols-1"}`}>
                        {editing && (
                            <div className="space-y-2">
                                <Label htmlFor="pf-stock">Existencias (total)</Label>
                                <Input
                                    id="pf-stock"
                                    type="number"
                                    min="0"
                                    step="1"
                                    inputMode="numeric"
                                    value={formData.stock}
                                    onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    El ajuste se aplica en {stockBranchName || "la sucursal elegida"}.
                                </p>
                            </div>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="pf-minstock">Stock mínimo (alerta)</Label>
                            <Input
                                id="pf-minstock"
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                value={formData.minStock}
                                onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
                            />
                        </div>
                    </div>

                    {editing ? (
                        <div className="space-y-2">
                            <Label htmlFor="pf-stock-branch">Sucursal del ajuste</Label>
                            {/* Empleado: su sucursal va fija (label); el admin elige. */}
                            {lockedBranchId ? (
                                <p className="h-10 flex items-center rounded-md border bg-muted/40 px-3 text-sm">
                                    {stockBranchName || "Mi sucursal"}
                                </p>
                            ) : (
                                <Select value={stockBranchId} onValueChange={setStockBranchId}>
                                    <SelectTrigger id="pf-stock-branch">
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
                    ) : (
                        <div className="space-y-2">
                            <Label>Stock inicial por sucursal</Label>
                            <div className="space-y-2 rounded-lg border p-3">
                                {stockBranches.map((b) => (
                                    <div key={b.id} className="flex items-center gap-3">
                                        <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                                        <Input
                                            type="number"
                                            min="0"
                                            step="1"
                                            inputMode="numeric"
                                            className="w-24 shrink-0"
                                            placeholder="0"
                                            value={stockByBranch[b.id] ?? ""}
                                            onChange={(e) => setStockByBranch((prev) => ({ ...prev, [b.id]: e.target.value }))}
                                            aria-label={`Stock inicial en ${b.name}`}
                                        />
                                    </div>
                                ))}
                                {stockBranches.length === 0 && (
                                    <p className="text-xs text-muted-foreground">No hay sucursales activas.</p>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Deja en blanco las sucursales sin existencias; cada cantidad queda registrada como entrada inicial.
                            </p>
                        </div>
                    )}

                    <div className="flex items-center gap-2 pt-2">
                        <input
                            type="checkbox"
                            id="pf-universal"
                            checked={formData.isUniversal}
                            onChange={(e) => setFormData({ ...formData, isUniversal: e.target.checked })}
                            className="h-4 w-4"
                        />
                        <Label htmlFor="pf-universal" className="cursor-pointer flex items-center gap-2">
                            <Globe className="h-4 w-4" />
                            Producto universal (compatible con todos los modelos)
                        </Label>
                    </div>
                </div>
            </div>

            {/* Modelos compatibles */}
            {!formData.isUniversal && (
                <div className="space-y-4 rounded-lg border p-4">
                    <div>
                        <p className="font-medium">Modelos compatibles</p>
                        <p className="text-sm text-muted-foreground">
                            Selecciona los modelos de celular con los que es compatible esta refacción.
                        </p>
                    </div>

                    {selectedModels.length > 0 && (
                        <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg">
                            {selectedModels.map((model) => (
                                <Badge key={model.id} variant="secondary" className="gap-1">
                                    {model.brand.name} {model.name}
                                    <button
                                        type="button"
                                        onClick={() => setSelectedModels(selectedModels.filter((m) => m.id !== model.id))}
                                        className="ml-1 hover:text-destructive"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Filtrar por marca</Label>
                            <div className="flex gap-2">
                                <select
                                    value={selectedBrand}
                                    onChange={(e) => setSelectedBrand(e.target.value)}
                                    className={selectClassName}
                                >
                                    <option value="">Todas las marcas</option>
                                    {brands.map((brand) => (
                                        <option key={brand.id} value={brand.name}>{brand.name}</option>
                                    ))}
                                </select>
                                <Dialog open={dialogBrand} onOpenChange={setDialogBrand}>
                                    <DialogTrigger asChild>
                                        <Button type="button" variant="outline" size="icon" title="Agregar marca">
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Nueva marca</DialogTitle>
                                        </DialogHeader>
                                        <div className="space-y-2 py-2">
                                            <Label htmlFor="pf-new-brand">Nombre</Label>
                                            <Input
                                                id="pf-new-brand"
                                                value={newBrandName}
                                                onChange={(e) => setNewBrandName(e.target.value)}
                                                placeholder="Ej: Samsung"
                                            />
                                        </div>
                                        <DialogFooter>
                                            <Button type="button" variant="outline" onClick={() => setDialogBrand(false)}>Cancelar</Button>
                                            <Button type="button" onClick={() => void handleAddBrand()} disabled={adding}>
                                                {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                                Agregar
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Agregar modelo</Label>
                            <div className="flex gap-2">
                                <select
                                    id="pf-model-select"
                                    className={selectClassName}
                                    value=""
                                    onChange={(e) => {
                                        const model = models.find((m) => m.id === e.target.value)
                                        if (model) handleAddModel(model)
                                    }}
                                >
                                    <option value="" disabled>Selecciona modelo para agregar</option>
                                    {(selectedBrand ? filteredModels : models)
                                        .filter((m) => !selectedModels.some((s) => s.id === m.id))
                                        .map((model) => (
                                            <option key={model.id} value={model.id}>
                                                {model.brand.name} {model.name}
                                            </option>
                                        ))}
                                </select>
                                <Dialog open={dialogModel} onOpenChange={setDialogModel}>
                                    <DialogTrigger asChild>
                                        <Button type="button" variant="outline" size="sm" title="Crear nuevo modelo">
                                            Nuevo
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Nuevo modelo</DialogTitle>
                                        </DialogHeader>
                                        <div className="space-y-4 py-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="pf-new-model-brand">Marca</Label>
                                                <select
                                                    id="pf-new-model-brand"
                                                    value={newModelBrandId}
                                                    onChange={(e) => setNewModelBrandId(e.target.value)}
                                                    className={selectClassName}
                                                >
                                                    <option value="">Selecciona marca</option>
                                                    {brands.map((b) => (
                                                        <option key={b.id} value={b.id}>{b.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="pf-new-model-name">Nombre del modelo</Label>
                                                <Input
                                                    id="pf-new-model-name"
                                                    value={newModelName}
                                                    onChange={(e) => setNewModelName(e.target.value)}
                                                    placeholder="Ej: Galaxy S24"
                                                />
                                            </div>
                                        </div>
                                        <DialogFooter>
                                            <Button type="button" variant="outline" onClick={() => setDialogModel(false)}>Cancelar</Button>
                                            <Button type="button" onClick={() => void handleCreateModel()} disabled={adding}>
                                                {adding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                                Agregar
                                            </Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={saving}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={saving || uploadingImages} title={uploadingImages ? "Espera a que termine de subir la foto" : undefined}>
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {uploadingImages ? "Subiendo foto…" : editing ? "Guardar cambios" : "Dar de alta"}
                </Button>
            </DialogFooter>
        </form>
    )
}
