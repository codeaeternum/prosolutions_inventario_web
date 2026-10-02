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
import Image from "next/image"
import { cn } from "@/lib/utils"
import { AlertTriangle, ChevronLeft, ChevronRight, Globe, ImagePlus, Loader2, Plus, Store, Wand2, X } from "lucide-react"
import { toast } from "sonner"

const selectClassName =
    "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

export type MarketVisibility = "HIDDEN" | "ALLIES" | "PUBLIC"

/** Apodos comunes en nombres de pieza → marca canónica del catálogo. */
const BRAND_NAME_ALIASES: Record<string, string> = {
    redmi: "xiaomi",
    poco: "xiaomi",
    moto: "motorola",
    iphone: "apple",
    ipad: "apple",
    galaxy: "samsung",
    pixel: "google",
}

/** Vocabulario del negocio: Oculto / solo Aliados / Público general. */
export const VISIBILIDAD_LABELS: Record<MarketVisibility, string> = {
    HIDDEN: "Oculto",
    ALLIES: "Aliados",
    PUBLIC: "Público",
}

/** Tope de fotos por producto (la primera del array es la principal). */
const MAX_PRODUCT_IMAGES = 12

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

    // Fotos en vuelo: cada archivo elegido muestra un placeholder con spinner
    // hasta que /api/upload/product responde. Mientras haya pendientes el
    // submit queda bloqueado para no guardar el producto sin esas fotos.
    const [pendingUploads, setPendingUploads] = useState<{ id: string; name: string }[]>([])
    const uploadingImages = pendingUploads.length > 0
    const photoInputRef = useRef<HTMLInputElement>(null)
    const [photoDragOver, setPhotoDragOver] = useState(false)
    // Descripción es secundaria: va colapsada salvo que el producto ya tenga una.
    const [showDescription, setShowDescription] = useState(false)
    const nameRef = useRef<HTMLInputElement>(null)
    // Buscador de modelos compatibles (reemplaza el select de cientos de filas).
    const [modelQuery, setModelQuery] = useState("")
    const formRef = useRef<HTMLFormElement>(null)

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
                    setShowDescription(Boolean(data.description?.trim()))
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

    // Coincidencias del buscador: texto libre + filtro de marca, sin los ya elegidos.
    const modelMatches = useMemo(() => {
        const base = (selectedBrand ? filteredModels : models)
            .filter((m) => !selectedModels.some((s) => s.id === m.id))
        const q = modelQuery.trim().toLowerCase()
        if (!q) return base.slice(0, 12)
        return base
            .filter((m) => `${m.brand.name} ${m.name}`.toLowerCase().includes(q))
            .slice(0, 12)
    }, [models, filteredModels, selectedBrand, selectedModels, modelQuery])

    // SKU sugerido en vivo: categoría + primer modelo (mismo criterio del botón varita).
    // Aviso suave cuando el nombre menciona una marca distinta a la de los
    // modelos elegidos ("pantalla redmi …" + modelo Realme = captura cruzada).
    // Solo avisa — no bloquea: hay nombres legítimos sin marca.
    const brandMismatch = useMemo(() => {
        if (formData.isUniversal || selectedModels.length === 0) return null
        const fold = (s: string) =>
            s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        const tokens = new Set(fold(formData.name).split(/[^a-z0-9]+/).filter(Boolean))
        const canonical = (s: string) => fold(s)
        const mentioned = new Set<string>()
        for (const b of brands) {
            const key = canonical(b.name)
            if (tokens.has(key)) mentioned.add(key)
        }
        for (const [alias, canon] of Object.entries(BRAND_NAME_ALIASES)) {
            if (tokens.has(alias)) mentioned.add(canon)
        }
        const chosen = new Set(selectedModels.map((m) => canonical(m.brand.name)))
        const conflict = [...mentioned].find((m) => !chosen.has(m))
        if (!conflict) return null
        const display =
            brands.find((b) => canonical(b.name) === conflict)?.name ??
            conflict.charAt(0).toUpperCase() + conflict.slice(1)
        return { mentioned: display, chosen: [...chosen].map((c) => brands.find((b) => canonical(b.name) === c)?.name ?? c) }
    }, [formData.name, formData.isUniversal, selectedModels, brands])

    const skuSuggestion = useMemo(() => {
        const catName = categories.find(c => c.id === formData.categoryId)?.name || ""
        if (!catName) return ""
        const catCode = categoryAbbrevs[catName.toLowerCase()] || catName.substring(0, 3).toUpperCase()
        if (formData.isUniversal || selectedModels.length === 0) return `${catCode}-UNI`
        const firstModel = selectedModels[0]
        const brandCode = brandAbbrevs[firstModel.brand.name.toLowerCase()] || firstModel.brand.name.substring(0, 2).toUpperCase()
        return `${catCode}-${brandCode}-${abbreviateModel(firstModel.name)}`
    }, [categories, formData.categoryId, formData.isUniversal, selectedModels])

    function generateSKU() {
        if (skuSuggestion) setFormData(prev => ({ ...prev, barcode: skuSuggestion }))
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

    // Sube las fotos de a una (mismo endpoint que antes): si un archivo
    // falla se avisa con toast y el resto del lote continúa. Cada URL
    // devuelta se agrega al final y el tope se revalida en el append.
    const uploadProductImages = async (files: FileList | File[] | null) => {
        const list = files ? Array.from(files) : []
        if (list.length === 0) return
        const remaining = MAX_PRODUCT_IMAGES - images.length - pendingUploads.length
        if (remaining <= 0) {
            toast.error(`Máximo ${MAX_PRODUCT_IMAGES} fotos por producto`)
            return
        }
        const queue = list.slice(0, remaining)
        if (list.length > queue.length) {
            toast.error(`Solo caben ${remaining} foto${remaining === 1 ? "" : "s"} más (máximo ${MAX_PRODUCT_IMAGES})`)
        }
        const pending = queue.map((f) => ({ id: crypto.randomUUID(), name: f.name }))
        setPendingUploads((prev) => [...prev, ...pending])
        for (const [i, file] of queue.entries()) {
            const pendingId = pending[i].id
            try {
                if (!file.type.startsWith("image/")) throw new Error(`«${file.name}» no es una imagen`)
                const body = new FormData()
                body.append("file", file)
                const res = await fetch("/api/upload/product", { method: "POST", body })
                const data: { url?: string; error?: string } | null = await res.json().catch(() => null)
                if (!res.ok || !data?.url) throw new Error(data?.error ?? `No se pudo subir «${file.name}»`)
                const url = data.url
                setImages((prev) => (prev.length < MAX_PRODUCT_IMAGES ? [...prev, url] : prev))
            } catch (err) {
                toast.error(err instanceof Error ? err.message : `No se pudo subir «${file.name}»`)
            } finally {
                setPendingUploads((prev) => prev.filter((p) => p.id !== pendingId))
            }
        }
    }

    // El orden del array manda: images[0] es la foto principal.
    const moveImage = (from: number, to: number) => {
        setImages((prev) => {
            if (to < 0 || to >= prev.length) return prev
            const next = [...prev]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
        })
    }

    const removeImage = (index: number) => {
        setImages((prev) => prev.filter((_, i) => i !== index))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (saving) return
        setError("")

        // Validación propia con nombres de campo (las burbujas nativas de
        // Chrome quedan escondidas dentro del scroll del diálogo).
        const missing: string[] = []
        if (!formData.name.trim()) missing.push("Nombre")
        if (!formData.categoryId) missing.push("Categoría")
        if (!formData.retailPrice.trim() || Number.isNaN(parseFloat(formData.retailPrice))) missing.push("Precio público")
        if (missing.length > 0) {
            const msg = `Completa: ${missing.join(", ")}`
            setError(msg)
            toast.error(msg)
            return
        }

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
            // "Guardar y crear otro" se distingue por el botón que disparó el
            // submit (submitter), sin estado residual si la validación falla.
            const createAnother =
                !editing &&
                ((e.nativeEvent as SubmitEvent).submitter as HTMLElement | null)?.dataset.intent === "another"
            if (createAnother) {
                // Alta en serie: limpia el form y deja el foco en Nombre.
                // Conserva categoría, visibilidad y el filtro de marca — la
                // captura por lote suele repetir tipo/proveedor/destino. Los
                // precios y el stock se limpian: son por pieza y arrastrarlos
                // generaría datos erróneos.
                setFormData({
                    name: "", description: "", barcode: "",
                    retailPrice: "", wholesalePrice: "", internalPrice: "", costPrice: "",
                    marketVisibility: formData.marketVisibility, stock: "0", minStock: "1",
                    categoryId: formData.categoryId,
                    isUniversal: false, isActive: true,
                })
                setSelectedModels([])
                setImages([])
                setPendingUploads([])
                setStockByBranch({})
                setModelQuery("")
                // `selectedBrand` (filtro del select de marca) se conserva a
                // propósito: no hay setSelectedBrand("") en este reset.
                setShowDescription(false)
                formRef.current?.parentElement?.scrollTo({ top: 0 })
                nameRef.current?.focus()
            } else {
                close()
            }
            onSaved()
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Error al guardar"
            setError(msg)
            toast.error(msg)
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
        <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
            // Ctrl/Cmd+Enter guarda desde cualquier campo (captura rápida).
            onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault()
                    formRef.current?.requestSubmit()
                }
            }}
        >
            {/* Título fijo: no se pierde al hacer scroll dentro del diálogo. */}
            <DialogHeader className="sticky top-0 z-10 -mt-6 border-b bg-background pb-3 pt-1 -mx-1 px-1">
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

            {/* Producto: identidad de la pieza (nombre, código, categoría, fotos). */}
            <section className="space-y-4 rounded-lg border p-4">
                <div>
                    <p className="font-medium">Producto</p>
                    <p className="text-sm text-muted-foreground">
                        Qué es la pieza y cómo se identifica.
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="pf-name">Nombre del producto *</Label>
                    <Input
                        id="pf-name"
                        ref={nameRef}
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Ej: Pantalla LCD Original"
                        required
                        autoFocus={!editing}
                    />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
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
                            <Button type="button" variant="outline" onClick={generateSKU} disabled={!skuSuggestion} title="Auto-generar SKU">
                                <Wand2 className="h-4 w-4" />
                            </Button>
                        </div>
                        {/* Sugerencia en vivo: aparece al elegir categoría/modelo y no pisa lo escrito. */}
                        {!formData.barcode && skuSuggestion && (
                            <button
                                type="button"
                                onClick={generateSKU}
                                className="text-xs text-primary hover:underline"
                            >
                                Usar sugerido: <span className="font-mono font-medium">{skuSuggestion}</span>
                            </button>
                        )}
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
                </div>

                {/* Fotos: tira de thumbnails. La primera es la principal y se
                    reordena con flechas (sin drag & drop: en pantallas chicas
                    estorbaba al hacer scroll). La zona también acepta soltar
                    archivos encima. */}
                <div className="space-y-2">
                    <Label>
                        Fotos{" "}
                        <span className="text-muted-foreground font-normal">
                            (opcional, hasta {MAX_PRODUCT_IMAGES}; la primera es la principal)
                        </span>
                    </Label>
                    <input
                        ref={photoInputRef}
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        aria-label="Seleccionar fotos del producto"
                        onChange={(e) => {
                            void uploadProductImages(e.target.files)
                            // Limpiar el input permite volver a elegir el mismo archivo.
                            e.target.value = ""
                        }}
                    />
                    <div
                        className={cn(
                            "flex flex-wrap items-center gap-2 rounded-lg transition-colors",
                            photoDragOver && "ring-2 ring-primary/50"
                        )}
                        onDragOver={(e) => {
                            e.preventDefault()
                            if (e.dataTransfer.types.includes("Files")) setPhotoDragOver(true)
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault()
                            setPhotoDragOver(false)
                        }}
                        onDrop={(e) => {
                            e.preventDefault()
                            setPhotoDragOver(false)
                            void uploadProductImages(e.dataTransfer.files)
                        }}
                    >
                        {images.map((url, index) => (
                            <div
                                key={`${url}-${index}`}
                                className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-muted"
                            >
                                <Image
                                    src={url}
                                    alt={`Foto ${index + 1} de ${formData.name.trim() || "el producto"}`}
                                    fill
                                    sizes="80px"
                                    className="object-cover"
                                    unoptimized={url.startsWith("/api/payment-proofs/") || url.startsWith("/uploads/payments/")}
                                />
                                {index === 0 && (
                                    <span className="absolute left-0.5 top-0.5 rounded bg-primary px-1 py-px text-[9px] text-primary-foreground">
                                        Principal
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeImage(index)}
                                    aria-label={`Quitar foto ${index + 1}`}
                                    title={`Quitar foto ${index + 1}`}
                                    className="absolute right-0.5 top-0.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                                {images.length > 1 && (
                                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/45 px-0.5 py-0.5">
                                        <button
                                            type="button"
                                            onClick={() => moveImage(index, index - 1)}
                                            disabled={index === 0}
                                            aria-label={`Mover foto ${index + 1} a la izquierda`}
                                            title={index === 0 ? "Ya es la foto principal" : `Mover foto ${index + 1} a la izquierda`}
                                            className="rounded p-0.5 text-white transition-colors hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent"
                                        >
                                            <ChevronLeft className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveImage(index, index + 1)}
                                            disabled={index === images.length - 1}
                                            aria-label={`Mover foto ${index + 1} a la derecha`}
                                            title={`Mover foto ${index + 1} a la derecha`}
                                            className="rounded p-0.5 text-white transition-colors hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent"
                                        >
                                            <ChevronRight className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                        {pendingUploads.map((p) => (
                            <div
                                key={p.id}
                                role="status"
                                aria-label={`Subiendo ${p.name}`}
                                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md border bg-muted"
                            >
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ))}
                        {images.length + pendingUploads.length < MAX_PRODUCT_IMAGES && (
                            <button
                                type="button"
                                onClick={() => photoInputRef.current?.click()}
                                className="flex h-20 min-w-28 items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-muted-foreground/25 px-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 hover:text-foreground"
                                title="Arrastra imágenes aquí o haz clic para agregar"
                            >
                                <ImagePlus className="h-4 w-4" />
                                Agregar fotos
                            </button>
                        )}
                    </div>
                    {images.length >= MAX_PRODUCT_IMAGES && (
                        <p className="text-xs text-muted-foreground">
                            Llegaste al máximo de {MAX_PRODUCT_IMAGES} fotos; quita alguna para agregar otra.
                        </p>
                    )}
                </div>

                {/* La descripción es secundaria: colapsada por defecto para no
                    alargar la captura. Se expande sola si el producto ya tiene. */}
                {showDescription ? (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="pf-description">Descripción</Label>
                            <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground"
                                onClick={() => setShowDescription(false)}
                            >
                                Quitar
                            </button>
                        </div>
                        <textarea
                            id="pf-description"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Detalles: calidad, incluye, observaciones…"
                            className="flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                        />
                    </div>
                ) : (
                    <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setShowDescription(true)}
                    >
                        + Agregar descripción (opcional)
                    </button>
                )}

                {editing && (
                    <div className="flex items-center gap-2">
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
            </section>

            {/* Precios: todos en una fila; ganancia y visibilidad dinámicas. */}
            <section className="space-y-4 rounded-lg border p-4">
                <div>
                    <p className="font-medium">Precios</p>
                    <p className="text-sm text-muted-foreground">
                        Aliado y taller son opcionales; vacíos cobran el precio público.
                    </p>
                </div>

                <div className={`grid gap-4 sm:grid-cols-2 ${isAdmin ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
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
                            placeholder="= al público"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="pf-internal">Taller propio</Label>
                        <Input
                            id="pf-internal"
                            type="number"
                            step="0.01"
                            min="0"
                            value={formData.internalPrice}
                            onChange={(e) => setFormData({ ...formData, internalPrice: e.target.value })}
                            placeholder="= al público"
                        />
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

                {/* Ganancia estimada: solo con costo capturado (admin). */}
                {isAdmin && formData.costPrice && formData.retailPrice && parseFloat(formData.costPrice) > 0 && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="font-medium">Ganancia:</span>
                        <span className="text-green-600">
                            Público ${(parseFloat(formData.retailPrice) - parseFloat(formData.costPrice)).toFixed(2)} ({((parseFloat(formData.retailPrice) - parseFloat(formData.costPrice)) / parseFloat(formData.costPrice) * 100).toFixed(0)}%)
                        </span>
                        {formData.wholesalePrice && (
                            <span className="text-blue-600">
                                Aliado ${(parseFloat(formData.wholesalePrice) - parseFloat(formData.costPrice)).toFixed(2)} ({((parseFloat(formData.wholesalePrice) - parseFloat(formData.costPrice)) / parseFloat(formData.costPrice) * 100).toFixed(0)}%)
                            </span>
                        )}
                    </div>
                )}

                {/* Visibilidad en el mercado: publicar fuera del taller es
                    decisión del dueño (como el costo), no del empleado. */}
                {isAdmin && (
                    <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
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
                        {/* Aviso dinámico: publicar sin precio aliado usa el público. */}
                        {formData.marketVisibility !== "HIDDEN" && !formData.wholesalePrice.trim() && (
                            <p className="text-xs text-amber-600 dark:text-amber-500 sm:pb-3">
                                Sin precio aliado se publicará a precio público
                                {formData.retailPrice ? ` ($${formData.retailPrice})` : ""}.
                            </p>
                        )}
                    </div>
                )}
            </section>

            {/* Existencias */}
            <section className="space-y-4 rounded-lg border p-4">
                <div>
                    <p className="font-medium">Existencias</p>
                    <p className="text-sm text-muted-foreground">
                        {editing
                            ? "El ajuste se aplica sobre una sola sucursal."
                            : "Deja en blanco las sucursales sin existencias; cada cantidad queda como entrada inicial."}
                    </p>
                </div>
                {editing ? (
                    <div className="grid gap-4 sm:grid-cols-3">
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
                        </div>
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
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-end justify-between gap-4">
                            <div className="space-y-2 w-40">
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
                            {stockBranches.length > 1 && Object.values(stockByBranch).some((v) => v.trim()) && (
                                <button
                                    type="button"
                                    className="text-xs text-primary hover:underline pb-2"
                                    onClick={() => {
                                        const first = Object.values(stockByBranch).find((v) => v.trim())
                                        if (first) setStockByBranch(Object.fromEntries(stockBranches.map((b) => [b.id, first])))
                                    }}
                                >
                                    Igual cantidad en todas
                                </button>
                            )}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {stockBranches.map((b) => (
                                <div key={b.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                                    <span className="min-w-0 flex-1 truncate text-sm">{b.name}</span>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        inputMode="numeric"
                                        className="w-20 shrink-0"
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
                    </div>
                )}
            </section>

            {/* Compatibilidad */}
            <section className="space-y-4 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="font-medium">Compatibilidad</p>
                        <p className="text-sm text-muted-foreground">
                            Modelos de celular con los que es compatible esta refacción.
                        </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <input
                            type="checkbox"
                            id="pf-universal"
                            checked={formData.isUniversal}
                            onChange={(e) => setFormData({ ...formData, isUniversal: e.target.checked })}
                            className="h-4 w-4"
                        />
                        <Label htmlFor="pf-universal" className="cursor-pointer flex items-center gap-1.5 text-sm">
                            <Globe className="h-4 w-4" />
                            Universal
                        </Label>
                    </div>
                </div>

                {!formData.isUniversal && (
                    <>
                        {brandMismatch && (
                            <p className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                El nombre menciona «{brandMismatch.mentioned}» pero elegiste modelos de {brandMismatch.chosen.join(", ")} — revisa que sea correcto.
                            </p>
                        )}
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

                        {/* Buscador de modelos: escribe y elige — Enter agrega la primera coincidencia. */}
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <Input
                                    value={modelQuery}
                                    onChange={(e) => setModelQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault()
                                            if (modelMatches[0]) {
                                                handleAddModel(modelMatches[0])
                                                setModelQuery("")
                                            }
                                        }
                                    }}
                                    placeholder="Buscar modelo (ej. A54, iPhone 13)…"
                                    className="min-w-0"
                                    aria-label="Buscar modelo compatible"
                                />
                                <select
                                    value={selectedBrand}
                                    onChange={(e) => setSelectedBrand(e.target.value)}
                                    className={cn(selectClassName, "w-36 shrink-0")}
                                    aria-label="Filtrar por marca"
                                >
                                    <option value="">Todas las marcas</option>
                                    {brands.map((brand) => (
                                        <option key={brand.id} value={brand.name}>{brand.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="max-h-44 overflow-y-auto rounded-md border divide-y">
                                {modelMatches.map((model) => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        onClick={() => { handleAddModel(model); setModelQuery("") }}
                                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                                    >
                                        <span className="truncate">{model.brand.name} {model.name}</span>
                                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    </button>
                                ))}
                                {modelMatches.length === 0 && (
                                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                                        Sin coincidencias — crea el modelo abajo.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Dialog open={dialogBrand} onOpenChange={setDialogBrand}>
                                <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="sm">
                                        <Plus className="h-4 w-4 mr-1" /> Nueva marca
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
                            <Dialog open={dialogModel} onOpenChange={setDialogModel}>
                                <DialogTrigger asChild>
                                    <Button type="button" variant="outline" size="sm">
                                        <Plus className="h-4 w-4 mr-1" /> Nuevo modelo
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
                    </>
                )}
            </section>

            {/* Footer fijo: el submit siempre visible sin llegar al fondo. */}
            <DialogFooter className="sticky bottom-0 z-10 -mx-1 -mb-6 gap-2 border-t bg-background px-1 pb-1 pt-3 sm:justify-between">
                <div className="text-xs text-muted-foreground self-center hidden sm:block">
                    Los campos con * son obligatorios. <kbd className="rounded border px-1">Ctrl</kbd>+<kbd className="rounded border px-1">Enter</kbd> guarda.
                </div>
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={close} disabled={saving}>
                        Cancelar
                    </Button>
                    {!editing && (
                        <Button
                            type="submit"
                            variant="secondary"
                            data-intent="another"
                            disabled={saving || uploadingImages}
                            title="Guarda y limpia el formulario para dar de alta otra pieza"
                        >
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar y crear otro
                        </Button>
                    )}
                    <Button type="submit" disabled={saving || uploadingImages} title={uploadingImages ? "Espera a que terminen de subir las fotos" : undefined}>
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {uploadingImages ? "Subiendo fotos…" : editing ? "Guardar cambios" : "Dar de alta"}
                    </Button>
                </div>
            </DialogFooter>
        </form>
    )
}
