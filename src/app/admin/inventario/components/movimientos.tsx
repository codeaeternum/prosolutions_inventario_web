"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import {
    ArrowDownCircle,
    ArrowUpCircle,
    Plus,
    Minus,
    ScanBarcode,
    Loader2,
    Trash2,

    CheckCircle,
    Layers
} from "lucide-react"
import { BarcodeScanner } from "@/components/barcode-scanner"

interface Product {
    id: string
    name: string
    barcode: string | null
    stock: number
}

interface BatchItem {
    id: string // temporary internal id
    product: Product
    type: string
    quantity: number
    toBranchId?: string
}

interface Branch {
    id: string
    name: string
}

const movementTypes = [
    { value: "IN", label: "Entrada (Compra)", icon: ArrowDownCircle, color: "text-green-600", help: "Suma stock nuevo proveniente de una compra." },
    { value: "OUT", label: "Salida", icon: ArrowUpCircle, color: "text-red-600", help: "Resta stock por uso interno, regalo, etc." },
    { value: "ADJUSTMENT_IN", label: "Ajuste (+)", icon: Plus, color: "text-green-600", help: "Suma stock por descuadre de inventario físico." },
    { value: "ADJUSTMENT_OUT", label: "Ajuste (-)", icon: Minus, color: "text-red-600", help: "Resta stock por descuadre de inventario físico." },
    { value: "DAMAGED", label: "Dañado / Merma", icon: ArrowUpCircle, color: "text-orange-600", help: "Resta stock porque el producto se echó a perder o rompió." },
    { value: "LOST", label: "Perdido", icon: ArrowUpCircle, color: "text-muted-foreground", help: "Resta stock por robo o pérdida desconocida." },
    { value: "TRANSFER", label: "Traspaso", icon: ArrowDownCircle, color: "text-blue-600", help: "Mueve existencias de esta sucursal a otra." },
]

