"use client"

import { useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Loader2, Plus, X } from "lucide-react"
import { toast } from "sonner"
import { cn, formatPrice } from "@/lib/utils"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { CustomerPicker } from "./customer-picker"
import {
    DEPOSIT_METHODS,
    PAYMENT_METHODS,
    cartUnitsOf,
    toPaymentsPayload,
    type CartItem,
    type CheckoutResult,
    type PaymentDraft,
    type PosCustomer,
    type PosPaymentMethod,
} from "./types"

type DocType = "VENTA" | "LAYAWAY" | "QUOTE" | "WORKSHOP"

const DOC_TYPE_LABELS: Record<DocType, string> = {
    VENTA: "Venta",
    LAYAWAY: "Apartado",
    QUOTE: "Cotización",
    WORKSHOP: "A taller",
}

interface CheckoutDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    cart: CartItem[]
    cartTotal: number
    workshopActive: boolean
    /** Cliente STORE/TECHNICIAN: el servidor fuerza nota a taller. */
    workshopCustomer: boolean
    onWorkshopSaleChange: (value: boolean) => void
    customer: PosCustomer | null
    onCustomerChange: (customer: PosCustomer | null) => void
    branchId: string
    cajaOpen: boolean | null
    resumedDoc: { id: string; number: number; kind?: string } | null
    onBusyChange: (busy: boolean) => void
    /** Auto-impresión del ticket: abre la pestaña en el gesto del click, antes del await. */
    autoOpenTicket?: boolean
    onCompleted: (result: CheckoutResult, popup?: Window | null) => void
}

// POST /api/sales y /checkout responden {sale, quantity, total, payments};
// POST /api/pos/documents responde {document: {sale, quantity, total, kind, paid, balance}}.
interface SaleResponse {
    sale?: { id?: string; number?: number; kind?: string } | null
    document?: {
        sale?: { id?: string; number?: number; kind?: string } | null
        kind?: string
        total?: number
        quantity?: number
        balance?: number
        paid?: number
    } | null
    id?: string
    number?: number
    kind?: string
    total?: number
    quantity?: number
    payments?: { method?: string }[]
    error?: string
}

