"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
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
import { Loader2, Plus, Search, ShoppingCart, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"

export interface SupplierOption {
    id: string
    name: string
}

export interface BranchOption {
    id: string
    name: string
}

interface SearchProduct {
    id: string
    name: string
    barcode: string | null
    stock: number
    costPrice: number | null
}

interface PurchaseLine {
    key: string
    product: SearchProduct
    quantity: string
    cost: string // pesos, como lo escribe el usuario
}

/** OC en DRAFT para editar dentro del mismo diálogo. */
export interface PurchaseToEdit {
    id: string
    number: number
    notes: string | null
    dueAt: string | null
    supplier: { id: string; name: string } | null
    branch: { id: string; name: string }
    items: {
        id: string
        quantity: number
        unitCostCents: number
        product: { id: string; name: string; barcode: string | null }
    }[]
}

interface CompraDialogProps {
    suppliers: SupplierOption[]
    branches: BranchOption[]
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Se llama tras crear la orden para refrescar la lista. */
    onSaved: () => void
    /** Si viene, el diálogo edita esta OC en borrador (PATCH) en vez de crear. */
    purchase?: PurchaseToEdit | null
}

export function CompraDialog({ suppliers, branches, open, onOpenChange, onSaved, purchase }: CompraDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                {/* DialogContent desmonta al cerrar: el form reinicia su estado en cada apertura. */}
                {open && (
                    <CompraForm
                        suppliers={suppliers}
                        branches={branches}
                        onSaved={onSaved}
                        close={() => onOpenChange(false)}
                        purchase={purchase ?? null}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

interface CompraFormProps {
    suppliers: SupplierOption[]
    branches: BranchOption[]
    onSaved: () => void
    close: () => void
    purchase: PurchaseToEdit | null
}

const NO_SUPPLIER = "__none__"

function CompraForm({ suppliers, branches, onSaved, close, purchase }: CompraFormProps) {
    const editing = purchase !== null
    const [supplierId, setSupplierId] = useState(purchase?.supplier?.id ?? NO_SUPPLIER)
    const [branchId, setBranchId] = useState(purchase?.branch.id ?? branches[0]?.id ?? "")
    const [notes, setNotes] = useState(purchase?.notes ?? "")
    const [dueAt, setDueAt] = useState(purchase?.dueAt ? purchase.dueAt.slice(0, 10) : "") // YYYY-MM-DD, fecha promesa de pago
    const [lines, setLines] = useState<PurchaseLine[]>(() =>
        (purchase?.items ?? []).map(item => ({
            key: item.id,
            product: { id: item.product.id, name: item.product.name, barcode: item.product.barcode, stock: 0, costPrice: item.unitCostCents / 100 },
            quantity: String(item.quantity),
            cost: String(item.unitCostCents / 100),
        }))
    )

    const [search, setSearch] = useState("")
    const [results, setResults] = useState<SearchProduct[]>([])
    const [searching, setSearching] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [saving, setSaving] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

    const searchProducts = useCallback(async (query: string) => {
        if (query.trim().length < 2) {
            setResults([])
            return
        }
        setSearching(true)
        try {
            const res = await fetch(`/api/products?search=${encodeURIComponent(query.trim())}&limit=10`)
            const data = await res.json().catch(() => null)
            setResults(res.ok ? (data?.products ?? []) : [])
        } catch {
            setResults([])
        } finally {
            setSearching(false)
        }
    }, [])

    useEffect(() => {
        debounceRef.current = setTimeout(() => void searchProducts(search), 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [search, searchProducts])

    const addLine = (product: SearchProduct) => {
        setLines(prev => {
            const existing = prev.find(l => l.product.id === product.id)
            if (existing) {
                toast.success(`${product.name}: cantidad +1`)
                return prev.map(l => l.key === existing.key ? { ...l, quantity: String(parseInt(l.quantity || "0") + 1) } : l)
            }
            return [...prev, {
                key: Math.random().toString(36).substring(7),
                product,
                quantity: "1",
                cost: product.costPrice != null ? String(product.costPrice) : "",
            }]
        })
        setSearch("")
        setResults([])
    }

    const updateLine = (key: string, updates: Partial<PurchaseLine>) => {
        setLines(prev => prev.map(l => l.key === key ? { ...l, ...updates } : l))
    }
    const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key))

    const parsedLines = lines.map(l => ({
        productId: l.product.id,
        // Number() (no parseInt): "1.5" se rechaza en vez de truncarse a 1.
        quantity: Number(l.quantity),
        unitCostCents: Math.round((parseFloat(l.cost) || 0) * 100),
    }))
    const linesValid = lines.length > 0 && parsedLines.every(l => Number.isInteger(l.quantity) && l.quantity >= 1 && l.unitCostCents >= 0)
    const totalCents = parsedLines.reduce((sum, l) => sum + (Number.isInteger(l.quantity) && l.quantity >= 1 ? l.quantity * l.unitCostCents : 0), 0)
    const canSubmit = !saving && Boolean(branchId) && linesValid

    const handleSubmit = async () => {
        if (saving) return
        if (!branchId) return toast.error("Selecciona la sucursal que recibirá el stock.")
        if (lines.length === 0) return toast.error("Agrega al menos un producto.")
        if (!linesValid) return toast.error("Revisa cantidades y costos: cantidad ≥ 1 y costo ≥ 0.")

        const payload = {
            supplierId: supplierId === NO_SUPPLIER ? null : supplierId,
            branchId,
            notes: notes.trim() || undefined,
            dueAt: dueAt || null,
            items: parsedLines,
        }
        operation.current = getClientOperationKey(operation.current, payload)
        setSaving(true)
        try {
            const res = editing
                ? await fetch(`/api/purchases/${purchase.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                })
                : await fetch("/api/purchases", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
                })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || (editing ? "No se pudo actualizar la orden." : "No se pudo crear la orden de compra."))
            operation.current = null
            toast.success(
                editing ? `Orden ${data?.folio ?? ""} actualizada` : `Orden ${data?.folio ?? ""} creada en borrador`,
                { description: `${lines.length} producto(s) · ${formatPrice(totalCents / 100)}` },
            )
            close()
            onSaved()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar la orden.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                    {editing ? `Editar orden ${`OC-${String(purchase.number).padStart(6, "0")}`}` : "Nueva orden de compra"}
                </DialogTitle>
                <DialogDescription>
                    {editing
                        ? "Solo editable mientras siga en borrador; el stock aún no se mueve."
                        : "Se crea en borrador; el stock entra a la sucursal al marcarla como recibida."}
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="compra-supplier">Proveedor</Label>
                        <Select value={supplierId} onValueChange={setSupplierId}>
                            <SelectTrigger id="compra-supplier">
                                <SelectValue placeholder="Sin proveedor" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_SUPPLIER}>Sin proveedor</SelectItem>
                                {suppliers.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="compra-branch">Sucursal que recibe</Label>
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger id="compra-branch">
                                <SelectValue placeholder="Sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map(b => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Buscador de productos */}
                <div className="space-y-2 relative">
                    <Label htmlFor="compra-search">Productos</Label>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            id="compra-search"
                            placeholder="Buscar por nombre o código..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-9"
                            autoFocus
                        />
                    </div>
                    {(results.length > 0 || searching) && (
                        <div className="absolute z-10 w-full border rounded-lg shadow-lg bg-background max-h-56 overflow-y-auto">
                            {searching && results.length === 0 ? (
                                <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                                </div>
                            ) : results.map(p => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className="w-full text-left p-3 hover:bg-muted border-b last:border-0 flex justify-between items-center gap-2"
                                    onClick={() => addLine(p)}
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{p.name}</p>
                                        <p className="text-xs text-muted-foreground">{p.barcode || "Sin código"}</p>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <span className="text-xs bg-muted px-2 py-1 rounded">Stock: {p.stock}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Líneas */}
                {lines.length > 0 ? (
                    <div className="border rounded-xl overflow-hidden">
                        <div className="hidden sm:grid grid-cols-12 gap-3 p-3 bg-muted text-sm font-medium text-muted-foreground">
                            <div className="col-span-5">Producto</div>
                            <div className="col-span-2">Cantidad</div>
                            <div className="col-span-2">Costo unit.</div>
                            <div className="col-span-2 text-right">Importe</div>
                            <div className="col-span-1"></div>
                        </div>
                        <div className="divide-y divide-border">
                            {lines.map(line => {
                                const qty = parseInt(line.quantity) || 0
                                const unit = parseFloat(line.cost) || 0
                                return (
                                    <div key={line.key} className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 sm:grid-cols-12 sm:items-center sm:gap-3">
                                        <div className="col-span-2 min-w-0 sm:col-span-5">
                                            <p className="font-medium text-sm leading-tight truncate">{line.product.name}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">{line.product.barcode || "Sin código"}</p>
                                        </div>
                                        {/* En móvil la fila no tiene encabezado: mini-etiquetas sobre cada campo */}
                                        <div className="sm:col-span-2">
                                            <span className="mb-1 block text-xs text-muted-foreground sm:hidden" aria-hidden>Cantidad</span>
                                            <Input
                                                type="number"
                                                min={1}
                                                inputMode="numeric"
                                                value={line.quantity}
                                                onChange={e => updateLine(line.key, { quantity: e.target.value })}
                                                className="h-9 tabular-nums"
                                                aria-label={`Cantidad de ${line.product.name}`}
                                            />
                                        </div>
                                        <div className="sm:col-span-2">
                                            <span className="mb-1 block text-xs text-muted-foreground sm:hidden" aria-hidden>Costo unit.</span>
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                inputMode="decimal"
                                                placeholder="0.00"
                                                value={line.cost}
                                                onChange={e => updateLine(line.key, { cost: e.target.value })}
                                                className="h-9 tabular-nums"
                                                aria-label={`Costo unitario de ${line.product.name}`}
                                            />
                                        </div>
                                        <div className="self-center text-sm font-medium tabular-nums sm:col-span-2 sm:text-right">
                                            <span className="mr-1.5 text-xs font-normal text-muted-foreground sm:hidden">Importe</span>
                                            {formatPrice(qty * unit)}
                                        </div>
                                        <div className="flex items-center justify-end sm:col-span-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-muted-foreground hover:text-red-500"
                                                onClick={() => removeLine(line.key)}
                                                title={`Quitar ${line.product.name}`}
                                                aria-label={`Quitar ${line.product.name}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        <div className="p-3 bg-muted/30 border-t flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">{lines.length} producto(s)</span>
                            <span className="font-semibold tabular-nums">Total: {formatPrice(totalCents / 100)}</span>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8 border rounded-xl bg-muted/20 border-dashed">
                        <Plus className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                        <p className="text-muted-foreground text-sm">Busca productos para agregarlos a la orden.</p>
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="compra-dueat">Fecha promesa de pago (opcional)</Label>
                        <Input
                            id="compra-dueat"
                            type="date"
                            value={dueAt}
                            onChange={e => setDueAt(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="compra-notes">Notas (opcional)</Label>
                        <Textarea
                            id="compra-notes"
                            placeholder="Factura del proveedor, condiciones de entrega…"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            maxLength={1000}
                            className="resize-none h-16"
                        />
                    </div>
                </div>
            </div>

            <DialogFooter className="gap-2">
                <Button variant="outline" onClick={close} disabled={saving}>
                    Cancelar
                </Button>
                <Button onClick={handleSubmit} disabled={!canSubmit}>
                    {saving
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <ShoppingCart className="mr-2 h-4 w-4" />}
                    {editing ? "Guardar cambios" : "Crear orden"}
                </Button>
            </DialogFooter>
        </>
    )
}
