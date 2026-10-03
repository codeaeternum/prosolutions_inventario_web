"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { guardedClose } from "@/lib/dialog-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { BarcodeScanner } from "@/components/barcode-scanner"
import { Loader2, PackagePlus, ScanBarcode, Search } from "lucide-react"
import { toast } from "sonner"

interface Branch {
    id: string
    name: string
}

interface SearchProduct {
    id: string
    name: string
    barcode: string | null
    /** Stock en la sucursal consultada (/api/search/pos?branchId=). */
    stock: number
}

interface EntradaRapidaDialogProps {
    branches: Branch[]
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Sucursal fija para empleados (homeBranch); null = el admin elige. */
    lockedBranchId?: string | null
    /** Se llama tras sumar stock para refrescar la lista. */
    onSaved: () => void
}

/**
 * Entrada rápida: suma unidades de UN producto a una sucursal vía
 * POST /api/inventory (type "IN") — el mismo endpoint de movimientos que usa
 * el panel de lote, con la misma llave de idempotencia.
 */
export function EntradaRapidaDialog({ branches, lockedBranchId, open, onOpenChange, onSaved }: EntradaRapidaDialogProps) {
    // Espejo del `saving` del form: guardedClose bloquea Escape y el clic fuera
    // mientras el POST sigue en vuelo (evita reintentos con otra key).
    const [busy, setBusy] = useState(false)
    return (
        <Dialog
            open={open}
            onOpenChange={guardedClose(
                // guardedClose espera un setter estilo useState; aquí solo llegan booleanos.
                (v) => onOpenChange(typeof v === "function" ? v(open) : v),
                busy,
            )}
        >
            <DialogContent className="sm:max-w-md">
                {open && (
                    <EntradaRapidaForm
                        branches={branches}
                        lockedBranchId={lockedBranchId ?? null}
                        onSaved={onSaved}
                        close={() => onOpenChange(false)}
                        onBusyChange={setBusy}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

function EntradaRapidaForm({ branches, lockedBranchId, onSaved, close, onBusyChange }: {
    branches: Branch[]
    lockedBranchId: string | null
    onSaved: () => void
    close: () => void
    onBusyChange: (busy: boolean) => void
}) {
    const [product, setProduct] = useState<SearchProduct | null>(null)
    const [branchId, setBranchId] = useState(lockedBranchId ?? branches[0]?.id ?? "")
    const branchName = branches.find((b) => b.id === branchId)?.name ?? ""
    const [quantity, setQuantity] = useState("1")
    const [reason, setReason] = useState("")

    const [search, setSearch] = useState("")
    const [results, setResults] = useState<SearchProduct[]>([])
    const [searching, setSearching] = useState(false)
    const [scannerOpen, setScannerOpen] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [saving, setSaving] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

    // Espeja `saving` hacia el Dialog padre (guardedClose) y lo libera al desmontar.
    useEffect(() => {
        onBusyChange(saving)
        return () => onBusyChange(false)
    }, [saving, onBusyChange])

    // La búsqueda devuelve el stock de la sucursal elegida (branchId en la query).
    const searchProducts = useCallback(async (query: string, branch: string) => {
        if (query.trim().length < 2) {
            setResults([])
            return
        }
        setSearching(true)
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(query.trim())}${branch ? `&branchId=${branch}` : ""}`)
            const data = await res.json().catch(() => null)
            setResults(res.ok ? (data?.products ?? []) : [])
        } catch {
            setResults([])
        } finally {
            setSearching(false)
        }
    }, [])

    useEffect(() => {
        debounceRef.current = setTimeout(() => void searchProducts(search, branchId), 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [search, branchId, searchProducts])

    // Al cambiar de sucursal, refresca el stock del producto ya elegido.
    useEffect(() => {
        if (!product || !branchId) return
        let cancelled = false
        const q = product.barcode || product.name
        fetch(`/api/search/pos?q=${encodeURIComponent(q)}&branchId=${branchId}`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                if (cancelled) return
                const found = (d?.products ?? []).find((p: SearchProduct) => p.id === product.id)
                if (found) setProduct(prev => (prev && prev.id === found.id ? { ...prev, stock: found.stock } : prev))
            })
            .catch(() => {})
        return () => { cancelled = true }
        // Solo re-consultar cuando cambia la sucursal o el producto elegido.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [branchId, product?.id])

    const pickProduct = (p: SearchProduct) => {
        setProduct(p)
        setSearch("")
        setResults([])
    }

    // Escáner: coincidencia exacta por barcode/id agrega el producto de una vez.
    const handleScan = async (code: string) => {
        setScannerOpen(false)
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(code)}${branchId ? `&branchId=${branchId}` : ""}`)
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                toast.error(data?.error || "No se pudo buscar el código. Reintenta.")
                return
            }
            const products: SearchProduct[] = data?.products ?? []
            const exact = products.find((p) => p.barcode === code || p.id === code)
            if (exact) {
                pickProduct(exact)
            } else if (products.length > 0) {
                setResults(products)
                setSearch(code)
                toast.info("Sin coincidencia exacta; elige el producto en la lista.")
            } else {
                toast.error(`No se encontró ningún producto con el código ${code}`)
            }
        } catch {
            toast.error("Error de conexión al buscar el código.")
        }
    }

    // Number() (no parseInt): "1.5" se rechaza en vez de truncarse a 1.
    const qty = Number(quantity)
    const qtyValid = Number.isInteger(qty) && qty >= 1
    const canSubmit = !saving && Boolean(product) && Boolean(branchId) && qtyValid

    const handleSubmit = async () => {
        if (saving) return
        if (!product) return toast.error("Selecciona el producto que entra.")
        if (!branchId) return toast.error("Selecciona la sucursal que recibe.")
        if (!qtyValid) return toast.error("La cantidad debe ser un entero mayor a 0.")

        const payload = {
            productId: product.id,
            type: "IN",
            quantity: qty,
            branchId,
            reason: reason.trim() || "Entrada rápida",
        }
        operation.current = getClientOperationKey(operation.current, payload)
        setSaving(true)
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar la entrada.")

            operation.current = null
            toast.success(`+${qty} a "${product.name}"`, { description: `Entrada en ${branchName || "la sucursal"}` })
            close()
            onSaved()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar la entrada.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <PackagePlus className="h-5 w-5 text-muted-foreground" />
                    Entrada rápida
                </DialogTitle>
                <DialogDescription>
                    Suma existencias de un producto a una sucursal. Queda en el historial como entrada.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
                {/* Producto */}
                {product ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                            <p className="font-medium truncate">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {product.barcode || "Sin código"} · Stock en sucursal: {product.stock}
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setProduct(null)}>
                            Cambiar
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-1.5 relative">
                        <div className="flex items-center justify-between">
                            <Label htmlFor="entrada-search">Producto</Label>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setScannerOpen(true)}
                                title="Abre la cámara para leer el código de barras"
                            >
                                <ScanBarcode className="mr-1 h-4 w-4" />
                                Escanear
                            </Button>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="entrada-search"
                                placeholder="Buscar por nombre o código..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9"
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
                                        onClick={() => pickProduct(p)}
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
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="entrada-branch">Sucursal</Label>
                        {lockedBranchId ? (
                            <p className="h-9 flex items-center rounded-md border bg-muted/40 px-3 text-sm">
                                {branchName || "Mi sucursal"}
                            </p>
                        ) : (
                            <Select value={branchId} onValueChange={setBranchId}>
                                <SelectTrigger id="entrada-branch">
                                    <SelectValue placeholder="Sucursal" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="entrada-qty">Cantidad que entra</Label>
                        <Input
                            id="entrada-qty"
                            type="number"
                            min={1}
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="entrada-reason">Motivo (opcional)</Label>
                    <Input
                        id="entrada-reason"
                        placeholder="Ej: compra sin orden, sobrante de reparación…"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={500}
                    />
                </div>
            </div>

            <DialogFooter className="gap-2">
                <Button variant="outline" onClick={close} disabled={saving}>
                    Cancelar
                </Button>
                <Button onClick={handleSubmit} disabled={!canSubmit}>
                    {saving
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <PackagePlus className="mr-2 h-4 w-4" />}
                    Sumar stock
                </Button>
            </DialogFooter>

            <Dialog open={scannerOpen} onOpenChange={setScannerOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Escanear producto</DialogTitle>
                    </DialogHeader>
                    <BarcodeScanner onScan={(code) => void handleScan(code)} onClose={() => setScannerOpen(false)} />
                </DialogContent>
            </Dialog>
        </>
    )
}
