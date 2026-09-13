"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
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
import { Loader2, PackageX, Search } from "lucide-react"
import { toast } from "sonner"

export type MermaType = "DAMAGED" | "LOST"

/**
 * Marca que va en `notes` para distinguir el subtipo de merma: DAMAGED/LOST se
 * persisten como OUT en InventoryMovement (el enum no los incluye). El panel de
 * mermas y el filtro ?type= del API reconocen esta marca.
 */
export const MERMA_NOTE_PREFIX = "merma:"
export const mermaNote = (type: MermaType) => `${MERMA_NOTE_PREFIX}${type.toLowerCase()}`

interface Branch {
    id: string
    name: string
}

interface SearchProduct {
    id: string
    name: string
    barcode: string | null
    /** Stock en la sucursal seleccionada (viene de /api/search/pos?branchId=). */
    stock: number
}

interface MermaDialogProps {
    branches: Branch[]
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Se llama tras registrar la merma para refrescar la lista. */
    onSaved: () => void
}

export function MermaDialog({ branches, open, onOpenChange, onSaved }: MermaDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                {/* DialogContent desmonta al cerrar: el form reinicia su estado en cada apertura. */}
                {open && (
                    <MermaForm
                        branches={branches}
                        onSaved={onSaved}
                        close={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

interface MermaFormProps {
    branches: Branch[]
    onSaved: () => void
    close: () => void
}

function MermaForm({ branches, onSaved, close }: MermaFormProps) {
    const [product, setProduct] = useState<SearchProduct | null>(null)
    const [type, setType] = useState<MermaType>("DAMAGED")
    const [branchId, setBranchId] = useState(branches[0]?.id ?? "")
    const [quantity, setQuantity] = useState("1")
    const [reason, setReason] = useState("")

    const [search, setSearch] = useState("")
    const [results, setResults] = useState<SearchProduct[]>([])
    const [searching, setSearching] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [saving, setSaving] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

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

    const qty = parseInt(quantity)
    const stockAtBranch = product?.stock ?? 0
    const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= stockAtBranch
    const canSubmit = !saving && Boolean(product) && Boolean(branchId) && qtyValid && Boolean(reason.trim())

    const handleSubmit = async () => {
        if (saving) return
        if (!product) return toast.error("Selecciona el producto de la merma.")
        if (!branchId) return toast.error("Selecciona la sucursal.")
        if (!reason.trim()) return toast.error("Describe el motivo de la merma.")
        if (!qtyValid) return toast.error(`Cantidad inválida (máx: ${stockAtBranch})`)

        const payload = {
            productId: product.id,
            type,
            quantity: qty,
            branchId,
            reason: reason.trim(),
            notes: mermaNote(type),
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
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar la merma.")

            operation.current = null
            const branchName = branches.find(b => b.id === branchId)?.name ?? "sucursal"
            const typeLabel = type === "DAMAGED" ? "Dañado" : "Perdido"
            toast.success("Merma registrada", { description: `${typeLabel} · ${qty} ud · ${product.name} · ${branchName}` })
            close()
            onSaved()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar la merma.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <PackageX className="h-5 w-5 text-muted-foreground" />
                    Registrar merma
                </DialogTitle>
                <DialogDescription>
                    Resta stock por producto dañado o perdido. Queda en el historial de inventario.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
                {/* Producto */}
                {product ? (
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                            <p className="font-medium truncate">{product.name}</p>
                            <p className="text-xs text-muted-foreground">
                                {product.barcode || "Sin código"} · Stock en sucursal: {stockAtBranch}
                            </p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setProduct(null)}>
                            Cambiar
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-1.5 relative">
                        <Label htmlFor="merma-search">Producto</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="merma-search"
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
                        <Label htmlFor="merma-type">Tipo</Label>
                        <Select value={type} onValueChange={(v) => setType(v as MermaType)}>
                            <SelectTrigger id="merma-type">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DAMAGED">Dañado</SelectItem>
                                <SelectItem value="LOST">Perdido</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="merma-branch">Sucursal</Label>
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger id="merma-branch">
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

                <div className="space-y-1.5">
                    <Label htmlFor="merma-qty">Cantidad</Label>
                    <Input
                        id="merma-qty"
                        type="number"
                        min={1}
                        max={stockAtBranch || undefined}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                    />
                    {product && (
                        <p className="text-xs text-muted-foreground">
                            Disponible en sucursal: {stockAtBranch}
                        </p>
                    )}
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="merma-reason">Motivo</Label>
                    <Input
                        id="merma-reason"
                        placeholder="Ej: pantalla rota en almacén, robo, caducó…"
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
                        : <PackageX className="mr-2 h-4 w-4" />}
                    Registrar merma
                </Button>
            </DialogFooter>
        </>
    )
}
