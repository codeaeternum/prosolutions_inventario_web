"use client"

import { useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { guardedClose } from "@/lib/dialog-guard"
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
import { Banknote, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"

/** Orden de compra con saldo pendiente (ORDERED o RECEIVED) a la que ligar el abono. */
export interface PendingPurchase {
    id: string
    number: number
    folio: string
    status: "ORDERED" | "RECEIVED" | string
    totalCents: number
    paidCents: number
    saldoCents: number
    dueAt: string | null
}

export const SUPPLIER_METHOD_LABELS: Record<string, string> = {
    CASH: "Efectivo",
    CARD: "Tarjeta",
    TRANSFER: "Transferencia",
}

const GENERAL = "__general__"

interface PagoProveedorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    supplier: { id: string; name: string } | null
    /** OCs con saldo del proveedor para el selector opcional. */
    purchases: PendingPurchase[]
    /** Cuando se abre desde el detalle de una OC, el abono se liga a ella. */
    fixedPurchase?: PendingPurchase | null
    /** Se llama tras registrar el pago para refrescar saldos/listas. */
    onSaved: () => void
}

export function PagoProveedorDialog({ open, onOpenChange, supplier, purchases, fixedPurchase, onSaved }: PagoProveedorDialogProps) {
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
                {/* DialogContent desmonta al cerrar: el form reinicia su estado en cada apertura. */}
                {open && supplier && (
                    <PagoForm
                        supplier={supplier}
                        purchases={purchases}
                        fixedPurchase={fixedPurchase ?? null}
                        onSaved={onSaved}
                        close={() => onOpenChange(false)}
                        onBusyChange={setBusy}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

interface PagoFormProps {
    supplier: { id: string; name: string }
    purchases: PendingPurchase[]
    fixedPurchase: PendingPurchase | null
    onSaved: () => void
    close: () => void
    onBusyChange: (busy: boolean) => void
}

function PagoForm({ supplier, purchases, fixedPurchase, onSaved, close, onBusyChange }: PagoFormProps) {
    const [purchaseId, setPurchaseId] = useState(fixedPurchase?.id ?? GENERAL)
    const [amount, setAmount] = useState("")
    const [method, setMethod] = useState("TRANSFER")
    const [notes, setNotes] = useState("")
    const [saving, setSaving] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

    // Espeja `saving` hacia el Dialog padre (guardedClose) y lo libera al desmontar.
    useEffect(() => {
        onBusyChange(saving)
        return () => onBusyChange(false)
    }, [saving, onBusyChange])

    const selected = fixedPurchase ?? purchases.find(p => p.id === purchaseId) ?? null
    const amountCents = Math.round((parseFloat(amount) || 0) * 100)
    const exceedsOc = selected !== null && amountCents > selected.saldoCents
    const canSubmit = !saving && amountCents > 0 && !exceedsOc

    const handleSubmit = async () => {
        if (saving) return
        if (amountCents <= 0) return toast.error("Escribe un monto mayor a cero.")
        if (exceedsOc) return toast.error("El monto excede el saldo de la orden seleccionada.")

        const payload = {
            supplierId: supplier.id,
            purchaseId: selected?.id ?? null,
            amountCents,
            method,
            notes: notes.trim() || undefined,
        }
        operation.current = getClientOperationKey(operation.current, payload)
        setSaving(true)
        try {
            const res = await fetch("/api/supplier-payments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar el pago.")
            operation.current = null
            toast.success(`Abono de ${formatPrice(amountCents / 100)} registrado`, {
                description: data?.folio ? `Ligado a ${data.folio}` : `A cuenta general de ${supplier.name}`,
            })
            close()
            onSaved()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar el pago.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <Banknote className="h-5 w-5 text-muted-foreground" />
                    Registrar pago a {supplier.name}
                </DialogTitle>
                <DialogDescription>
                    Documenta un abono al proveedor: a una orden específica o a cuenta general.
                </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                    <Label htmlFor="pago-purchase">Orden de compra (opcional)</Label>
                    {fixedPurchase ? (
                        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                            {fixedPurchase.folio}
                            <span className="text-muted-foreground">
                                {" "}· saldo {formatPrice(fixedPurchase.saldoCents / 100)}
                            </span>
                        </div>
                    ) : (
                        <Select value={purchaseId} onValueChange={setPurchaseId}>
                            <SelectTrigger id="pago-purchase">
                                <SelectValue placeholder="Cuenta general" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={GENERAL}>Cuenta general (anticipo / sin ligar)</SelectItem>
                                {purchases.map(p => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.folio} · saldo {formatPrice(p.saldoCents / 100)}
                                        {p.status === "ORDERED" ? " (ordenada)" : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="pago-amount">Monto (MXN)</Label>
                        <Input
                            id="pago-amount"
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            className="tabular-nums"
                            autoFocus
                        />
                        {exceedsOc && (
                            <p className="text-xs text-red-600">
                                Excede el saldo de {selected.folio} ({formatPrice(selected.saldoCents / 100)}).
                            </p>
                        )}
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="pago-method">Método</Label>
                        <Select value={method} onValueChange={setMethod}>
                            <SelectTrigger id="pago-method">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.entries(SUPPLIER_METHOD_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="pago-notes">Notas (opcional)</Label>
                    <Textarea
                        id="pago-notes"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Referencia de transferencia, factura cubierta…"
                        maxLength={1000}
                        className="resize-none h-16"
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
                        : <Banknote className="mr-2 h-4 w-4" />}
                    Registrar pago
                </Button>
            </DialogFooter>
        </>
    )
}
