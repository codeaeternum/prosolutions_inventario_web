"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BookMarked, Loader2, RefreshCw, Wallet } from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { DEPOSIT_METHODS, type PosDocumentSummary, type PosPaymentMethod } from "./types"

interface LayawaysSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    branchId: string
    /** Sube tras crear/liquidar un apartado para forzar recarga al abrir. */
    refreshKey: number
}

// Respuesta de POST /api/pos/documents/<id>/pay (payDocument).
interface PayResponse {
    sale?: { id?: string; status?: string } | null
    paid?: number
    balance?: number
    completed?: boolean
    error?: string
}

function docBalance(doc: PosDocumentSummary): number {
    if (doc.balance != null) return doc.balance
    if (doc.paid != null) return Math.max(0, doc.total - doc.paid)
    return doc.total
}

function docPaid(doc: PosDocumentSummary): number {
    if (doc.paid != null) return doc.paid
    return Math.max(0, doc.total - docBalance(doc))
}

/** Apartados vigentes (documentos OPEN/LAYAWAY) y cobro de saldo «Liquidar». */
export function LayawaysSheet({ open, onOpenChange, branchId, refreshKey }: LayawaysSheetProps) {
    const [documents, setDocuments] = useState<PosDocumentSummary[]>([])
    const [loading, setLoading] = useState(false)

    const [payTarget, setPayTarget] = useState<PosDocumentSummary | null>(null)
    const [payMethod, setPayMethod] = useState<PosPaymentMethod>("EFECTIVO")
    const [payAmount, setPayAmount] = useState("")
    const [payRef, setPayRef] = useState("")
    const [cashGiven, setCashGiven] = useState("")
    const [paying, setPaying] = useState(false)
    const pendingPay = useRef<ClientOperationKey | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({ status: "OPEN", kind: "LAYAWAY" })
            if (branchId) params.set("branchId", branchId)
            const res = await fetch(`/api/pos/documents?${params}`)
            const data: { documents?: PosDocumentSummary[]; error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudieron cargar")
            setDocuments(data?.documents ?? [])
        } catch (error) {
            setDocuments([])
            toast.error(error instanceof Error ? error.message : "No se pudieron cargar los apartados")
        } finally {
            setLoading(false)
        }
    }, [branchId])

    useEffect(() => {
        if (!open) return
        // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
        const id = setTimeout(() => void load(), 0)
        return () => clearTimeout(id)
    }, [open, load, refreshKey])

    const openPay = (doc: PosDocumentSummary) => {
        setPayTarget(doc)
        setPayMethod("EFECTIVO")
        setPayAmount(docBalance(doc).toFixed(2))
        setPayRef("")
        setCashGiven("")
        pendingPay.current = null
    }

    const submitPay = async () => {
        const doc = payTarget
        if (!doc || paying) return
        const amount = parseFloat(payAmount)
        const balance = docBalance(doc)
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error("Captura un monto válido")
            return
        }
        if (amount > balance + 0.009) {
            toast.error(`El abono no puede superar el saldo (${formatPrice(balance)})`)
            return
        }
        if (payMethod === "TRANSFERENCIA" && !payRef.trim()) {
            toast.error("Captura la referencia de la transferencia")
            return
        }
        const payload = {
            branchId: branchId || undefined,
            payments: [{ method: payMethod, amount, ...(payMethod === "TRANSFERENCIA" ? { reference: payRef.trim() } : {}) }],
        }
        pendingPay.current = getClientOperationKey(pendingPay.current, { saleId: doc.id, ...payload })
        setPaying(true)
        try {
            const res = await fetch(`/api/pos/documents/${doc.id}/pay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: pendingPay.current.key }),
            })
            const data: PayResponse | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar el abono")
            pendingPay.current = null

            const remaining = data?.balance ?? Math.max(0, balance - amount)
            const finished = data?.completed === true || remaining <= 0.009
            if (finished) {
                toast.success(`Apartado #${doc.number} liquidado por completo`)
            } else {
                toast.success(`Abono de ${formatPrice(amount)} registrado — restan ${formatPrice(remaining)}`)
            }
            if (payMethod === "EFECTIVO" && cashGiven) {
                const change = parseFloat(cashGiven) - amount
                if (change > 0.009) toast.info(`Cambio a entregar: ${formatPrice(change)}`)
            }
            setPayTarget(null)
            void load()
        } catch (error) {
            toast.error(error instanceof TypeError
                ? "No se pudo confirmar el abono. Reintenta sin cambiarlo para evitar duplicados."
                : error instanceof Error ? error.message : "No se pudo registrar el abono")
        } finally {
            setPaying(false)
        }
    }

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent side="right" className="w-full sm:max-w-md p-4">
                    <SheetHeader className="pb-3">
                        <SheetTitle className="flex items-center gap-2">
                            <BookMarked className="h-5 w-5" />
                            Apartados pendientes
                            <Button type="button" variant="ghost" size="icon-sm" onClick={() => void load()} disabled={loading} aria-label="Recargar">
                                <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                            </Button>
                        </SheetTitle>
                    </SheetHeader>
                    {loading && documents.length === 0 ? (
                        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                    ) : documents.length === 0 ? (
                        <p className="py-16 text-center text-sm text-muted-foreground">No hay apartados pendientes en esta sucursal</p>
                    ) : (
                        <div className="space-y-2">
                            {documents.map(doc => {
                                const paid = docPaid(doc)
                                const balance = docBalance(doc)
                                return (
                                    <div key={doc.id} className="rounded-lg border p-3 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-sm font-semibold">Apartado #{doc.number}</p>
                                            <Badge variant="secondary">{formatPrice(doc.total)}</Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {doc.customer?.name ?? "Mostrador"} · {formatDate(doc.createdAt)}
                                            {doc.note ? ` · “${doc.note}”` : ""}
                                        </p>
                                        <div className="flex items-center justify-between text-xs">
                                            <span className="text-muted-foreground">
                                                Anticipado {formatPrice(paid)} · <span className="font-medium text-amber-600">resta {formatPrice(balance)}</span>
                                            </span>
                                            <Button type="button" size="sm" onClick={() => openPay(doc)} disabled={balance <= 0}>
                                                <Wallet className="h-3.5 w-3.5" />
                                                Liquidar
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            <Dialog open={payTarget !== null} onOpenChange={o => { if (!o && !paying) setPayTarget(null) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Liquidar apartado #{payTarget?.number}</DialogTitle>
                    </DialogHeader>
                    {payTarget && (
                        <div className="space-y-4 py-2">
                            <div className="bg-primary/10 p-4 rounded-lg flex justify-between items-center">
                                <span className="font-medium">Saldo pendiente:</span>
                                <span className="text-xl font-bold text-primary">{formatPrice(docBalance(payTarget))}</span>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Método de pago</Label>
                                <Select value={payMethod} onValueChange={v => setPayMethod(v as PosPaymentMethod)}>
                                    <SelectTrigger disabled={paying}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {DEPOSIT_METHODS.map(m => (
                                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="layaway-pay-amount">Monto del abono</Label>
                                <Input
                                    id="layaway-pay-amount"
                                    type="number" min="0" step="0.01"
                                    disabled={paying}
                                    value={payAmount}
                                    onChange={e => setPayAmount(e.target.value)}
                                />
                            </div>
                            {payMethod === "TRANSFERENCIA" && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="layaway-pay-ref">Referencia de la transferencia *</Label>
                                    <Input
                                        id="layaway-pay-ref"
                                        placeholder="Folio SPEI / clave de rastreo"
                                        maxLength={200}
                                        disabled={paying}
                                        value={payRef}
                                        onChange={e => setPayRef(e.target.value)}
                                    />
                                </div>
                            )}
                            {payMethod === "EFECTIVO" && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="layaway-cash-given">Efectivo recibido</Label>
                                    <Input
                                        id="layaway-cash-given"
                                        type="number" min="0"
                                        placeholder="Ej: 500"
                                        disabled={paying}
                                        value={cashGiven}
                                        onChange={e => setCashGiven(e.target.value)}
                                    />
                                    {cashGiven && parseFloat(payAmount) > 0 && parseFloat(cashGiven) >= parseFloat(payAmount) && (
                                        <p className="text-green-600 font-medium text-sm">
                                            Cambio: {formatPrice(parseFloat(cashGiven) - parseFloat(payAmount))}
                                        </p>
                                    )}
                                    {cashGiven && parseFloat(cashGiven) < (parseFloat(payAmount) || 0) && (
                                        <p className="text-destructive font-medium text-sm">
                                            Faltan: {formatPrice((parseFloat(payAmount) || 0) - parseFloat(cashGiven))}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPayTarget(null)} disabled={paying}>Cancelar</Button>
                        <Button onClick={() => { void submitPay() }} disabled={paying || !payAmount || parseFloat(payAmount) <= 0}>
                            {paying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Registrar abono
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