function MethodSelect({ value, onChange, disabled, methods }: {
    value: PosPaymentMethod
    onChange: (method: PosPaymentMethod) => void
    disabled?: boolean
    methods: { value: PosPaymentMethod; label: string }[]
}) {
    return (
        <Select value={value} onValueChange={v => onChange(v as PosPaymentMethod)}>
            <SelectTrigger disabled={disabled}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {methods.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/** Cobro y cierre del ticket: venta, nota a taller, apartado o cotización. */
export function CheckoutDialog(props: CheckoutDialogProps) {
    const busyRef = useRef(false)
    return (
        <Dialog open={props.open} onOpenChange={o => { if (!busyRef.current) props.onOpenChange(o) }}>
            {/* El formulario se monta al abrir: cada cobro arranca limpio sin efecto. */}
            {props.open && (
                <CheckoutForm
                    {...props}
                    onBusyChange={busy => { busyRef.current = busy; props.onBusyChange(busy) }}
                />
            )}
        </Dialog>
    )
}

function CheckoutForm({
    onOpenChange, cart, cartTotal, workshopActive, workshopCustomer, onWorkshopSaleChange,
    customer, onCustomerChange, branchId, cajaOpen, resumedDoc, onBusyChange, autoOpenTicket, onCompleted,
}: CheckoutDialogProps) {
    const [docType, setDocType] = useState<DocType>(workshopActive || workshopCustomer ? "WORKSHOP" : "VENTA")
    const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("EFECTIVO")
    const [cashGiven, setCashGiven] = useState("")
    const [transferRef, setTransferRef] = useState("")
    const [splitMode, setSplitMode] = useState(false)
    const [splitPayments, setSplitPayments] = useState<PaymentDraft[]>([{ method: "EFECTIVO", amount: "" }])
    const [withDeposit, setWithDeposit] = useState(false)
    const [deposit, setDeposit] = useState<PaymentDraft>({ method: "EFECTIVO", amount: "" })
    const [validityDays, setValidityDays] = useState("15")
    const [processing, setProcessing] = useState(false)
    const submitting = useRef(false)
    const pendingOperation = useRef<ClientOperationKey | null>(null)

    const setBusy = (busy: boolean) => {
        submitting.current = busy
        setProcessing(busy)
        onBusyChange(busy)
    }

    const changeDocType = (type: DocType) => {
        setDocType(type)
        // "A taller" enciende el modo mayoreo del ticket; volver a Venta lo apaga.
        if (type === "WORKSHOP") onWorkshopSaleChange(true)
        else if (!workshopCustomer) onWorkshopSaleChange(false)
    }

    const usesCredit = splitMode
        ? splitPayments.some(p => p.method === "CREDITO" && parseFloat(p.amount) > 0)
        : paymentMethod === "CREDITO"
    const creditPortion = splitMode
        ? splitPayments.filter(p => p.method === "CREDITO").reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
        : (paymentMethod === "CREDITO" ? cartTotal : 0)
    const creditAvailable = customer?.creditLimit != null
        ? Math.max(0, customer.creditLimit - customer.creditBalance)
        : null

    const isSale = docType === "VENTA" || docType === "WORKSHOP"
    const depositAmount = parseFloat(deposit.amount) || 0

    /** Pagos del modo venta → payments[] | paymentMethod (validaciones incluidas).
        Transferencia única va sin monto: el servidor cobra el total del ticket. */
    const buildSalePayments = (): { payments?: { method: string; amount?: number; reference?: string }[]; paymentMethod?: string } | null => {
        if (usesCredit) {
            if (!customer) {
                toast.error("Selecciona un cliente para venta a crédito")
                return null
            }
            if (customer.creditLimit == null) {
                toast.error("El cliente no tiene línea de crédito autorizada")
                return null
            }
            const available = creditAvailable ?? 0
            if (creditPortion > available) {
                toast.error(`Crédito insuficiente. Disponible: ${formatPrice(available)}, Cargo: ${formatPrice(creditPortion)}`)
                return null
            }
        }
        if (splitMode) {
            const drafts = splitPayments.filter(p => parseFloat(p.amount) > 0)
            const sum = drafts.reduce((s, p) => s + parseFloat(p.amount), 0)
            if (drafts.length === 0 || Math.abs(sum - cartTotal) > 0.009) {
                toast.error(`Los pagos deben sumar ${formatPrice(cartTotal)} (suman ${formatPrice(sum)})`)
                return null
            }
            if (drafts.some(p => p.method === "TRANSFERENCIA" && !p.reference?.trim())) {
                toast.error("Captura la referencia de cada transferencia")
                return null
            }
            return { payments: toPaymentsPayload(drafts) }
        }
        if (paymentMethod === "TRANSFERENCIA") {
            if (!transferRef.trim()) {
                toast.error("Captura la referencia de la transferencia")
                return null
            }
            return { payments: [{ method: "TRANSFERENCIA", reference: transferRef.trim() }] }
        }
        return { paymentMethod }
    }

    const submit = async () => {
        if (cart.length === 0 || submitting.current) return

        const items = cart.map(item => ({ productId: item.product.id, quantity: item.quantity }))
        let url = "/api/sales"
        let payload: Record<string, unknown>

        if (isSale) {
            const paymentPart = buildSalePayments()
            if (!paymentPart) return
            if (resumedDoc) {
                // Cobro de una suspendida: el documento cobra sus líneas snapshot;
                // items queda como referencia por si el servidor reconcilia ediciones.
                url = `/api/pos/documents/${resumedDoc.id}/checkout`
                payload = { items, branchId: branchId || undefined, customerId: customer?.id ?? undefined, ...paymentPart }
            } else {
                payload = {
                    items,
                    customerId: customer?.id ?? undefined,
                    branchId: branchId || undefined,
                    workshopSale: docType === "WORKSHOP" || undefined,
                    ...paymentPart,
                }
            }
        } else if (docType === "LAYAWAY") {
            if (!customer) {
                toast.error("El apartado necesita un cliente")
                return
            }
            if (withDeposit) {
                if (depositAmount <= 0) {
                    toast.error("Captura el monto del anticipo o marca «sin anticipo»")
                    return
                }
                if (depositAmount >= cartTotal) {
                    toast.error("Un apartado debe quedar con saldo — si lo cubre completo, cobra como venta")
                    return
                }
                if (deposit.method === "TRANSFERENCIA" && !deposit.reference?.trim()) {
                    toast.error("Captura la referencia de la transferencia del anticipo")
                    return
                }
            }
            url = "/api/pos/documents"
            payload = {
                kind: "LAYAWAY",
                items,
                customerId: customer.id,
                branchId: branchId || undefined,
                ...(withDeposit && depositAmount > 0 ? { payments: toPaymentsPayload([{ ...deposit, amount: depositAmount.toFixed(2) }]) } : {}),
            }
        } else {
            // Cotización: vigencia en días → expiresAt (el dominio topa en 90).
            const days = parseInt(validityDays, 10)
            if (!Number.isInteger(days) || days < 1 || days > 90) {
                toast.error("La vigencia debe ser de 1 a 90 días")
                return
            }
            url = "/api/pos/documents"
            payload = {
                kind: "QUOTE",
                items,
                customerId: customer?.id ?? undefined,
                branchId: branchId || undefined,
                expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
            }
        }

        pendingOperation.current = getClientOperationKey(pendingOperation.current, payload)
        // La pestaña del ticket se abre dentro del gesto del click: si esperamos
        // al await del cobro, el navegador la bloquea como popup. onCompleted la
        // navega al ticket (o la cierra si el cobro falla).
        const ticketPopup = autoOpenTicket && docType !== "QUOTE" ? window.open("", "_blank") : null
        setBusy(true)
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: pendingOperation.current.key }),
            })
            const data: SaleResponse | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar. El ticket se conserva.")
            pendingOperation.current = null

            const ticketId = data?.sale?.id ?? data?.document?.sale?.id ?? data?.id ?? null
            const number = data?.sale?.number ?? data?.document?.sale?.number ?? data?.number ?? null
            const resultKind: CheckoutResult["kind"] = docType === "LAYAWAY" ? "LAYAWAY"
                : docType === "QUOTE" ? "QUOTE"
                : (data?.sale?.kind === "WORKSHOP" || data?.document?.sale?.kind === "WORKSHOP" || docType === "WORKSHOP") ? "WORKSHOP" : "SALE"
            const paidWithCard =
                (Array.isArray(data?.payments) && data.payments.some(p => p.method === "CARD"))
                || (splitMode ? splitPayments.some(p => p.method === "TARJETA" && parseFloat(p.amount) > 0) : paymentMethod === "TARJETA")

            onCompleted({
                kind: resultKind,
                number,
                ticketId,
                total: data?.total ?? data?.document?.total ?? cartTotal,
                quantity: data?.quantity ?? data?.document?.quantity ?? cartUnitsOf(cart),
                description: cart.length === 1 ? cart[0].product.name : `${cart.length} productos`,
                paidWithCard,
            }, ticketPopup)
        } catch (error) {
            ticketPopup?.close()
            toast.error(error instanceof TypeError
                ? "No se pudo confirmar el resultado. Reintenta sin cambiar el ticket para evitar duplicados."
                : error instanceof Error ? error.message : "No se pudo registrar. El ticket se conserva.")
        } finally {
            setBusy(false)
        }
    }

    const confirmDisabled = processing
        || (isSale && !splitMode && paymentMethod === "EFECTIVO" && Boolean(cashGiven && parseFloat(cashGiven) < cartTotal))
        || (isSale && usesCredit && (!customer || customer.creditLimit == null || creditPortion > (creditAvailable ?? 0)))
        || (docType === "LAYAWAY" && !customer)

    const docTypes: DocType[] = workshopCustomer ? ["WORKSHOP"] : ["VENTA", "LAYAWAY", "QUOTE", "WORKSHOP"]

    return (
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        Finalizar
                        {resumedDoc && <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{resumedDoc.kind === "QUOTE" ? "Cotización" : "Suspendida"} #{resumedDoc.number}</Badge>}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="bg-primary/10 p-4 rounded-lg flex justify-between items-center">
                        <span className="font-medium text-lg">Total:</span>
                        <span className="text-2xl font-bold text-primary">{formatPrice(cartTotal)}</span>
                    </div>

                    {cajaOpen === false && isSale && (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            La caja está cerrada en esta sucursal; el cobro puede quedar sin registrar en caja.
                        </p>
                    )}

                    {/* Tipo de documento. Una suspendida solo puede cobrarse como venta. */}
                    {!resumedDoc && (
                        <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1">
                            {docTypes.map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    disabled={processing}
                                    onClick={() => changeDocType(type)}
                                    className={cn(
                                        "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                                        docType === type ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {DOC_TYPE_LABELS[type]}
                                </button>
                            ))}
                        </div>
                    )}
                    {workshopCustomer && <Badge variant="secondary">Taller — mayoreo automático</Badge>}

                    {/* Cliente: obligatorio en apartado/crédito, opcional en lo demás. */}
                    {(docType === "LAYAWAY" || docType === "QUOTE" || usesCredit || customer) && (
                        <div className="space-y-1.5">
                            <Label>
                                Cliente{docType === "LAYAWAY" ? " *" : ""}
                                {usesCredit && !customer ? " *" : ""}
                            </Label>
                            <CustomerPicker
                                value={customer}
                                onChange={onCustomerChange}
                                disabled={processing}
                                requiresCredit={usesCredit}
                            />
                        </div>
                    )}

                    {isSale && !splitMode && (
                        <div className="space-y-2">
                            <Label>Método de pago</Label>
                            <div className="flex gap-2">
                                <div className="flex-1">
                                    <MethodSelect value={paymentMethod} onChange={setPaymentMethod} disabled={processing} methods={PAYMENT_METHODS} />
                                </div>
                                <Button type="button" variant="outline" disabled={processing} onClick={() => {
                                    setSplitMode(true)
                                    setSplitPayments([{ method: paymentMethod === "CREDITO" ? "EFECTIVO" : paymentMethod, amount: cartTotal.toString() }])
                                }}>
                                    Dividir
                                </Button>
                            </div>
                            {paymentMethod === "TRANSFERENCIA" && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="pos-transfer-ref">Referencia de la transferencia *</Label>
                                    <Input
                                        id="pos-transfer-ref"
                                        placeholder="Folio SPEI / clave de rastreo"
                                        maxLength={200}
                                        disabled={processing}
                                        value={transferRef}
                                        onChange={e => setTransferRef(e.target.value)}
                                    />
                                </div>
                            )}
                            {paymentMethod === "EFECTIVO" && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="pos-cash-given">Efectivo recibido</Label>
                                    <Input
                                        id="pos-cash-given"
                                        type="number"
                                        min="0"
                                        placeholder="Ej: 500"
                                        disabled={processing}
                                        value={cashGiven}
                                        onChange={e => setCashGiven(e.target.value)}
                                    />
                                    {cashGiven && parseFloat(cashGiven) >= cartTotal && (
                                        <p className="text-green-600 font-medium text-sm">
                                            Cambio: {formatPrice(parseFloat(cashGiven) - cartTotal)}
                                        </p>
                                    )}
                                    {cashGiven && parseFloat(cashGiven) < cartTotal && (
                                        <p className="text-destructive font-medium text-sm">
                                            Faltan: {formatPrice(cartTotal - parseFloat(cashGiven))}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {isSale && splitMode && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Pago dividido</Label>
                                <Button type="button" variant="ghost" size="sm" disabled={processing} onClick={() => setSplitMode(false)}>
                                    Pago único
                                </Button>
                            </div>
                            {splitPayments.map((p, i) => (
                                <div key={i} className="space-y-1.5">
                                    <div className="flex gap-2 items-center">
                                        <div className="flex-1">
                                            <MethodSelect
                                                value={p.method}
                                                onChange={m => setSplitPayments(prev => prev.map((x, j) => j === i ? { ...x, method: m } : x))}
                                                disabled={processing}
                                                methods={PAYMENT_METHODS}
                                            />
                                        </div>
                                        <Input
                                            type="number" min="0" placeholder="0.00"
                                            aria-label={`Monto pago ${i + 1}`}
                                            disabled={processing}
                                            value={p.amount}
                                            onChange={e => setSplitPayments(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                                            className="w-28"
                                        />
                                        {splitPayments.length > 1 && (
                                            <Button type="button" variant="ghost" size="icon" disabled={processing} aria-label="Quitar método"
                                                onClick={() => setSplitPayments(prev => prev.filter((_, j) => j !== i))}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                    {p.method === "TRANSFERENCIA" && (
                                        <Input
                                            placeholder="Referencia SPEI / folio *"
                                            aria-label={`Referencia transferencia ${i + 1}`}
                                            maxLength={200}
                                            disabled={processing}
                                            value={p.reference ?? ""}
                                            onChange={e => setSplitPayments(prev => prev.map((x, j) => j === i ? { ...x, reference: e.target.value } : x))}
                                        />
                                    )}
                                </div>
                            ))}
                            {splitPayments.length < 4 && (
                                <Button type="button" variant="outline" size="sm" disabled={processing} onClick={() => {
                                    const used = new Set(splitPayments.map(p => p.method))
                                    const next = PAYMENT_METHODS.find(m => !used.has(m.value))?.value ?? "EFECTIVO"
                                    const remaining = cartTotal - splitPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
                                    setSplitPayments(prev => [...prev, { method: next, amount: remaining > 0 ? remaining.toFixed(2) : "" }])
                                }}>
                                    <Plus className="h-4 w-4 mr-1" /> Agregar método
                                </Button>
                            )}
                            {(() => {
                                const sum = splitPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
                                const diff = cartTotal - sum
                                return Math.abs(diff) > 0.009 ? (
                                    <p className={cn("text-sm font-medium", diff > 0 ? "text-destructive" : "text-amber-600")}>
                                        {diff > 0 ? `Faltan ${formatPrice(diff)}` : `Sobran ${formatPrice(-diff)}`}
                                    </p>
                                ) : (
                                    <p className="text-sm font-medium text-green-600">Los pagos cubren el total</p>
                                )
                            })()}
                        </div>
                    )}

                    {docType === "LAYAWAY" && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="pos-deposit"
                                    checked={withDeposit}
                                    disabled={processing}
                                    onCheckedChange={checked => setWithDeposit(checked === true)}
                                />
                                <Label htmlFor="pos-deposit" className="cursor-pointer font-normal">
                                    Con anticipo <span className="text-xs text-muted-foreground">(sin anticipo también es válido)</span>
                                </Label>
                            </div>
                            {withDeposit && (
                                <div className="space-y-2 rounded-lg border p-3">
                                    <div className="flex gap-2 items-center">
                                        <div className="flex-1">
                                            <MethodSelect
                                                value={deposit.method}
                                                onChange={m => setDeposit(prev => ({ ...prev, method: m }))}
                                                disabled={processing}
                                                methods={DEPOSIT_METHODS}
                                            />
                                        </div>
                                        <Input
                                            type="number" min="0" max={cartTotal} placeholder="0.00"
                                            aria-label="Monto del anticipo"
                                            disabled={processing}
                                            value={deposit.amount}
                                            onChange={e => setDeposit(prev => ({ ...prev, amount: e.target.value }))}
                                            className="w-28"
                                        />
                                    </div>
                                    {deposit.method === "TRANSFERENCIA" && (
                                        <Input
                                            placeholder="Referencia SPEI / folio del anticipo *"
                                            maxLength={200}
                                            disabled={processing}
                                            value={deposit.reference ?? ""}
                                            onChange={e => setDeposit(prev => ({ ...prev, reference: e.target.value }))}
                                        />
                                    )}
                                    {depositAmount > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            Resta por liquidar: {formatPrice(Math.max(0, cartTotal - depositAmount))}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {docType === "QUOTE" && (
                        <div className="space-y-1.5">
                            <Label htmlFor="pos-quote-days">Vigencia (días, máx. 90)</Label>
                            <Input
                                id="pos-quote-days"
                                type="number" min="1" max="90"
                                disabled={processing}
                                value={validityDays}
                                onChange={e => setValidityDays(e.target.value)}
                                className="w-28"
                            />
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={processing}>Cancelar</Button>
                    <Button onClick={() => { void submit() }} disabled={confirmDisabled}>
                        {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {docType === "LAYAWAY" ? "Crear apartado" : docType === "QUOTE" ? "Crear cotización" : "Confirmar venta"}
                    </Button>
                </DialogFooter>
            </DialogContent>
    )
}
