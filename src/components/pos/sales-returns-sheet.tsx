"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
    Ban,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Minus,
    Plus,
    Printer,
    RefreshCw,
    RotateCcw,
    Search,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { PAYMENT_METHODS, type PosPaymentMethod } from "./types"

interface SalesReturnsSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    branchId: string
    refreshKey: number
    onReturned: () => void
    initialQuery?: string
}

interface SaleItemRecord {
    id: string
    productId: string
    quantity: number
    returnedQuantity: number
    unitPrice: number
    totalPrice: number
    product: { id: string; name: string }
}

interface SalePaymentRecord {
    id: string
    method: string
    amount: number
    status: string
    reference?: string | null
}

interface SaleRecord {
    id: string
    number: number
    kind: string
    status: "COMPLETED" | "VOIDED" | "DRAFT" | "OPEN"
    total: number
    discountCents: number
    createdAt: string
    branch?: { id: string; name: string } | null
    seller?: { id: string; name: string } | null
    customer?: { id: string; name: string } | null
    items: SaleItemRecord[]
    payments: SalePaymentRecord[]
}

interface SalesListResponse {
    sales?: SaleRecord[]
    total?: number
    page?: number
    totalPages?: number
    error?: string
}

const DB_TO_POS_METHOD: Record<string, PosPaymentMethod> = {
    CASH: "EFECTIVO",
    EFECTIVO: "EFECTIVO",
    CARD: "TARJETA",
    TARJETA: "TARJETA",
    TRANSFER: "TRANSFERENCIA",
    TRANSFERENCIA: "TRANSFERENCIA",
    CREDIT: "CREDITO",
    CREDITO: "CREDITO",
}

const METHOD_LABEL: Record<string, string> = {
    CASH: "Efectivo",
    EFECTIVO: "Efectivo",
    CARD: "Tarjeta",
    TARJETA: "Tarjeta",
    TRANSFER: "Transferencia",
    TRANSFERENCIA: "Transferencia",
    CREDIT: "Crédito",
    CREDITO: "Crédito",
}

function formatSaleFolio(number: number): string {
    return `V-${String(number).padStart(6, "0")}`
}

function defaultRefundMethod(sale: SaleRecord): PosPaymentMethod {
    const netByMethod = new Map<PosPaymentMethod, number>()
    for (const payment of sale.payments) {
        if (payment.status === "VOIDED") continue
        const mapped = DB_TO_POS_METHOD[payment.method]
        if (!mapped) continue
        netByMethod.set(mapped, (netByMethod.get(mapped) ?? 0) + payment.amount)
    }
    let bestMethod: PosPaymentMethod = "EFECTIVO"
    let bestAmount = -1
    for (const [method, net] of netByMethod.entries()) {
        if (net > bestAmount) {
            bestAmount = net
            bestMethod = method
        }
    }
    if (bestAmount > 0) return bestMethod
    const firstPositive = sale.payments.find(p => p.amount > 0)
    return (firstPositive && DB_TO_POS_METHOD[firstPositive.method]) || "EFECTIVO"
}

