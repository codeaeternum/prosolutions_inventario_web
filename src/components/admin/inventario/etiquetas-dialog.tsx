"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
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
import { useCurrency } from "@/components/currency-provider"
import { toast } from "sonner"
import { Loader2, Minus, Plus, Printer, QrCode, Search, X } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"

/** Producto mínimo que necesita la etiqueta (compatible con productDto del API). */
export interface EtiquetaProduct {
    id: string
    name: string
    barcode?: string | null
    sku?: string | null
    retailPrice: number
}

interface EtiquetasDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Uno o varios productos; cada uno lleva su propia cantidad de etiquetas.
     *  Con [] el diálogo abre en modo "buscar y agregar". */
    products: EtiquetaProduct[]
}

const MIN_QTY = 1
const MAX_QTY = 48
/** Etiquetas expandidas que se renderizan en la vista previa. */
const MAX_PREVIEW = 12

type LabelSize = "chica" | "media" | "grande"
/** Dimensiones reales en cm para la impresión + aprox px (96dpi) para la vista previa. */
const SIZES: Record<LabelSize, { wCm: string; hCm: string; qrCm: string; wPx: number; hPx: number; qrPx: number; namePt: number; pricePt: number }> = {
    chica: { wCm: "3.8cm", hCm: "2.5cm", qrCm: "1.9cm", wPx: 144, hPx: 94, qrPx: 64, namePt: 7, pricePt: 11 },
    media: { wCm: "5cm", hCm: "3cm", qrCm: "2.3cm", wPx: 189, hPx: 114, qrPx: 82, namePt: 8, pricePt: 13 },
    grande: { wCm: "6.5cm", hCm: "3.8cm", qrCm: "2.9cm", wPx: 246, hPx: 144, qrPx: 100, namePt: 10, pricePt: 16 },
}

/** Texto dentro del QR: el código de barras real, o el id interno como respaldo. */
const qrValueOf = (p: EtiquetaProduct) => p.barcode || p.sku || p.id

/** Código legible impreso en la etiqueta (el id interno no sirve para captura manual). */
const codeTextOf = (p: EtiquetaProduct) => p.barcode || p.sku || ""

/** Escapa HTML para evitar XSS al inyectar nombre/código en la ventana de impresión. */
const escapeHtml = (str: string) =>
    str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")

/**
 * Diálogo de etiquetas imprimibles (QR + nombre + precio por producto).
 * Punto único de impresión de etiquetas: se abre desde la fila del producto,
 * con la selección múltiple del stock, o vacío para buscar y agregar
 * (herramienta "Etiquetas" del panel de Stock). Reemplaza al antiguo
 * /admin/etiquetas.
 *
 * El cuerpo vive en EtiquetasBody: Radix desmonta el DialogContent al cerrar,
 * así cada apertura inicia limpia con los productos dados y cantidades en 1.
 */
export function EtiquetasDialog({ open, onOpenChange, products }: EtiquetasDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode className="h-5 w-5 text-muted-foreground" />
                        Etiquetas de producto
                    </DialogTitle>
                    <DialogDescription>
                        Etiquetas con nombre, precio y QR (código de barras o id del producto).
                    </DialogDescription>
                </DialogHeader>
                <EtiquetasBody products={products} onClose={() => onOpenChange(false)} />
            </DialogContent>
        </Dialog>
    )
}

