"use client"

import { useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ImagePlus, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/** Producto mínimo para emparejar fotos por nombre de archivo (compatible con productDto). */
export interface FotoImportProduct {
    id: string
    name: string
    sku?: string | null
    barcode?: string | null
    images: string[]
}

interface FotosImportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    products: FotoImportProduct[]
    onDone: () => void
}

const ACCEPT = "image/jpeg,image/png,image/webp"
const ACCEPTED = new Set(ACCEPT.split(","))

const stemOf = (fileName: string) => fileName.replace(/\.[^./\\]+$/, "")

/** Base del match: minúsculas, guiones/underscores como espacios y espacios colapsados. */
const normalize = (value: string) =>
    value.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim()

/**
 * Sugiere el producto de un archivo por su nombre, en orden de prioridad:
 * SKU exacto → código de barras exacto → nombre exacto → nombre que contiene
 * el stem (o viceversa). Solo propone cuando el nivel tiene un único candidato;
 * si hay empate o no hay match queda "Sin asignar" para elegirlo a mano.
 */
function guessProductId(stemRaw: string, products: FotoImportProduct[]): string {
    const stem = normalize(stemRaw)
    if (!stem) return ""
    const unique = (pred: (p: FotoImportProduct) => boolean) => {
        const hits = products.filter(pred)
        return hits.length === 1 ? hits[0].id : null
    }
    return (
        unique(p => Boolean(p.sku) && normalize(p.sku as string) === stem) ??
        unique(p => Boolean(p.barcode) && (p.barcode === stemRaw || normalize(p.barcode as string) === stem)) ??
        unique(p => normalize(p.name) === stem) ??
        unique(p => { const n = normalize(p.name); return n.includes(stem) || stem.includes(n) }) ??
        ""
    )
}

const productLabel = (p: FotoImportProduct) => {
    const code = p.sku || p.barcode
    return code ? `${p.name} · ${code}` : p.name
}

interface FotoRow {
    key: string
    file: File
    /** Object URL local del thumbnail; se revoca al quitar la fila o cerrar el diálogo. */
    previewUrl: string
    /** "" = sin asignar: la fila se omite al confirmar. */
    productId: string
    /** El usuario eligió el destino a mano: no se re-adivina al cargar el catálogo. */
    manual?: boolean
    status: "pending" | "ok" | "error"
    error?: string
}

/**
 * Asignación masiva de fotos: el nombre del archivo (SKU, código de barras o
 * nombre del producto) preselecciona el destino y cada foto se sube a
 * /api/upload/product; las URLs resultantes se aplican en un solo POST a
 * /api/products/photos (append por producto).
 */
