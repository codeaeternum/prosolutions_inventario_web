"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BookMarked, FileText, History, Loader2, Minus, Package, Pause, Plus, ReceiptText, Trash2, X } from "lucide-react"
import { formatPrice } from "@/lib/utils"
import { CustomerPicker } from "./customer-picker"
import { cartTotalOf, cartUnitsOf, unitPriceOf, type CartItem, type PosCustomer } from "./types"

interface CartPanelProps {
    cart: CartItem[]
    workshopActive: boolean
    customer: PosCustomer | null
    onCustomerChange: (customer: PosCustomer | null) => void
    /** Documento suspendido que se está cobrando (badge "Suspendida #N" o "Cotización #N"). */
    resumedDoc: { id: string; number: number; kind?: string } | null
    onDetachResumed: () => void
    processing: boolean
    cajaOpen: boolean | null
    onUpdateQuantity: (productId: string, delta: number) => void
    onRemove: (productId: string) => void
    onClear: () => void
    onCheckout: () => void
    onSuspend: () => void
    onOpenParked: () => void
    onOpenLayaways: () => void
    onOpenQuotes: () => void
    /** "plain" para renderizar dentro del Sheet móvil (sin Card propia). */
    variant?: "card" | "plain"
}

function CartLine({ item, workshopActive, processing, onUpdateQuantity, onRemove }: {
    item: CartItem
    workshopActive: boolean
    processing: boolean
    onUpdateQuantity: (productId: string, delta: number) => void
    onRemove: (productId: string) => void
}) {
    const price = unitPriceOf(item.product, workshopActive)
    return (
        <div
            tabIndex={0}
            role="group"
            aria-label={`${item.product.name}, ${item.quantity} unidades. Más/menos ajusta, Supr quita.`}
            className="flex items-center gap-2 rounded-lg border px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60"
            onKeyDown={e => {
                if (e.key === "+") { e.preventDefault(); onUpdateQuantity(item.product.id, 1) }
                else if (e.key === "-") { e.preventDefault(); onUpdateQuantity(item.product.id, -1) }
                else if (e.key === "Delete") { e.preventDefault(); onRemove(item.product.id) }
            }}
        >
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.product.name}</p>
                <p className="text-[11px] text-muted-foreground">
                    {formatPrice(price)} c/u{workshopActive ? " · mayoreo" : ""}
                </p>
            </div>
            <div className="flex items-center gap-1">
                <Button
                    variant="outline" size="icon-xs"
                    onClick={() => onUpdateQuantity(item.product.id, -1)}
                    disabled={processing || item.quantity <= 1}
                    aria-label={`Reducir cantidad de ${item.product.name}`}
                >
                    <Minus className="h-3 w-3" />
                </Button>
                <span className="w-7 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                <Button
                    variant="outline" size="icon-xs"
                    onClick={() => onUpdateQuantity(item.product.id, 1)}
                    disabled={processing || item.quantity >= item.product.stock}
                    aria-label={`Aumentar cantidad de ${item.product.name}`}
                >
                    <Plus className="h-3 w-3" />
                </Button>
            </div>
            <p className="w-20 text-right text-sm font-bold tabular-nums">{formatPrice(price * item.quantity)}</p>
            <Button
                variant="ghost" size="icon-xs"
                className="text-destructive hover:text-destructive"
                onClick={() => onRemove(item.product.id)}
                disabled={processing}
                aria-label={`Quitar ${item.product.name} de la venta`}
            >
                <X className="h-4 w-4" />
            </Button>
        </div>
    )
}

/** Panel del ticket: líneas del carrito, cliente, totales y acciones del turno. */
export function CartPanel(props: CartPanelProps) {
    const {
        cart, workshopActive, customer, onCustomerChange, resumedDoc, onDetachResumed,
        processing, cajaOpen, onUpdateQuantity, onRemove, onClear,
        onCheckout, onSuspend, onOpenParked, onOpenLayaways, onOpenQuotes, variant = "card",
    } = props

    const total = cartTotalOf(cart, workshopActive)
    const units = cartUnitsOf(cart)

    const body = (
        <div className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold">
                    <ReceiptText className="h-4 w-4" />
                    Ticket
                    {units > 0 && <Badge>{units}</Badge>}
                    {workshopActive && <Badge variant="secondary">Mayoreo</Badge>}
                </span>
                {resumedDoc && (
                    <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {resumedDoc.kind === "QUOTE" ? "Cotización" : "Suspendida"} #{resumedDoc.number}
                        <button type="button" onClick={onDetachResumed} aria-label="Desvincular venta suspendida" className="hover:text-foreground">
                            <X className="h-3 w-3" />
                        </button>
                    </Badge>
                )}
            </div>

            <CustomerPicker value={customer} onChange={onCustomerChange} disabled={processing} />

            {cajaOpen === false && (
                <Link
                    href="/admin/caja"
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                >
                    La caja está cerrada en esta sucursal — ábrela antes de cobrar.
                </Link>
            )}

            {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
                    <Package className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm">Ticket vacío — toca un producto o escanea un código</p>
                </div>
            ) : (
                <div className="flex flex-col gap-1.5 overflow-y-auto min-h-0 max-h-[46dvh] lg:max-h-none lg:flex-1">
                    {cart.map(item => (
                        <CartLine
                            key={item.product.id}
                            item={item}
                            workshopActive={workshopActive}
                            processing={processing}
                            onUpdateQuantity={onUpdateQuantity}
                            onRemove={onRemove}
                        />
                    ))}
                </div>
            )}

            <div className="mt-auto space-y-2 border-t pt-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="text-2xl font-bold text-primary tabular-nums">{formatPrice(total)}</span>
                </div>
                <Button
                    className="w-full h-12 text-base"
                    size="lg"
                    onClick={onCheckout}
                    disabled={processing || cart.length === 0}
                >
                    {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                    Cobrar <span className="text-xs opacity-70">(F2)</span>
                </Button>
                <div className="grid grid-cols-2 gap-1.5">
                    <Button type="button" variant="outline" size="sm" onClick={onSuspend} disabled={processing || cart.length === 0}>
                        <Pause className="h-3.5 w-3.5" />
                        Suspender
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenParked} disabled={processing}>
                        <History className="h-3.5 w-3.5" />
                        Recuperar
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenLayaways} disabled={processing}>
                        <BookMarked className="h-3.5 w-3.5" />
                        Apartados
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onOpenQuotes} disabled={processing}>
                        <FileText className="h-3.5 w-3.5" />
                        Cotizas
                    </Button>
                </div>
                {cart.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onClear} disabled={processing}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Vaciar ticket
                    </Button>
                )}
            </div>
        </div>
    )

    if (variant === "plain") return body

    return (
        <Card className="flex flex-col lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]">
            <CardHeader className="pb-2">
                <CardTitle className="sr-only">Ticket de venta</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-4 pt-0 flex flex-col">{body}</CardContent>
        </Card>
    )
}