/** Historial rápido de tickets en POS con reimpresión, devolución parcial y anulación. */
export function SalesReturnsSheet({
    open,
    onOpenChange,
    branchId,
    refreshKey,
    onReturned,
    initialQuery,
}: SalesReturnsSheetProps) {
    const [sales, setSales] = useState<SaleRecord[]>([])
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [searchQuery, setSearchQuery] = useState(initialQuery ?? "")
    const [debouncedQuery, setDebouncedQuery] = useState(() => (initialQuery ?? "").trim())
    const requestRef = useRef(0)
    const wasOpenRef = useRef(false)
    const lastInitialRef = useRef((initialQuery ?? "").trim())

    // Acción activa por tarjeta: devolver artículos o anular ticket.
    const [activeAction, setActiveAction] = useState<{ saleId: string; mode: "return" | "void" } | null>(null)
    const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({})
    const [refundMethod, setRefundMethod] = useState<PosPaymentMethod>("EFECTIVO")
    const [reason, setReason] = useState("")
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        const trimmed = searchQuery.trim()
        if (trimmed === debouncedQuery) return
        const timer = setTimeout(() => {
            setPage(1)
            setDebouncedQuery(trimmed)
        }, 250)
        return () => clearTimeout(timer)
    }, [searchQuery, debouncedQuery])

    const load = useCallback(async (targetPage = 1, query = debouncedQuery) => {
        const requestId = ++requestRef.current
        setLoading(true)
        try {
            const params = new URLSearchParams({ page: String(targetPage) })
            if (branchId) params.set("branchId", branchId)
            const q = query.trim()
            if (q) params.set("q", q)
            const res = await fetch(`/api/sales?${params}`)
            const data: SalesListResponse | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los tickets")
            if (requestRef.current !== requestId) return
            setSales(data?.sales ?? [])
            setPage(data?.page ?? targetPage)
            setTotalPages(data?.totalPages ?? 1)
        } catch (error) {
            if (requestRef.current !== requestId) return
            setSales([])
            toast.error(error instanceof Error ? error.message : "No se pudieron cargar los tickets")
        } finally {
            if (requestRef.current === requestId) setLoading(false)
        }
    }, [branchId, debouncedQuery])

    useEffect(() => {
        if (!open) {
            wasOpenRef.current = false
            return
        }
        const justOpened = !wasOpenRef.current
        wasOpenRef.current = true
        const incomingInitial = initialQuery?.trim() ?? ""
        const initialChanged = incomingInitial !== lastInitialRef.current
        lastInitialRef.current = incomingInitial

        if ((justOpened || initialChanged) && incomingInitial) {
            // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
            const id = setTimeout(() => {
                setSearchQuery(initialQuery ?? incomingInitial)
                setPage(1)
                if (debouncedQuery !== incomingInitial) {
                    setDebouncedQuery(incomingInitial)
                } else {
                    void load(1, incomingInitial)
                }
            }, 0)
            return () => clearTimeout(id)
        }

        // setTimeout evita setState síncrono dentro del effect (react-hooks/set-state-in-effect)
        const id = setTimeout(() => void load(1), 0)
        return () => clearTimeout(id)
    }, [open, initialQuery, debouncedQuery, branchId, refreshKey, load])

    const filteredSales = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) return sales
        const numericQuery = q.replace(/^v-?0*/i, "")
        return sales.filter(sale => {
            if (sale.id.toLowerCase().includes(q)) return true
            const folio = formatSaleFolio(sale.number).toLowerCase()
            if (folio.includes(q)) return true
            if (numericQuery && String(sale.number).includes(numericQuery)) return true
            const customerName = (sale.customer?.name ?? "mostrador").toLowerCase()
            if (customerName.includes(q)) return true
            return sale.items.some(item => item.product.name.toLowerCase().includes(q))
        })
    }, [sales, searchQuery])

    const openReturnForm = (sale: SaleRecord) => {
        const initial: Record<string, number> = {}
        const returnableItems = sale.items.filter(i => i.quantity > i.returnedQuantity)
        for (const item of sale.items) {
            const remaining = Math.max(0, item.quantity - item.returnedQuantity)
            initial[item.id] = returnableItems.length === 1 && remaining > 0 ? 1 : 0
        }
        setReturnQuantities(initial)
        setRefundMethod(defaultRefundMethod(sale))
        setReason("")
        setActiveAction({ saleId: sale.id, mode: "return" })
    }

    const openVoidForm = (sale: SaleRecord) => {
        setReason("")
        setActiveAction({ saleId: sale.id, mode: "void" })
    }

    const closeActionForm = () => {
        if (submitting) return
        setActiveAction(null)
        setReturnQuantities({})
        setReason("")
    }

    const setItemReturnQty = (saleItemId: string, maxQty: number, nextValue: number) => {
        const clamped = Math.max(0, Math.min(maxQty, Math.floor(Number.isFinite(nextValue) ? nextValue : 0)))
        setReturnQuantities(prev => ({ ...prev, [saleItemId]: clamped }))
    }

    const submitReturn = async (sale: SaleRecord) => {
        if (submitting) return
        const items = sale.items
            .map(item => ({
                saleItemId: item.id,
                quantity: Math.min(
                    Math.max(0, item.quantity - item.returnedQuantity),
                    returnQuantities[item.id] ?? 0,
                ),
            }))
            .filter(item => item.quantity > 0)

        if (items.length === 0) {
            toast.error("Selecciona al menos un artículo para devolver")
            return
        }
        if (!reason.trim()) {
            toast.error("Escribe el motivo de la devolución")
            return
        }

        setSubmitting(true)
        try {
            const res = await fetch(`/api/sales/${sale.id}/returns`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    items,
                    refundMethod,
                    reason: reason.trim(),
                    idempotencyKey: crypto.randomUUID(),
                }),
            })
            const data: { refunded?: number; error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo procesar la devolución")

            const refundedLabel = data?.refunded != null ? ` (${formatPrice(data.refunded)})` : ""
            toast.success(`Devolución registrada en ${formatSaleFolio(sale.number)}${refundedLabel}`)
            setActiveAction(null)
            setReturnQuantities({})
            setReason("")
            void load(page)
            onReturned()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo procesar la devolución")
        } finally {
            setSubmitting(false)
        }
    }

    const submitVoid = async (sale: SaleRecord) => {
        if (submitting) return
        if (!reason.trim()) {
            toast.error("Escribe el motivo de la anulación")
            return
        }

        setSubmitting(true)
        try {
            const res = await fetch(`/api/sales/${sale.id}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    reason: reason.trim(),
                    idempotencyKey: crypto.randomUUID(),
                }),
            })
            const data: { error?: string } | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo anular el ticket")

            toast.success(`Ticket ${formatSaleFolio(sale.number)} anulado`)
            setActiveAction(null)
            setReason("")
            void load(page)
            onReturned()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo anular el ticket")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full sm:max-w-lg p-4 overflow-y-auto">
                <SheetHeader className="pb-3">
                    <SheetTitle className="flex items-center gap-2">
                        <RotateCcw className="h-5 w-5" />
                        Tickets y devoluciones
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void load(page)}
                            disabled={loading}
                            aria-label="Recargar"
                        >
                            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                        </Button>
                    </SheetTitle>
                </SheetHeader>

                <div className="space-y-3">
                    <div className="relative">
                        <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <Input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Buscar por folio (V-000123), cliente o artículo..."
                            className="pl-9"
                        />
                    </div>

                    {loading && sales.length === 0 ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredSales.length === 0 ? (
                        <p className="py-16 text-center text-sm text-muted-foreground">
                            {searchQuery.trim()
                                ? "No hay tickets que coincidan con la búsqueda"
                                : "No hay tickets recientes en esta sucursal"}
                        </p>
                    ) : (
                        <div className="space-y-2.5">
                            {filteredSales.map(sale => {
                                const folio = formatSaleFolio(sale.number)
                                const discount = (sale.discountCents ?? 0) / 100
                                const netTotal = Math.max(0, sale.total - discount)
                                const hasReturnableUnits =
                                    sale.status === "COMPLETED" &&
                                    sale.items.some(item => item.quantity > item.returnedQuantity)
                                const isReturnOpen =
                                    activeAction?.saleId === sale.id && activeAction.mode === "return"
                                const isVoidOpen =
                                    activeAction?.saleId === sale.id && activeAction.mode === "void"
                                const positivePayments = sale.payments.filter(p => p.amount > 0)

                                return (
                                    <div key={sale.id} className="rounded-lg border p-3 space-y-2">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="text-sm font-semibold font-mono">{folio}</span>
                                                <Badge
                                                    variant={sale.status === "VOIDED" ? "destructive" : "secondary"}
                                                    className="text-[10px] px-1.5"
                                                >
                                                    {sale.status === "VOIDED" ? "VOIDED · Anulada" : "COMPLETED · Pagada"}
                                                </Badge>
                                                {sale.kind === "WORKSHOP" && (
                                                    <Badge variant="outline" className="text-[10px] px-1.5">
                                                        Nota a taller
                                                    </Badge>
                                                )}
                                            </div>
                                            <Badge variant="secondary" className="font-semibold">
                                                {formatPrice(netTotal)}
                                            </Badge>
                                        </div>

                                        <p className="text-xs text-muted-foreground">
                                            {formatDate(sale.createdAt)}
                                            {" · "}Cliente: <span className="text-foreground">{sale.customer?.name ?? "Mostrador"}</span>
                                            {sale.seller?.name ? ` · Vendedor: ${sale.seller.name}` : ""}
                                        </p>

                                        <div className="rounded bg-muted/40 p-2 space-y-1 text-xs">
                                            {sale.items.map(item => {
                                                const remaining = Math.max(0, item.quantity - item.returnedQuantity)
                                                return (
                                                    <div key={item.id} className="flex items-center justify-between gap-2">
                                                        <span className="truncate">
                                                            <span className="font-medium">{item.quantity}×</span>{" "}
                                                            {item.product.name}
                                                            {item.returnedQuantity > 0 && (
                                                                <Badge variant="outline" className="ml-1.5 text-[10px] px-1 py-0 text-amber-600 border-amber-300">
                                                                    Devueltos: {item.returnedQuantity}/{item.quantity}
                                                                    {remaining > 0 ? ` (quedan ${remaining})` : ""}
                                                                </Badge>
                                                            )}
                                                        </span>
                                                        <span className="shrink-0 text-muted-foreground">
                                                            {formatPrice(item.totalPrice)}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>

                                        {positivePayments.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                                <span>Pago:</span>
                                                {positivePayments.map(p => (
                                                    <Badge key={p.id} variant="outline" className="text-[10px] font-normal">
                                                        {METHOD_LABEL[p.method] ?? p.method}: {formatPrice(p.amount)}
                                                    </Badge>
                                                ))}
                                                {discount > 0 && (
                                                    <span className="text-[11px] text-amber-600">
                                                        · Desc. {formatPrice(discount)}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            <Button type="button" variant="outline" size="sm" asChild>
                                                <Link
                                                    href={`/admin/tickets/venta/${sale.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                >
                                                    <Printer className="h-3.5 w-3.5" />
                                                    Ticket
                                                </Link>
                                            </Button>

                                            {hasReturnableUnits && (
                                                <>
                                                    <Button
                                                        type="button"
                                                        variant={isReturnOpen ? "default" : "secondary"}
                                                        size="sm"
                                                        disabled={submitting}
                                                        onClick={() =>
                                                            isReturnOpen ? closeActionForm() : openReturnForm(sale)
                                                        }
                                                    >
                                                        <RotateCcw className="h-3.5 w-3.5" />
                                                        Devolver artículos
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-destructive hover:text-destructive"
                                                        disabled={submitting}
                                                        onClick={() =>
                                                            isVoidOpen ? closeActionForm() : openVoidForm(sale)
                                                        }
                                                    >
                                                        <Ban className="h-3.5 w-3.5" />
                                                        Anular ticket
                                                    </Button>
                                                </>
                                            )}
                                        </div>

                                        {isReturnOpen && (
                                            <div className="mt-2 rounded-md border bg-background p-3 space-y-3">
                                                <p className="text-xs font-semibold">
                                                    Seleccionar unidades a devolver ({folio})
                                                </p>
                                                <div className="space-y-2">
                                                    {sale.items.map(item => {
                                                        const maxQty = Math.max(0, item.quantity - item.returnedQuantity)
                                                        if (maxQty === 0) return null
                                                        const currentQty = returnQuantities[item.id] ?? 0
                                                        return (
                                                            <div
                                                                key={item.id}
                                                                className="flex items-center justify-between gap-2 text-xs"
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="font-medium truncate">{item.product.name}</p>
                                                                    <p className="text-muted-foreground">
                                                                        Disponibles: {maxQty} · {formatPrice(item.unitPrice)} c/u
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-1">
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="icon-sm"
                                                                        disabled={submitting || currentQty <= 0}
                                                                        onClick={() =>
                                                                            setItemReturnQty(item.id, maxQty, currentQty - 1)
                                                                        }
                                                                        aria-label={`Menos ${item.product.name}`}
                                                                    >
                                                                        <Minus className="h-3 w-3" />
                                                                    </Button>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        max={maxQty}
                                                                        value={currentQty}
                                                                        disabled={submitting}
                                                                        onChange={e =>
                                                                            setItemReturnQty(
                                                                                item.id,
                                                                                maxQty,
                                                                                Number.parseInt(e.target.value, 10) || 0,
                                                                            )
                                                                        }
                                                                        className="w-14 h-8 text-center px-1"
                                                                        aria-label={`Cantidad a devolver de ${item.product.name}`}
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="icon-sm"
                                                                        disabled={submitting || currentQty >= maxQty}
                                                                        onClick={() =>
                                                                            setItemReturnQty(item.id, maxQty, currentQty + 1)
                                                                        }
                                                                        aria-label={`Más ${item.product.name}`}
                                                                    >
                                                                        <Plus className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label className="text-xs">Método de reembolso</Label>
                                                    <Select
                                                        value={refundMethod}
                                                        onValueChange={v => setRefundMethod(v as PosPaymentMethod)}
                                                    >
                                                        <SelectTrigger disabled={submitting} className="h-8 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {PAYMENT_METHODS.map(m => (
                                                                <SelectItem key={m.value} value={m.value}>
                                                                    {m.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1.5">
                                                    <Label htmlFor={`return-reason-${sale.id}`} className="text-xs">
                                                        Motivo de la devolución *
                                                    </Label>
                                                    <Input
                                                        id={`return-reason-${sale.id}`}
                                                        value={reason}
                                                        disabled={submitting}
                                                        onChange={e => setReason(e.target.value)}
                                                        placeholder="Ej. Pieza defectuosa, cambio de modelo..."
                                                        maxLength={500}
                                                        className="h-8 text-xs"
                                                    />
                                                </div>

                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={submitting}
                                                        onClick={closeActionForm}
                                                    >
                                                        Cancelar
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        disabled={submitting}
                                                        onClick={() => void submitReturn(sale)}
                                                    >
                                                        {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                                        Confirmar devolución
                                                    </Button>
                                                </div>
                                            </div>
                                        )}

                                        {isVoidOpen && (
                                            <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-3">
                                                <p className="text-xs font-semibold text-destructive">
                                                    Anular ticket {folio}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    Se repondrán las unidades restantes al inventario y se revertirá el cobro registrado.
                                                </p>
                                                <div className="space-y-1.5">
                                                    <Label htmlFor={`void-reason-${sale.id}`} className="text-xs">
                                                        Motivo de la anulación *
                                                    </Label>
                                                    <Input
                                                        id={`void-reason-${sale.id}`}
                                                        value={reason}
                                                        disabled={submitting}
                                                        onChange={e => setReason(e.target.value)}
                                                        placeholder="Ej. Error en cobro, cancelación del cliente..."
                                                        maxLength={500}
                                                        className="h-8 text-xs"
                                                    />
                                                </div>
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={submitting}
                                                        onClick={closeActionForm}
                                                    >
                                                        Cancelar
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="sm"
                                                        disabled={submitting}
                                                        onClick={() => void submitVoid(sale)}
                                                    >
                                                        {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                                                        Confirmar anulación
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
                            <span>
                                Página {page} de {totalPages}
                            </span>
                            <div className="flex gap-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading || page <= 1}
                                    onClick={() => void load(page - 1)}
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                    Anterior
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={loading || page >= totalPages}
                                    onClick={() => void load(page + 1)}
                                >
                                    Siguiente
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    )
}
