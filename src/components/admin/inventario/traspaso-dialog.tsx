"use client"

import { useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Badge } from "@/components/ui/badge"
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
import { ArrowLeftRight, Loader2 } from "lucide-react"
import { toast } from "sonner"

/** Subconjunto de StockProduct (existencias) necesario para el traspaso. */
export interface TraspasoProduct {
    id: string
    name: string
    branches: { branchId: string; branchName: string; quantity: number }[]
}

interface Branch {
    id: string
    name: string
}

interface TraspasoDialogProps {
    product: TraspasoProduct | null
    branches: Branch[]
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Se llama tras registrar el traspaso para refrescar la tabla de existencias. */
    onSaved: () => void
}

export function TraspasoDialog({ product, branches, open, onOpenChange, onSaved }: TraspasoDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                {/* DialogContent desmonta al cerrar: el form reinicia su estado en cada apertura. */}
                {product && (
                    <TraspasoForm
                        product={product}
                        branches={branches}
                        onSaved={onSaved}
                        close={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

interface TraspasoFormProps {
    product: TraspasoProduct
    branches: Branch[]
    onSaved: () => void
    close: () => void
}

function TraspasoForm({ product, branches, onSaved, close }: TraspasoFormProps) {
    const stockByBranch = new Map(product.branches.map((b) => [b.branchId, b.quantity]))
    // Origen por defecto: la sucursal con más stock del producto.
    const defaultOrigin = branches.reduce<Branch | null>((best, b) => {
        const qty = stockByBranch.get(b.id) ?? 0
        return qty > (best ? stockByBranch.get(best.id) ?? 0 : -1) ? b : best
    }, null)

    const [fromId, setFromId] = useState(defaultOrigin?.id ?? "")
    const [toId, setToId] = useState(() => branches.find((b) => b.id !== defaultOrigin?.id)?.id ?? "")
    const [quantity, setQuantity] = useState("1")
    const [reason, setReason] = useState("")
    const [saving, setSaving] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

    const fromStock = stockByBranch.get(fromId) ?? 0
    const qty = parseInt(quantity)
    const qtyValid = Number.isInteger(qty) && qty >= 1 && qty <= fromStock
    const canSubmit = !saving && Boolean(fromId) && Boolean(toId) && fromId !== toId && qtyValid

    // Solo se puede sacar stock de sucursales que tengan unidades.
    const originOptions = branches.filter((b) => (stockByBranch.get(b.id) ?? 0) > 0)

    const handleFromChange = (value: string) => {
        setFromId(value)
        if (toId === value) {
            setToId(branches.find((b) => b.id !== value)?.id ?? "")
        }
        const max = stockByBranch.get(value) ?? 0
        setQuantity((q) => {
            const n = parseInt(q)
            return Number.isInteger(n) && n >= 1 && n <= max ? q : "1"
        })
    }

    const handleSubmit = async () => {
        if (saving) return
        if (!fromId || !toId || fromId === toId) {
            toast.error("El origen y el destino deben ser sucursales distintas.")
            return
        }
        if (!qtyValid) {
            toast.error(`Cantidad inválida (máx: ${fromStock})`)
            return
        }

        setSaving(true)
        const payload = {
            productId: product.id,
            type: "TRANSFER",
            quantity: qty,
            reason: reason.trim() || "Traspaso entre sucursales",
            branchId: fromId,
            toBranchId: toId,
        }
        operation.current = getClientOperationKey(operation.current, payload)
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar el traspaso.")

            operation.current = null
            const fromName = branches.find((b) => b.id === fromId)?.name ?? "origen"
            const toName = branches.find((b) => b.id === toId)?.name ?? "destino"
            toast.success("Traspaso registrado", { description: `${qty} ud · ${fromName} → ${toName}` })
            close()
            onSaved()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar el traspaso.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <ArrowLeftRight className="h-5 w-5 text-muted-foreground" />
                    Mover entre sucursales
                </DialogTitle>
                <DialogDescription>
                    {product.name} — traspasa unidades de una sucursal a otra.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-1.5">
                    {branches.map((b) => (
                        <Badge key={b.id} variant="outline" className="font-normal tabular-nums">
                            {b.name}: {stockByBranch.get(b.id) ?? 0}
                        </Badge>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="traspaso-from">De</Label>
                        <Select value={fromId} onValueChange={handleFromChange}>
                            <SelectTrigger id="traspaso-from">
                                <SelectValue placeholder="Origen" />
                            </SelectTrigger>
                            <SelectContent>
                                {originOptions.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                        {b.name} ({stockByBranch.get(b.id) ?? 0})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="traspaso-to">A</Label>
                        <Select value={toId} onValueChange={setToId}>
                            <SelectTrigger id="traspaso-to">
                                <SelectValue placeholder="Destino" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.filter((b) => b.id !== fromId).map((b) => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="traspaso-qty">Cantidad</Label>
                    <Input
                        id="traspaso-qty"
                        type="number"
                        min={1}
                        max={fromStock}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                        Disponible en origen: {fromStock}
                    </p>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="traspaso-reason">Motivo (opcional)</Label>
                    <Input
                        id="traspaso-reason"
                        placeholder="Ej: reabastecer sucursal"
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
                        : <ArrowLeftRight className="mr-2 h-4 w-4" />}
                    Confirmar traspaso
                </Button>
            </DialogFooter>
        </>
    )
}