export function FotosImportDialog({ open, onOpenChange, products, onDone }: FotosImportDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                {/* DialogContent desmonta al cerrar: la lista reinicia su estado en cada apertura. */}
                {open && (
                    <FotosForm
                        products={products}
                        onDone={onDone}
                        close={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

function FotosForm({ products, onDone, close }: { products: FotoImportProduct[]; onDone: () => void; close: () => void }) {
    // Catálogo completo para el match: `products` llega filtrado/paginado según la
    // vista actual; aquí se reemplaza por la lista sin filtros (hasta 10 páginas).
    const [catalog, setCatalog] = useState<FotoImportProduct[]>(products)
    const [rows, setRows] = useState<FotoRow[]>([])
    const [dragOver, setDragOver] = useState(false)
    const [working, setWorking] = useState(false)
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const previewsRef = useRef<Set<string>>(new Set())
    const operation = useRef<ClientOperationKey | null>(null)

    // Libera los object URLs al desmontar (el form se desmonta al cerrar el diálogo).
    useEffect(() => {
        const previews = previewsRef.current
        return () => previews.forEach(url => URL.revokeObjectURL(url))
    }, [])

    // Carga el catálogo completo en segundo plano y re-afina los matches
    // automáticos (los que el usuario ya movió a mano se respetan).
    useEffect(() => {
        let cancelled = false
        void (async () => {
            const all: FotoImportProduct[] = []
            try {
                for (let page = 1; page <= 10; page++) {
                    const res = await fetch(`/api/products?page=${page}&limit=100`)
                    if (!res.ok) return
                    const data = await res.json().catch(() => null)
                    const list = (data?.products ?? []) as FotoImportProduct[]
                    all.push(...list)
                    if (all.length >= (data?.total ?? all.length) || list.length === 0) break
                }
            } catch { /* sin catálogo completo: se trabaja con lo visible */ }
            if (cancelled || all.length === 0) return
            setCatalog(all)
            setRows(prev => prev.map(r =>
                r.manual ? r : { ...r, productId: guessProductId(stemOf(r.file.name), all) }
            ))
        })()
        return () => { cancelled = true }
    }, [])

    const addFiles = (files: FileList | null) => {
        if (!files?.length || working) return
        const valid = Array.from(files).filter(f => ACCEPTED.has(f.type))
        if (valid.length < files.length) {
            toast.error("Algunos archivos se omitieron: solo JPEG, PNG o WebP.")
        }
        if (!valid.length) return
        setRows(prev => {
            const next = [...prev]
            for (const file of valid) {
                // El mismo archivo (nombre + tamaño) ya en la lista no se duplica.
                if (next.some(r => r.file.name === file.name && r.file.size === file.size)) continue
                const previewUrl = URL.createObjectURL(file)
                previewsRef.current.add(previewUrl)
                next.push({
                    key: Math.random().toString(36).substring(7),
                    file,
                    previewUrl,
                    productId: guessProductId(stemOf(file.name), catalog),
                    status: "pending",
                })
            }
            return next
        })
    }

    const setRowProduct = (key: string, productId: string) =>
        setRows(prev => prev.map(r => r.key === key ? { ...r, productId, manual: true, status: "pending", error: undefined } : r))

    const removeRow = (key: string) =>
        setRows(prev => {
            const row = prev.find(r => r.key === key)
            if (row) {
                URL.revokeObjectURL(row.previewUrl)
                previewsRef.current.delete(row.previewUrl)
            }
            return prev.filter(r => r.key !== key)
        })

    const targets = rows.filter(r => r.productId)

    const handleConfirm = async () => {
        if (working) return
        if (targets.length === 0) return toast.error("Asigna al menos una foto a un producto.")

        setWorking(true)
        setProgress({ done: 0, total: targets.length })
        // Varios archivos pueden ir al mismo producto: se acumulan sus URLs.
        const urlsByProduct = new Map<string, string[]>()
        const failedKeys = new Set<string>()
        try {
            for (const row of targets) {
                try {
                    const formData = new FormData()
                    formData.append("file", row.file)
                    const res = await fetch("/api/upload/product", { method: "POST", body: formData })
                    const data = await res.json().catch(() => null)
                    if (!res.ok || !data?.url) throw new Error(data?.error || "No se pudo subir la imagen.")
                    const list = urlsByProduct.get(row.productId) ?? []
                    list.push(data.url)
                    urlsByProduct.set(row.productId, list)
                    setRows(prev => prev.map(r => r.key === row.key ? { ...r, status: "ok" } : r))
                } catch (error) {
                    // Una foto que falla no detiene la tanda: queda marcada y se puede reintentar.
                    failedKeys.add(row.key)
                    setRows(prev => prev.map(r => r.key === row.key
                        ? { ...r, status: "error", error: error instanceof Error ? error.message : "Error al subir" }
                        : r))
                } finally {
                    setProgress(p => (p ? { ...p, done: p.done + 1 } : p))
                }
            }

            if (urlsByProduct.size === 0) {
                toast.error("Ninguna foto se pudo subir.")
                return
            }

            const assignments = Array.from(urlsByProduct, ([productId, images]) => ({ productId, images }))
            operation.current = getClientOperationKey(operation.current, assignments)
            const res = await fetch("/api/products/photos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignments, idempotencyKey: operation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudieron asignar las fotos.")
            operation.current = null

            const uploaded = Array.from(urlsByProduct.values()).reduce((sum, urls) => sum + urls.length, 0)
            const skipped = rows.length - targets.length
            const failed = failedKeys.size
            const parts = [`${urlsByProduct.size} producto(s)`, `${uploaded} archivo(s)`]
            if (skipped) parts.push(`${skipped} omitido(s)`)
            if (failed) parts.push(`${failed} con error`)
            toast.success(`Fotos asignadas: ${parts.join(", ")}`)
            onDone()

            if (failed === 0) {
                close()
            } else {
                // Las filas ya aplicadas salen de la lista; quedan las de error para reintentar.
                setRows(prev => {
                    prev.filter(r => r.productId && !failedKeys.has(r.key)).forEach(r => {
                        URL.revokeObjectURL(r.previewUrl)
                        previewsRef.current.delete(r.previewUrl)
                    })
                    return prev.filter(r => !r.productId || failedKeys.has(r.key))
                })
                toast.error(`${failed} foto(s) no se pudieron subir; quedan en la lista para reintentar.`)
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar la selección.")
        } finally {
            setWorking(false)
            setProgress(null)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <ImagePlus className="h-5 w-5 text-muted-foreground" />
                    Importar fotos de productos
                </DialogTitle>
                <DialogDescription>
                    Nombra cada archivo con el SKU, código de barras o nombre del producto para preasignarlo;
                    las fotos se agregan a las que ya tiene cada producto.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
                {/* Drop zone + input de archivos */}
                <div
                    role="button"
                    tabIndex={working ? -1 : 0}
                    aria-label="Seleccionar imágenes"
                    aria-disabled={working}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click() } }}
                    onClick={() => { if (!working) fileInputRef.current?.click() }}
                    onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDragOver(true) }}
                    onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}
                    className={cn(
                        "border-2 border-dashed rounded-lg p-5 text-center transition-colors",
                        working ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                        dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50",
                    )}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPT}
                        multiple
                        disabled={working}
                        aria-label="Elegir archivos de imagen"
                        onChange={(e) => { addFiles(e.target.files); e.target.value = "" }}
                        className="hidden"
                    />
                    <div className="flex flex-col items-center gap-1.5">
                        <ImagePlus className="h-6 w-6 text-muted-foreground" />
                        <p className="text-sm font-medium">Arrastra fotos aquí o haz clic para seleccionar</p>
                        <p className="text-xs text-muted-foreground">JPEG, PNG o WebP · el nombre del archivo sugiere el producto</p>
                    </div>
                </div>

                {/* Archivos elegidos con su producto destino */}
                {rows.length > 0 && (
                    <div className="border rounded-xl overflow-hidden">
                        <div className="max-h-64 overflow-y-auto divide-y divide-border">
                            {rows.map(row => (
                                <div key={row.key} className="flex items-center gap-3 p-2.5">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- blob local, no pasa por el optimizador */}
                                    <img
                                        src={row.previewUrl}
                                        alt=""
                                        className="h-12 w-12 shrink-0 rounded-md object-cover bg-muted"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{row.file.name}</p>
                                        {row.status === "error" ? (
                                            <p className="text-xs text-destructive truncate">Error: {row.error}</p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground truncate">{stemOf(row.file.name)}</p>
                                        )}
                                    </div>
                                    <select
                                        value={row.productId}
                                        onChange={(e) => setRowProduct(row.key, e.target.value)}
                                        disabled={working}
                                        aria-label={`Producto para ${row.file.name}`}
                                        className="h-9 w-44 sm:w-56 shrink-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                                    >
                                        <option value="">— Sin asignar —</option>
                                        {catalog.map(p => (
                                            <option key={p.id} value={p.id}>{productLabel(p)}</option>
                                        ))}
                                    </select>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-red-500"
                                        onClick={() => removeRow(row.key)}
                                        disabled={working}
                                        aria-label={`Quitar ${row.file.name}`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <div className="p-2.5 bg-muted/30 border-t text-xs text-muted-foreground" role="status">
                            {working && progress
                                ? `Subiendo ${progress.done}/${progress.total}…`
                                : `${targets.length} de ${rows.length} foto(s) con producto asignado`}
                        </div>
                    </div>
                )}
            </div>

            <DialogFooter className="gap-2">
                <Button variant="outline" onClick={close} disabled={working}>
                    Cancelar
                </Button>
                <Button onClick={() => void handleConfirm()} disabled={working || targets.length === 0}>
                    {working
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <ImagePlus className="mr-2 h-4 w-4" />}
                    {working && progress ? `Subiendo ${progress.done}/${progress.total}` : `Asignar ${targets.length} foto(s)`}
                </Button>
            </DialogFooter>
        </>
    )
}
