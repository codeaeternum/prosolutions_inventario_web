"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { BookMarked, Loader2, RefreshCw, Trash2, Wallet } from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { DEPOSIT_METHODS, type PosDocumentSummary, type PosPaymentMethod } from "./types"

export const LAYAWAY_PAY_KEY_PREFIX = "pos:layaway-pay:"

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & Partial<Pick<Storage, "key" | "length">>

function defaultPayStorage(): KeyStorage | null {
    if (typeof window === "undefined") return null
    try {
        return window.sessionStorage ?? window.localStorage ?? null
    } catch {
        return null
    }
}

export function layawayPayStorageKey(saleId: string, amount: number, method: string): string {
    return `${LAYAWAY_PAY_KEY_PREFIX}${saleId}:${Math.round(amount * 100)}:${method}`
}

function parseStoredOperationKey(raw: string | null): ClientOperationKey | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as Partial<ClientOperationKey>
        if (typeof parsed?.key !== "string" || !parsed.key || typeof parsed?.fingerprint !== "string") return null
        return { key: parsed.key, fingerprint: parsed.fingerprint }
    } catch {
        return null
    }
}

/**
 * Resuelve y persiste en sessionStorage/localStorage la llave idempotente de un
 * abono de apartado por `saleId + amount + method`. Si el navegador recarga o
 * la red falla en vuelo, el reintento con los mismos datos reutiliza la llave.
 */
export function resolveLayawayPayKey(
    previous: ClientOperationKey | null,
    input: { saleId: string; amount: number; method: string; payload: unknown },
    storage: KeyStorage | null = defaultPayStorage(),
): ClientOperationKey {
    const storageKey = layawayPayStorageKey(input.saleId, input.amount, input.method)
    const targetPayload = { saleId: input.saleId, ...(input.payload as object) }
    let stored: ClientOperationKey | null = null
    if (storage) {
        try {
            stored = parseStoredOperationKey(storage.getItem(storageKey))
        } catch {
            stored = null
        }
    }
    const seed = previous?.fingerprint === JSON.stringify(targetPayload) ? previous : (stored ?? previous)
    const next = getClientOperationKey(seed, targetPayload)
    if (storage) {
        try {
            storage.setItem(storageKey, JSON.stringify(next))
        } catch {
            // Storage lleno o restringido: la llave sigue viva en memoria.
        }
    }
    return next
}

/** Limpia la llave persistida del abono (en éxito o error 4xx definitivo). */
export function clearLayawayPayKey(
    saleId: string,
    amount?: number,
    method?: string,
    storage: KeyStorage | null = defaultPayStorage(),
): void {
    if (!storage) return
    try {
        if (amount !== undefined && method !== undefined) {
            storage.removeItem(layawayPayStorageKey(saleId, amount, method))
            return
        }
        const prefix = `${LAYAWAY_PAY_KEY_PREFIX}${saleId}:`
        if (typeof storage.length === "number" && typeof storage.key === "function") {
            const toRemove: string[] = []
            for (let i = 0; i < storage.length; i++) {
                const k = storage.key(i)
                if (k?.startsWith(prefix)) toRemove.push(k)
            }
            for (const k of toRemove) storage.removeItem(k)
        }
    } catch {
        // Ignorar errores de acceso a storage.
    }
}

interface LayawaysSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    branchId: string
    /** Sube tras crear/liquidar un apartado para forzar recarga al abrir. */
    refreshKey: number
    /** sale_auto_ticket: al liquidar, el ticket del apartado abre en pestaña nueva. */
    autoOpenTicket?: boolean
}

// Respuesta de POST /api/pos/documents/<id>/pay (payDocument).
interface PayResponse {
    sale?: { id?: string; status?: string } | null
    paid?: number
    balance?: number
    completed?: boolean
    error?: string
}

// total/paid/balance llegan en pesos (Float): toda la aritmética se hace en
// centavos enteros para que un saldo de $0.30 no quede en 0.30000000000004.
function docBalanceCents(doc: PosDocumentSummary): number {
    if (doc.balance != null) return Math.round(doc.balance * 100)
    if (doc.paid != null) return Math.max(0, Math.round(doc.total * 100) - Math.round(doc.paid * 100))
    return Math.round(doc.total * 100)
}