export default function MovimientosInventario({ lockedBranchId }: { lockedBranchId?: string | null }) {
    const [showScanner, setShowScanner] = useState(false)
    const [saving, setSaving] = useState(false)
    const [products, setProducts] = useState<Product[]>([])
    const [searchProducts, setSearchProducts] = useState("")

    const [batchItems, setBatchItems] = useState<BatchItem[]>([])
    const [globalReason, setGlobalReason] = useState("")
    const [globalNotes, setGlobalNotes] = useState("")
    const [branches, setBranches] = useState<Branch[]>([])
    // Empleado: el lote siempre opera sobre su sucursal fija (label, no selector).
    const [branchId, setBranchId] = useState(lockedBranchId ?? "")
    const lockedBranchName = lockedBranchId ? branches.find(b => b.id === lockedBranchId)?.name : null

    // Carga inicial de sucursales (solo al montar): si no hay sucursal
    // elegida todavía, se selecciona la primera activa como default. El
    // update funcional evita leer branchId aquí — agregarlo a deps
    // re-fetchería /api/branches en cada cambio de sucursal.
    useEffect(() => {
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            const list = (d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive)
            setBranches(list)
            if (list.length) setBranchId(prev => prev || list[0].id)
        }).catch(() => {})
    }, [])

    const searchProductsApi = useCallback(async (query: string) => {
        if (query.length < 2) {
            setProducts([])
            return
        }
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(query)}${branchId ? `&branchId=${branchId}` : ""}`)
            const data = await res.json()
            setProducts(data.products || [])
        } catch (error) {
            console.error("Error searching products:", error)
        }
    }, [branchId])

    useEffect(() => {
        const debounce = setTimeout(() => {
            searchProductsApi(searchProducts)
        }, 300)
        return () => clearTimeout(debounce)
    }, [searchProducts, searchProductsApi])

    const addItem = (product: Product) => {
        setBatchItems(prev => {
            const existing = prev.find(i => i.product.id === product.id && i.type === "IN")
            if (existing) {
                return prev.map(i => i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i)
            }
            return [...prev, {
                id: Math.random().toString(36).substring(7),
                product,
                type: "IN",
                quantity: 1
            }]
        })
        setSearchProducts("")
        setProducts([])
        toast.success(`${product.name} agregado al lote.`)
    }

    const handleScan = async (code: string) => {
        setShowScanner(false)
        const res = await fetch(`/api/search/pos?q=${encodeURIComponent(code)}${branchId ? `&branchId=${branchId}` : ""}`)
        const data = await res.json()
        if (data.products && data.products.length > 0) {
            const exact = data.products.find((product: Product) => product.barcode === code || product.id === code)
            if (exact) addItem(exact)
            else toast.error("No hay coincidencia exacta; selecciona el producto en la búsqueda.")
        } else {
            toast.error("No se encontró ningún producto con el código: " + code)
        }
    }

    const updateItem = (id: string, updates: Partial<BatchItem>) => {
        setBatchItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item))
    }

    const removeItem = (id: string) => {
        setBatchItems(prev => prev.filter(item => item.id !== id))
    }

    const pendingBatch = useRef<ClientOperationKey | null>(null)
    const batchInFlight = useRef(false)
    const handleSaveBatch = async () => {
        if (batchItems.length === 0) return toast.error("El lote está vacío")
        if (!globalReason.trim()) return toast.error("Ingresa un motivo global para el lote")
        if (batchItems.some(i => i.type === "TRANSFER" && !i.toBranchId)) return toast.error("Selecciona la sucursal destino de cada traspaso")

        if (batchInFlight.current) return
        batchInFlight.current = true
        setSaving(true)
        try {
            const payload = { branchId: branchId || undefined, items: batchItems.map(item => ({ productId: item.product.id, type: item.type,
                quantity: item.quantity, reason: globalReason.trim(),
                notes: [(item.type === "DAMAGED" || item.type === "LOST") ? `merma:${item.type.toLowerCase()}` : null, globalNotes.trim() || null].filter(Boolean).join(" · ") || undefined,
                ...(item.type === "TRANSFER" ? { toBranchId: item.toBranchId } : {}) })) }
            pendingBatch.current = getClientOperationKey(pendingBatch.current, payload)
            const res = await fetch("/api/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: pendingBatch.current.key }) })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se guardó el lote. Revisa los datos y reintenta.")
            pendingBatch.current = null
            toast.success("Lote de movimientos registrado correctamente.")

            setBatchItems([])
            setGlobalReason("")
            setGlobalNotes("")
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo confirmar el lote. Reintenta sin cambiarlo.")
        } finally {
            batchInFlight.current = false
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                        <div>
                            <CardTitle>Recepción y Ajustes (Lote)</CardTitle>
                            <CardDescription>Escanea o busca productos para agregarlos a la lista de trabajo y guárdalos todos a la vez.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {lockedBranchId ? (
                                <span className="inline-flex items-center rounded-md border bg-muted/40 px-3 h-9 text-sm">
                                    {lockedBranchName ?? "Mi sucursal"}
                                </span>
                            ) : branches.length > 1 && (
                                <Select value={branchId} onValueChange={setBranchId}>
                                    <SelectTrigger className="w-[170px]">
                                        <SelectValue placeholder="Sucursal" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {branches.map(b => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            <Button variant="outline" onClick={() => setShowScanner(true)} title="Abre la cámara para escanear código de barras o QR y agregar el producto al lote">
                                <ScanBarcode className="w-4 h-4 mr-2" />
                                Escanear
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Buscador */}
                    <div className="space-y-2 relative">
                        <Input
                            placeholder="Buscar producto por nombre o código..."
                            value={searchProducts}
                            onChange={(e) => setSearchProducts(e.target.value)}
                            className="max-w-md text-lg h-12"
                        />
                        {products.length > 0 && (
                            <div className="absolute z-10 w-full max-w-md border rounded-lg shadow-lg bg-background max-h-64 overflow-y-auto">
                                {products.map((p) => (
                                    <button
                                        key={p.id}
                                        className="w-full text-left p-3 hover:bg-muted border-b last:border-0 flex justify-between items-center"
                                        onClick={() => addItem(p)}
                                    >
                                        <div>
                                            <p className="font-medium">{p.name}</p>
                                            <p className="text-xs text-muted-foreground">{p.barcode || "Sin código"}</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-xs bg-muted px-2 py-1 rounded">Stock: {p.stock}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Lote */}
                    {batchItems.length > 0 ? (
                        <div className="border rounded-xl overflow-hidden bg-background">
                            <div className="hidden sm:grid grid-cols-12 gap-4 p-3 bg-muted text-sm font-medium text-muted-foreground">
                                <div className="col-span-5">Producto</div>
                                <div className="col-span-3">Tipo</div>
                                <div className="col-span-3">Cantidad</div>
                                <div className="col-span-1"></div>
                            </div>
                            <div className="divide-y divide-border">
                                {batchItems.map((item) => (
                                    <div key={item.id} className="grid sm:grid-cols-12 gap-4 p-3 items-center">
                                        <div className="sm:col-span-5">
                                            <p className="font-medium text-sm sm:text-base leading-tight">{item.product.name}</p>
                                            <p className="text-xs text-muted-foreground mt-1">Stock actual: {item.product.stock}</p>
                                        </div>
                                        <div className="sm:col-span-3">
                                            <Select value={item.type} onValueChange={v => updateItem(item.id, { type: v })}>
                                                <SelectTrigger className="h-9">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {movementTypes.map(t => (
                                                        <SelectItem key={t.value} value={t.value}>
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="flex items-center gap-2">
                                                                    <t.icon className={`h-4 w-4 ${t.color}`} />
                                                                    {t.label}
                                                                </span>
                                                                <span className="text-xs text-muted-foreground whitespace-normal">{t.help}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="sm:col-span-3 flex items-center gap-2">
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateItem(item.id, { quantity: Math.max(1, item.quantity - 1) })}>-</Button>
                                            <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(item.id, { quantity: parseInt(e.target.value) || 1 })} className="h-9 text-center" />
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => updateItem(item.id, { quantity: item.quantity + 1 })}>+</Button>
                                        </div>
                                        {item.type === "TRANSFER" && (
                                            <div className="sm:col-span-12 -mt-1">
                                                <Select value={item.toBranchId ?? ""} onValueChange={v => updateItem(item.id, { toBranchId: v })}>
                                                    <SelectTrigger className="h-9 max-w-xs">
                                                        <SelectValue placeholder="Sucursal destino…" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {branches.filter(b => b.id !== branchId).map(b => (
                                                            <SelectItem key={b.id} value={b.id}>→ {b.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                        <div className="sm:col-span-1 flex justify-end">
                                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-500" onClick={() => removeItem(item.id)}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="p-4 bg-muted/30 border-t space-y-4">
                                <div className="space-y-2">
                                    <Label>Motivo Global (requerido)</Label>
                                    <Input placeholder="Ej: Compra proveedor Apple, Inventario de marzo..." value={globalReason} onChange={e => setGlobalReason(e.target.value)} />
                                    <p className="text-xs text-muted-foreground">Se usará como motivo en todos los movimientos de este lote (ej.: compra, inventario, corrección).</p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Notas (opcional)</Label>
                                    <Textarea placeholder="Factura #1234, etc..." value={globalNotes} onChange={e => setGlobalNotes(e.target.value)} className="resize-none h-16" />
                                    <p className="text-xs text-muted-foreground">Información extra (factura, observaciones) que quedará registrada con el lote.</p>
                                </div>
                                <Button className="w-full sm:w-auto h-12" onClick={handleSaveBatch} disabled={saving || !globalReason.trim()} title="Guarda todos los movimientos del lote con el motivo indicado y actualiza el stock.">
                                    {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle className="mr-2 h-5 w-5" />}
                                    Procesar Lote ({batchItems.length} prod.)
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 border rounded-xl bg-muted/20 border-dashed">
                            <Layers className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                            <p className="text-muted-foreground text-sm">Escanea o busca productos para empezar un lote.</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={showScanner} onOpenChange={setShowScanner}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Escanear Producto</DialogTitle>
                    </DialogHeader>
                    <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
                </DialogContent>
            </Dialog>
        </div>
    )
}
