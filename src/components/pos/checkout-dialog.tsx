"use client"

import { useRef, useState } from "react"
import { useSession } from "next-auth/react"
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
    payableCents?: number
    payments?: { method?: string }[]
    error?: string
}

// Motivos frecuentes de descuento: el chip prellena el campo (sigue editable)
// y deja razones consistentes para analizarlas después en reportes/actividad.
const DISCOUNT_REASON_PRESETS = [
    "Cliente frecuente",
    "Promoción",
    "Taller",
    "Error de precio",
    "Daño cosmético",
    "Cortesía",
] as const

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
    // Descuento autorizado al cobrar: monto en pesos + motivo obligatorio.
    const [withDiscount, setWithDiscount] = useState(false)
    const [discountAmount, setDiscountAmount] = useState("")
    const [discountReason, setDiscountReason] = useState("")
    const [processing, setProcessing] = useState(false)
    const submitting = useRef(false)
    const pendingOperation = useRef<ClientOperationKey | null>(null)
    // Llave del paso "suspender" cuando una venta nueva con descuento primero
    // fotografía sus líneas como documento y luego lo cobra (mismo endpoint
    // de checkout que una suspendida recuperada).
    const pendingPark = useRef<ClientOperationKey | null>(null)
    const { data: session } = useSession()
    const isEmployee = session?.user?.role === "EMPLOYEE"
    // La lista de taller la cobra un cliente taller/negocio (automático) o la
    // autoriza un ADMIN — el servidor rechaza "A taller" de staff a walk-ins.
    const isAdmin = session?.user?.role === "ADMIN"
    const workshopAllowed = workshopCustomer || isAdmin

    const setBusy = (busy: boolean) => {
        submitting.current = busy
        setProcessing(busy)
        onBusyChange(busy)
    }

    const changeDocType = (type: DocType) => {
        setDocType(type)
        // "A taller" enciende el modo taller del ticket; volver a Venta lo apaga.
        if (type === "WORKSHOP") onWorkshopSaleChange(true)
        else if (!workshopCustomer) onWorkshopSaleChange(false)
    }

    const isSale = docType === "VENTA" || docType === "WORKSHOP"
    const depositAmount = parseFloat(deposit.amount) || 0

    // Lo que realmente se cobra: catálogo menos el descuento capturado. El
    // servidor valida contra su propio snapshot — aquí solo se refleja.
    const cartTotalCents = Math.round(cartTotal * 100)
    const discountCents = withDiscount ? Math.round((parseFloat(discountAmount) || 0) * 100) : 0
    const payable = Math.max(0, (cartTotalCents - discountCents) / 100)
    const employeeCapCents = Math.floor(cartTotalCents / 10)

    const usesCredit = splitMode
        ? splitPayments.some(p => p.method === "CREDITO" && parseFloat(p.amount) > 0)
        : paymentMethod === "CREDITO"
    const creditPortion = splitMode
        ? splitPayments.filter(p => p.method === "CREDITO").reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
        : (paymentMethod === "CREDITO" ? payable : 0)
    const creditAvailable = customer?.creditLimit != null
        ? Math.max(0, customer.creditLimit - customer.creditBalance)
        : null

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
            if (drafts.length === 0 || Math.abs(sum - payable) > 0.009) {
                toast.error(`Los pagos deben sumar ${formatPrice(payable)} (suman ${formatPrice(sum)})`)
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
        // Venta nueva con descuento: suspende y cobra por /checkout en dos pasos.
        let parkThenCheckout = false

        if (isSale) {
            const paymentPart = buildSalePayments()
            if (!paymentPart) return
            // Descuento autorizado al cobrar: motivo obligatorio, nunca cubre
            // el total (eso sería cortesía, otro flujo) y el empleado topa en
            // 10% — el servidor repite estas mismas reglas.
            if (discountCents > 0) {
                if (discountCents >= cartTotalCents) {
                    toast.error("El descuento no puede cubrir el total de la venta")
                    return
                }
                if (discountReason.trim().length < 3) {
                    toast.error("Captura el motivo del descuento")
                    return
                }
                if (isEmployee && discountCents > employeeCapCents) {
                    toast.error(`Los empleados pueden descontar hasta 10% (${formatPrice(employeeCapCents / 100)}); pide autorización al administrador`)
                    return
                }
            }
            const discountPart = discountCents > 0 ? { discountCents, discountReason: discountReason.trim() } : {}
            if (resumedDoc) {
                // Cobro de una suspendida: el documento cobra sus líneas snapshot;
                // items queda como referencia por si el servidor reconcilia ediciones.
                url = `/api/pos/documents/${resumedDoc.id}/checkout`
                payload = { items, branchId: branchId || undefined, customerId: customer?.id ?? undefined, ...paymentPart, ...discountPart }
            } else if (discountCents > 0) {
                // Venta nueva con descuento: solo el checkout de documentos lo
                // admite, así que el ticket se suspende (snapshot de precios)
                // y se cobra en seguida — misma caja, mismo rastro.
                parkThenCheckout = true
                payload = { items, branchId: branchId || undefined, customerId: customer?.id ?? undefined, ...paymentPart, ...discountPart }
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

        // La pestaña del ticket se abre dentro del gesto del click: si esperamos
        // al await del cobro, el navegador la bloquea como popup. onCompleted la
        // navega al ticket (o la cierra si el cobro falla).
        const ticketPopup = autoOpenTicket && docType !== "QUOTE" ? window.open("", "_blank") : null
        // Documento a cobrar por /checkout: el retomado o el que el paso 1
        // suspende para una venta nueva con descuento.
        let checkoutDocId = resumedDoc?.id ?? null
        setBusy(true)
        try {
            if (parkThenCheckout) {
                // Paso 1 de 2 — venta nueva con descuento: suspender fotografía
                // los precios; el checkout del paso 2 cobra con el descuento.
                const parkPayload = {
                    kind: docType === "WORKSHOP" ? "WORKSHOP" : "RETAIL",
                    items,
                    customerId: customer?.id ?? undefined,
                    branchId: branchId || undefined,
                }
                pendingPark.current = getClientOperationKey(pendingPark.current, parkPayload)
                const parkRes = await fetch("/api/pos/documents", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...parkPayload, idempotencyKey: pendingPark.current.key }),
                })
                const parkData: SaleResponse | null = await parkRes.json().catch(() => null)
                if (!parkRes.ok) throw new Error(parkData?.error || "No se pudo preparar la venta con descuento")
                checkoutDocId = parkData?.document?.sale?.id ?? null
                if (!checkoutDocId) throw new Error("No se pudo preparar la venta con descuento")
                url = `/api/pos/documents/${checkoutDocId}/checkout`
            }
            // La llave del cobro va ligada al folio del documento cuando hay
            // uno: el mismo payload sobre otro documento es otra operación.
            pendingOperation.current = getClientOperationKey(pendingOperation.current,
                checkoutDocId ? { ...payload, saleId: checkoutDocId } : payload)
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: pendingOperation.current.key }),
            })
            const data: SaleResponse | null = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar. El ticket se conserva.")
            // Recién aquí se sueltan las llaves: si el cobro falló tras
            // suspender, el reintento reusa el MISMO documento (no duplica).
            pendingOperation.current = null
            pendingPark.current = null

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
                // Cobro real con descuento cuando el recibo lo trae; si no,
                // el total de catálogo del documento o del ticket.
                total: data?.payableCents != null ? data.payableCents / 100 : (data?.total ?? data?.document?.total ?? cartTotal),
                quantity: data?.quantity ?? data?.document?.quantity ?? cartUnitsOf(cart),
                description: cart.length === 1 ? cart[0].product.name : `${cart.length} productos`,
                paidWithCard,
            }, ticketPopup)
        } catch (error) {
            ticketPopup?.close()
            // Si el paso 1 ya suspendió el ticket y el cobro falló, el
            // documento queda recuperable en «Suspendidas» — no se pierde.
            const suspendedHint = parkThenCheckout && checkoutDocId
                ? " El ticket quedó suspendido; recupéralo o descártalo desde «Recuperar»."
                : ""
            toast.error((error instanceof TypeError
                ? "No se pudo confirmar el resultado. Reintenta sin cambiar el ticket para evitar duplicados."
                : error instanceof Error ? error.message : "No se pudo registrar. El ticket se conserva.") + suspendedHint)
        } finally {
            setBusy(false)
        }
    }

    const confirmDisabled = processing
        || (isSale && !splitMode && paymentMethod === "EFECTIVO" && Boolean(cashGiven && parseFloat(cashGiven) < payable))
        || (isSale && usesCredit && (!customer || customer.creditLimit == null || creditPortion > (creditAvailable ?? 0)))
        || (isSale && discountCents > 0 && (discountCents >= cartTotalCents || discountReason.trim().length < 3))
        || (docType === "LAYAWAY" && !customer)

    const docTypes: DocType[] = workshopCustomer ? ["WORKSHOP"] : workshopAllowed ? ["VENTA", "LAYAWAY", "QUOTE", "WORKSHOP"] : ["VENTA", "LAYAWAY", "QUOTE"]

    return (
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        Finalizar
                        {resumedDoc && <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{resumedDoc.kind === "QUOTE" ? "Cotización" : "Suspendida"} #{resumedDoc.number}</Badge>}
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="bg-primary/10 p-4 rounded-lg space-y-1">
                        <div className="flex justify-between items-center">
                            <span className="font-medium text-lg">{discountCents > 0 ? "Total a cobrar:" : "Total:"}</span>
                            <span className="text-2xl font-bold text-primary">{formatPrice(payable)}</span>
                        </div>
                        {discountCents > 0 && (
                            <p className="text-xs text-muted-foreground text-right">
                                Subtotal {formatPrice(cartTotal)} · Descuento −{formatPrice(discountCents / 100)}
                            </p>
                        )}
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
                    {workshopCustomer && <Badge variant="secondary">Precio de taller automático</Badge>}

                    {/* Cliente: obligatorio en apartado/crédito, opcional en lo demás. */}
                    {(docType === "LAYAWAY" || docType === "QUOTE" || usesCredit || customer) && (
                        <div className="space-y-1.5">
                            <Label>
                                Cliente{docType === "LAYAWAY" ? " *" : ""}
                                {usesCredit && !customer ? " *" : ""}
                            </Label>
                            <CustomerPicker
                                value={customer}
                                onChange={(c) => {
                                    onCustomerChange(c)
                                    // Si el nuevo cliente no es taller y el cajero no es admin,
                                    // "A taller" deja de ser opción: vuelve a venta normal.
                                    const qualified = c?.customerType === "STORE" || c?.customerType === "TECHNICIAN"
                                    if (docType === "WORKSHOP" && !qualified && !isAdmin) changeDocType("VENTA")
                                }}
                                disabled={processing}
                                requiresCredit={usesCredit}
                            />
                        </div>
                    )}

                    {/* Descuento autorizado al cobrar (solo ventas): el motivo
                        queda en la venta y los pagos cuadran contra total − dto. */}
                    {isSale && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id="pos-discount"
                                    checked={withDiscount}
                                    disabled={processing}
                                    onCheckedChange={checked => setWithDiscount(checked === true)}
                                />
                                <Label htmlFor="pos-discount" className="cursor-pointer font-normal">
                                    Descuento <span className="text-xs text-muted-foreground">(autorizado al cobrar{isEmployee ? ` · máx. 10% = ${formatPrice(employeeCapCents / 100)}` : ""})</span>
                                </Label>
                            </div>
                            {withDiscount && (
                                <div className="space-y-2 rounded-lg border p-3">
                                    <div className="flex gap-2 items-center">
                                        <Input
                                            type="number" min="0" step="0.01" placeholder="0.00"
                                            aria-label="Monto del descuento"
                                            disabled={processing}
                                            value={discountAmount}
                                            onChange={e => setDiscountAmount(e.target.value)}
                                            className="w-28"
                                        />
                                        <span className="text-xs text-muted-foreground">de descuento</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {DISCOUNT_REASON_PRESETS.map(reason => (
                                            <button
                                                key={reason}
                                                type="button"
                                                disabled={processing}
                                                onClick={() => setDiscountReason(reason)}
                                                className={cn(
                                                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                                                    discountReason === reason
                                                        ? "bg-primary text-primary-foreground border-primary"
                                                        : "bg-background text-muted-foreground hover:bg-muted"
                                                )}
                                            >
                                                {reason}
                                            </button>
                                        ))}
                                    </div>
                                    <Input
                                        placeholder="Motivo del descuento *"
                                        aria-label="Motivo del descuento"
                                        maxLength={200}
                                        disabled={processing}
                                        value={discountReason}
                                        onChange={e => setDiscountReason(e.target.value)}
                                    />
                                    {discountCents > 0 && (
                                        <p className={cn("text-xs", discountCents >= cartTotalCents ? "text-destructive font-medium" : "text-muted-foreground")}>
                                            {discountCents >= cartTotalCents
                                                ? "El descuento no puede cubrir el total"
                                                : `Cobrarás ${formatPrice(payable)} de ${formatPrice(cartTotal)}`}
                                        </p>
                                    )}
                                </div>
                            )}
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
                                    setSplitPayments([{ method: paymentMethod === "CREDITO" ? "EFECTIVO" : paymentMethod, amount: payable.toFixed(2) }])
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
                                    {cashGiven && parseFloat(cashGiven) >= payable && (
                                        <p className="text-green-600 font-medium text-sm">
                                            Cambio: {formatPrice(parseFloat(cashGiven) - payable)}
                                        </p>
                                    )}
                                    {cashGiven && parseFloat(cashGiven) < payable && (
                                        <p className="text-destructive font-medium text-sm">
                                            Faltan: {formatPrice(payable - parseFloat(cashGiven))}
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
                                    const remaining = payable - splitPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
                                    setSplitPayments(prev => [...prev, { method: next, amount: remaining > 0 ? remaining.toFixed(2) : "" }])
                                }}>
                                    <Plus className="h-4 w-4 mr-1" /> Agregar método
                                </Button>
                            )}
                            {(() => {
                                const sum = splitPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
                                const diff = payable - sum
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