function docBalance(doc: PosDocumentSummary): number {
    return docBalanceCents(doc) / 100
}

function docPaidCents(doc: PosDocumentSummary): number {
    if (doc.paid != null) return Math.round(doc.paid * 100)
    return Math.max(0, Math.round(doc.total * 100) - docBalanceCents(doc))
}

function docPaid(doc: PosDocumentSummary): number {
    return docPaidCents(doc) / 100
}

/** Apartados vigentes (documentos OPEN/LAYAWAY) y cobro de saldo «Liquidar». */
export function LayawaysSheet({ open, onOpenChange, branchId, refreshKey, autoOpenTicket }: LayawaysSheetProps) {
    const [documents, setDocuments] = useState<PosDocumentSummary[]>([])
    const [loading, setLoading] = useState(false)

    const [payTarget, setPayTarget] = useState<PosDocumentSummary | null>(null)
    const [payMethod, setPayMethod] = useState<PosPaymentMethod>("EFECTIVO")
    const [payAmount, setPayAmount] = useState("")
    const [payRef, setPayRef] = useState("")
    const [cashGiven, setCashGiven] = useState("")
    const [paying, setPaying] = useState(false)
    const pendingPay = useRef<ClientOperationKey | null>(null)

    const [cancelTarget, setCancelTarget] = useState<PosDocumentSummary | null>(null)
    const [cancelReason, setCancelReason] = useState("")
    const [cancelling, setCancelling] = useState(false)
    const cancelRequestKey = useRef(0)
    const pendingCancel = useRef<ClientOperationKey | null>(null)

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

    const openCancel = (doc: PosDocumentSummary) => {
        setCancelTarget(doc)
        setCancelReason("")
        pendingCancel.current = null
    }

    const submitCancel = async () => {
        const target = cancelTarget
        if (!target || cancelling) return
        const reason = cancelReason.trim()
        if (!reason) {
            toast.error("Captura el motivo de la cancelación")
            return
        }
        const requestId = ++cancelRequestKey.current
        pendingCancel.current = getClientOperationKey(pendingCancel.current, { saleId: target.id, reason })
        setCancelling(true)
        try {
            const res = await fetch(`/api/pos/documents/${target.id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason, idempotencyKey: pendingCancel.current.key }),
            })
            const data: { error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo cancelar el apartado")
            if (cancelRequestKey.current !== requestId) return
            pendingCancel.current = null
            clearLayawayPayKey(target.id)
            const refundAmount = docPaid(target)
            toast.success(
                refundAmount > 0
                    ? `Apartado #${target.number} cancelado — reembolso de ${formatPrice(refundAmount)}`
                    : `Apartado #${target.number} cancelado`,
            )
            setCancelTarget(null)
            setCancelReason("")
            void load()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo cancelar el apartado")
        } finally {
            setCancelling(false)
        }
    }

    const submitPay = async () => {
        const doc = payTarget
        if (!doc || paying) return
        const amount = parseFloat(payAmount)
        const balanceCents = docBalanceCents(doc)
        const balance = balanceCents / 100
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error("Captura un monto válido")
            return
        }
        if (Math.round(amount * 100) > balanceCents) {
            toast.error(`El abono no puede superar el saldo (${formatPrice(balance)})`)
            return
        }
        if (payMethod === "TRANSFERENCIA" && !payRef.trim()) {
            toast.error("Captura la referencia de la transferencia")
            return
        }
        const payload = {
            cashierBranchId: branchId || undefined,
            payments: [{ method: payMethod, amount, ...(payMethod === "TRANSFERENCIA" ? { reference: payRef.trim() } : {}) }],
        }
        pendingPay.current = resolveLayawayPayKey(pendingPay.current, {
            saleId: doc.id,
            amount,
            method: payMethod,
            payload,
        })
        // La pestaña del ticket se abre dentro del click; esperar al await la bloquea.
        const ticketPopup = autoOpenTicket ? window.open("", "_blank") : null
        setPaying(true)
        try {
            const res = await fetch(`/api/pos/documents/${doc.id}/pay`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: pendingPay.current.key }),
            })
            const data: PayResponse | null = await res.json().catch(() => null)
            if (!res.ok) {
                if (res.status >= 400 && res.status < 500) {
                    pendingPay.current = null
                    clearLayawayPayKey(doc.id, amount, payMethod)
                }
                throw new Error(data?.error || "No se pudo registrar el abono")
            }
            pendingPay.current = null
            clearLayawayPayKey(doc.id, amount, payMethod)
            clearLayawayPayKey(doc.id)

            const remainingCents = data?.balance != null
                ? Math.round(data.balance * 100)
                : Math.max(0, balanceCents - Math.round(amount * 100))
            const remaining = remainingCents / 100
            const finished = data?.completed === true || remainingCents <= 0
            const ticketId = data?.sale?.id
            if (finished && ticketPopup && ticketId) {
                ticketPopup.location.href = `/admin/tickets/venta/${ticketId}`
            } else {
                ticketPopup?.close()
            }
            if (finished) {
                toast.success(`Apartado #${doc.number} liquidado por completo`)
            } else {
                toast.success(`Abono de ${formatPrice(amount)} registrado — restan ${formatPrice(remaining)}`)
            }
            if (payMethod === "EFECTIVO" && cashGiven) {
                const changeCents = Math.round(parseFloat(cashGiven) * 100) - Math.round(amount * 100)
                if (changeCents > 0) toast.info(`Cambio a entregar: ${formatPrice(changeCents / 100)}`)
            }
            setPayTarget(null)
            void load()
        } catch (error) {
            ticketPopup?.close()
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
                                        <div className="flex items-center justify-between gap-2 text-xs">
                                            <span className="text-muted-foreground">
                                                Anticipado {formatPrice(paid)} · <span className="font-medium text-amber-600">resta {formatPrice(balance)}</span>
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-destructive hover:text-destructive"
                                                    disabled={cancelling || paying}
                                                    onClick={() => openCancel(doc)}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                    Cancelar apartado
                                                </Button>
                                                <Button type="button" size="sm" onClick={() => openPay(doc)} disabled={balance <= 0 || cancelling}>
                                                    <Wallet className="h-3.5 w-3.5" />
                                                    Liquidar
                                                </Button>
                                            </div>
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
                                    {cashGiven && Math.round(parseFloat(cashGiven) * 100) < (Math.round(parseFloat(payAmount) * 100) || 0) && (
                                        <p className="text-destructive font-medium text-sm">
                                            Faltan: {formatPrice(((Math.round(parseFloat(payAmount) * 100) || 0) - Math.round(parseFloat(cashGiven) * 100)) / 100)}
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

            <AlertDialog open={cancelTarget !== null} onOpenChange={o => { if (!o && !cancelling) { setCancelTarget(null); setCancelReason("") } }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Cancelar apartado #{cancelTarget?.number}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {cancelTarget && docPaid(cancelTarget) > 0
                                ? `Se repondrá la mercancía al inventario y se reembolsará el anticipo abonado de ${formatPrice(docPaid(cancelTarget))}. Esta acción no se puede deshacer.`
                                : "Se repondrá la mercancía al inventario (sin anticipo por reembolsar). Esta acción no se puede deshacer."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-1.5 py-2">
                        <Label htmlFor="layaway-cancel-reason">Motivo de la cancelación *</Label>
                        <Input
                            id="layaway-cancel-reason"
                            placeholder="Ej: Cliente desistió de la compra"
                            maxLength={500}
                            disabled={cancelling}
                            value={cancelReason}
                            onChange={e => setCancelReason(e.target.value)}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cancelling}>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={cancelling || !cancelReason.trim()}
                            onClick={e => {
                                e.preventDefault()
                                void submitCancel()
                            }}
                        >
                            {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Cancelar apartado
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