function EtiquetasBody({ products, onClose }: { products: EtiquetaProduct[]; onClose: () => void }) {
    const { formatPrice } = useCurrency()
    // Estado inicial por apertura (el componente se remonta con el diálogo).
    const [items, setItems] = useState<EtiquetaProduct[]>(products)
    const [qtyById, setQtyById] = useState<Record<string, number>>({})
    const [size, setSize] = useState<LabelSize>("media")
    const [showPrice, setShowPrice] = useState(true)
    const [printing, setPrinting] = useState(false)
    const [search, setSearch] = useState("")
    const [searching, setSearching] = useState(false)
    const [results, setResults] = useState<EtiquetaProduct[]>([])

    const qtyOf = (id: string) => qtyById[id] ?? MIN_QTY
    const setQty = (id: string, qty: number) =>
        setQtyById((prev) => ({
            ...prev,
            [id]: Math.min(MAX_QTY, Math.max(MIN_QTY, Math.round(qty) || MIN_QTY)),
        }))
    const removeItem = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id))
    const addItem = (p: EtiquetaProduct) =>
        setItems((prev) => (prev.some((i) => i.id === p.id) ? prev : [...prev, p]))

    // Busca productos del catálogo para agregarlos a la tanda (modo herramienta
    // "Etiquetas" del stock: el diálogo abre vacío y aquí se elige qué imprimir).
    const runSearch = async () => {
        const q = search.trim()
        if (!q) return
        setSearching(true)
        try {
            const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=8`)
            const data = await res.json()
            if (!res.ok) throw new Error()
            setResults(
                (data.products ?? []).map((p: { id: string; name: string; barcode?: string | null; retailPrice?: number }) => ({
                    id: p.id,
                    name: p.name,
                    barcode: p.barcode ?? null,
                    retailPrice: p.retailPrice ?? 0,
                }))
            )
        } catch {
            toast.error("No se pudo buscar productos")
        } finally {
            setSearching(false)
        }
    }

    const totalLabels = items.reduce((acc, p) => acc + qtyOf(p.id), 0)
    const previewLabels = useMemo(
        () => items.flatMap((p) => Array.from({ length: qtyById[p.id] ?? MIN_QTY }, () => p)).slice(0, MAX_PREVIEW),
        [items, qtyById]
    )
    const s = SIZES[size]

    const handlePrint = () => {
        // Ventana nueva con HTML propio que se auto-imprime y se cierra sola;
        // evita pelear con el chrome de la app (mismo patrón que los tickets).
        const printWindow = window.open("", "_blank")
        if (!printWindow) {
            toast.error("Por favor permite las ventanas emergentes (pop-ups) para imprimir")
            return
        }

        setPrinting(true)
        // Import dinámico para no bloquear el render inicial
        import("qrcode")
            .then(async (QRCode) => {
                const jobs = items.flatMap((p) => Array.from({ length: qtyOf(p.id) }, () => p))
                const labelsHtml = (
                    await Promise.all(
                        jobs.map(async (p) => {
                            const qrDataUrl = await QRCode.default.toDataURL(qrValueOf(p), {
                                width: 220,
                                margin: 1,
                            })
                            const code = codeTextOf(p)
                            return `
                            <div class="label">
                                <img src="${qrDataUrl}" alt="QR" />
                                <div class="info">
                                    <div class="name">${escapeHtml(p.name)}</div>
                                    ${showPrice ? `<div class="price">${escapeHtml(formatPrice(p.retailPrice))}</div>` : ""}
                                    ${code ? `<div class="code">${escapeHtml(code)}</div>` : ""}
                                </div>
                            </div>`
                        })
                    )
                ).join("")

                printWindow.document.write(`
                <html>
                <head>
                    <title>Etiquetas de productos</title>
                    <style>
                    @page { margin: 5mm; }
                    * { box-sizing: border-box; }
                    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
                    .labels {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 2mm;
                        justify-content: flex-start;
                    }
                    .label {
                        width: ${s.wCm};
                        height: ${s.hCm};
                        border: 1px solid #d4d4d4;
                        border-radius: 1mm;
                        padding: 1.5mm 2mm;
                        display: flex;
                        align-items: center;
                        gap: 2mm;
                        overflow: hidden;
                        page-break-inside: avoid;
                    }
                    .label img {
                        width: ${s.qrCm};
                        height: ${s.qrCm};
                        flex-shrink: 0;
                    }
                    .info { flex: 1; min-width: 0; }
                    .name {
                        font-size: ${s.namePt}pt;
                        font-weight: bold;
                        line-height: 1.15;
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                    }
                    .price {
                        font-size: ${s.pricePt}pt;
                        font-weight: 800;
                        margin-top: 1mm;
                    }
                    .code {
                        font-size: 6.5pt;
                        color: #555;
                        margin-top: 0.5mm;
                        word-break: break-all;
                    }
                    </style>
                </head>
                <body>
                    <div class="labels">
                        ${labelsHtml}
                    </div>
                    <script>
                        window.onload = function() { window.print(); window.close(); }
                    </script>
                </body>
                </html>
            `)
                printWindow.document.close()
            })
            .catch(() => toast.error("No se pudieron generar los códigos QR"))
            .finally(() => setPrinting(false))
    }

    return (
        <>
            <div className="space-y-4">
                {/* Buscar y agregar productos a la tanda */}
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar producto para agregar…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") void runSearch() }}
                                className="pl-8"
                            />
                        </div>
                        <Button variant="outline" onClick={() => void runSearch()} disabled={searching || !search.trim()}>
                            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                        </Button>
                    </div>
                    {results.length > 0 && (
                        <div className="rounded-md border divide-y">
                            {results.map((p) => {
                                const added = items.some((i) => i.id === p.id)
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        disabled={added}
                                        onClick={() => addItem(p)}
                                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                                    >
                                        <span className="truncate">{p.name}</span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            {added ? "Agregado" : formatPrice(p.retailPrice)}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {items.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        Sin productos seleccionados — busca arriba o marca productos en la lista de stock.
                    </p>
                ) : (
                    <>
                        {/* Cantidad de etiquetas por producto (1–48) */}
                        <div className="space-y-1.5">
                            {items.map((p) => (
                                <div key={p.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">{p.name}</p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {codeTextOf(p) || "Sin código"} · {formatPrice(p.retailPrice)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => setQty(p.id, qtyOf(p.id) - 1)}
                                            disabled={qtyOf(p.id) <= MIN_QTY}
                                            aria-label="Una etiqueta menos"
                                        >
                                            <Minus className="h-3.5 w-3.5" />
                                        </Button>
                                        <Input
                                            type="number"
                                            min={MIN_QTY}
                                            max={MAX_QTY}
                                            value={qtyOf(p.id)}
                                            onChange={(e) => setQty(p.id, Number(e.target.value))}
                                            className="h-7 w-14 px-1 text-center text-sm"
                                            aria-label={`Cantidad de etiquetas de ${p.name}`}
                                        />
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => setQty(p.id, qtyOf(p.id) + 1)}
                                            disabled={qtyOf(p.id) >= MAX_QTY}
                                            aria-label="Una etiqueta más"
                                        >
                                            <Plus className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => removeItem(p.id)}
                                        title={`Quitar ${p.name}`}
                                        aria-label={`Quitar ${p.name}`}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>

                        {/* Tamaño y contenido de la etiqueta */}
                        <div className="flex flex-wrap items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="label-size" className="text-xs text-muted-foreground">Tamaño</Label>
                                <Select value={size} onValueChange={(v) => setSize(v as LabelSize)}>
                                    <SelectTrigger id="label-size" className="h-8 w-[150px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="chica">Chica 3.8×2.5</SelectItem>
                                        <SelectItem value="media">Media 5×3</SelectItem>
                                        <SelectItem value="grande">Grande 6.5×3.8</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="label-price"
                                    checked={showPrice}
                                    onCheckedChange={(v) => setShowPrice(v === true)}
                                />
                                <Label htmlFor="label-price" className="text-xs text-muted-foreground">Mostrar precio</Label>
                            </div>
                        </div>

                        {/* Vista previa a tamaño real aproximado */}
                        <div>
                            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                Vista previa · {totalLabels} etiqueta{totalLabels === 1 ? "" : "s"}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {previewLabels.map((p, i) => (
                                    <div
                                        key={`${p.id}-${i}`}
                                        style={{ width: s.wPx, height: s.hPx }}
                                        className="flex items-center gap-2 rounded-sm border bg-white p-1.5 text-neutral-900 shadow-sm"
                                    >
                                        <QRCodeSVG value={qrValueOf(p)} size={s.qrPx} className="shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="line-clamp-2 text-[10px] font-semibold leading-tight">
                                                {p.name}
                                            </p>
                                            {showPrice && (
                                                <p className="mt-1 text-base font-extrabold leading-none">
                                                    {formatPrice(p.retailPrice)}
                                                </p>
                                            )}
                                            {codeTextOf(p) && (
                                                <p className="mt-1 break-all text-[8px] leading-tight text-neutral-500">
                                                    {codeTextOf(p)}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {totalLabels > MAX_PREVIEW && (
                                    <div
                                        style={{ width: s.wPx, height: s.hPx }}
                                        className="flex items-center justify-center rounded-sm border border-dashed text-sm text-muted-foreground"
                                    >
                                        +{totalLabels - MAX_PREVIEW} más
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            <DialogFooter className="gap-2">
                <Button variant="outline" onClick={onClose}>
                    Cerrar
                </Button>
                <Button onClick={handlePrint} disabled={items.length === 0 || printing}>
                    {printing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <Printer className="mr-2 h-4 w-4" />
                    )}
                    Imprimir{items.length > 0 ? ` (${totalLabels})` : ""}
                </Button>
            </DialogFooter>
        </>
    )
}
