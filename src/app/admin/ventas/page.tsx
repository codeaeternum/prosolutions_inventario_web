"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/admin/empty-state"
import {
    ShoppingCart,
    Search,
    ScanBarcode,
    Loader2,
    Plus,
    Minus,
    CheckCircle,
    Package,
    DollarSign,
    X,
} from "lucide-react"
import { BarcodeScanner } from "@/components/barcode-scanner"
import { ExportButton } from "@/components/admin/export-button"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"

import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"

interface CreditCustomer { id: string; name: string; customerType?: string; creditLimit: number | null; creditBalance: number }

interface Product {
    id: string
    name: string
    barcode: string | null
    stock: number
    retailPrice: number
    wholesalePrice: number
    images: string[]
}

interface SaleItem {
    product: Product
    quantity: number
}

export default function VentasPage() {
    const [showScanner, setShowScanner] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [products, setProducts] = useState<Product[]>([])
    const [searching, setSearching] = useState(false)
    const [cart, setCart] = useState<SaleItem[]>([])
    const [processing, setProcessing] = useState(false)
    const submitting = useRef(false)
    const pendingOperation = useRef<ClientOperationKey | null>(null)
    const [lastSale, setLastSale] = useState<{ product: string; quantity: number; total: number; ticketUrl?: string; kind?: string } | null>(null)
    // "Venta a taller": nota de venta a mayoreo. El servidor decide el kind
    // final; un cliente STORE/TECHNICIAN la fuerza aunque el toggle esté apagado.
    const [workshopSale, setWorkshopSale] = useState(false)

    // Checkout modal state
    const [showCheckout, setShowCheckout] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState("EFECTIVO")
    const [cashGiven, setCashGiven] = useState("")
    const [transferRef, setTransferRef] = useState("") // folio SPEI/autorización de la transferencia
    const [splitMode, setSplitMode] = useState(false)
    const [splitPayments, setSplitPayments] = useState<{ method: string; amount: string; reference?: string }[]>([
        { method: "EFECTIVO", amount: "" },
    ])

    // Credit payment state
    const [creditSearch, setCreditSearch] = useState("")
    const [creditResults, setCreditResults] = useState<CreditCustomer[]>([])
    const [creditSearching, setCreditSearching] = useState(false)
    const [creditCustomer, setCreditCustomer] = useState<CreditCustomer | null>(null)

    // Cash register state
    const [cajaOpen, setCajaOpen] = useState<boolean | null>(null)

    // Sucursal activa del mostrador (stock, caja y venta se ligan a ella)
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
    const [branchId, setBranchId] = useState("")

    useEffect(() => {
        fetch('/api/branches').then(r => r.ok ? r.json() : null).then(d => {
            const list = (d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive)
            setBranches(list)
            if (list.length) setBranchId(prev => prev ?? list[0].id)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (!branchId) return
        fetch(`/api/caja?branchId=${branchId}`).then(r => r.json()).then(d => setCajaOpen(!!d.active)).catch(() => {})
    }, [branchId])

    const handleScan = async (code: string) => {
        const cleanCode = code.trim()
        if (!cleanCode) return

        setShowScanner(false)
        setSearching(true)
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(cleanCode)}${branchId ? `&branchId=${branchId}` : ""}`)
            if (!res.ok) throw new Error("No se pudo consultar el producto")
            const data = await res.json()
            const matches = (data.products as Product[] | undefined)?.filter((product) => product.barcode?.trim() === cleanCode || product.id === cleanCode) ?? []
            if (matches.length === 1) addToCart(matches[0])
            else toast.error(matches.length > 1 ? "El código coincide con más de un producto. Selecciónalo en la búsqueda." : "No se encontró una coincidencia exacta. Busca y selecciona el producto manualmente.")
        } catch {
            toast.error("Error al buscar producto")
        } finally {
            setSearching(false)
        }
    }

    const searchProducts = useCallback(async (query: string) => {
        const cleanQuery = query.trim()
        if (cleanQuery.length < 2) {
            setProducts([])
            return
        }
        setSearching(true)
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(cleanQuery)}${branchId ? `&branchId=${branchId}` : ""}`)
            const data = await res.json()
            setProducts(data.products || [])
        } catch (error) {
            console.error("Error searching products:", error)
        } finally {
            setSearching(false)
        }
    }, [branchId])

    // Debounce search
    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            if (searchQuery) {
                searchProducts(searchQuery)
            } else {
                setProducts([])
            }
        }, 300)

        return () => clearTimeout(delayDebounceFn)
    }, [searchQuery, searchProducts])

    const addToCart = (product: Product) => {
        if (submitting.current) return
        const existing = cart.find((item) => item.product.id === product.id)
        if (product.stock < 1 || (existing?.quantity ?? 0) >= product.stock) {
            toast.error("No hay más existencias disponibles de este producto")
            return
        }
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id)
            if (existing) {
                return prev.map(item =>
                    item.product.id === product.id
                        ? { ...item, quantity: Math.min(item.product.stock, item.quantity + 1) }
                        : item
                )
            }
            return [...prev, { product, quantity: 1 }]
        })
        setSearchQuery("")
        setProducts([])
        toast.success(`${product.name} agregado`)
    }

    const updateQuantity = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.product.id === productId) {
                const newQty = Math.max(1, Math.min(item.product.stock, item.quantity + delta))
                return { ...item, quantity: newQty }
            }
            return item
        }))
    }

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId))
    }

    const searchCreditCustomers = async (query: string) => {
        if (query.length < 2) { setCreditResults([]); return }
        setCreditSearching(true)
        try {
            const res = await fetch(`/api/users/pos?search=${encodeURIComponent(query)}&limit=8`)
            const data = await res.json()
            if (!res.ok) throw new Error("No se pudieron consultar los clientes")
            setCreditResults((data.users ?? []).filter((u: CreditCustomer) => u.creditLimit != null))
        } catch { setCreditResults([]) }
        finally { setCreditSearching(false) }
    }

    const processSale = async () => {
        if (cart.length === 0 || submitting.current) return

        const usesCredit = splitMode
            ? splitPayments.some(p => p.method === "CREDITO" && parseFloat(p.amount) > 0)
            : paymentMethod === "CREDITO"
        const creditPortion = splitMode
            ? splitPayments.filter(p => p.method === "CREDITO").reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
            : (paymentMethod === "CREDITO" ? cartTotal : 0)

        // Validar crédito si aplica
        if (usesCredit) {
            if (!creditCustomer) {
                toast.error("Selecciona un cliente para venta a crédito")
                return
            }
            const available = (creditCustomer.creditLimit ?? 0) - (creditCustomer.creditBalance ?? 0)
            if (creditPortion > available) {
                toast.error(`Crédito insuficiente. Disponible: $${available.toLocaleString()}, Cargo: $${creditPortion.toLocaleString()}`)
                return
            }
        }

        const payload: Record<string, unknown> = {
            items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
            customerId: usesCredit ? creditCustomer?.id : undefined,
            branchId: branchId || undefined,
            workshopSale: workshopActive || undefined,
        }
        if (splitMode) {
            const payments = splitPayments
                .filter(p => p.method && parseFloat(p.amount) > 0)
            const sum = payments.reduce((s, p) => s + parseFloat(p.amount), 0)
            if (payments.length === 0 || Math.abs(sum - cartTotal) > 0.009) {
                toast.error(`Los pagos deben sumar ${formatPrice(cartTotal)} (suman ${formatPrice(sum)})`)
                return
            }
            if (payments.some(p => p.method === "TRANSFERENCIA" && !p.reference?.trim())) {
                toast.error("Captura la referencia de cada transferencia")
                return
            }
            payload.payments = payments.map(p => ({
                method: p.method, amount: parseFloat(p.amount),
                ...(p.method === "TRANSFERENCIA" ? { reference: p.reference!.trim() } : {}),
            }))
        } else if (paymentMethod === "TRANSFERENCIA") {
            if (!transferRef.trim()) {
                toast.error("Captura la referencia de la transferencia")
                return
            }
            payload.payments = [{ method: "TRANSFERENCIA", reference: transferRef.trim() }]
        } else {
            payload.paymentMethod = paymentMethod
        }
        pendingOperation.current = getClientOperationKey(pendingOperation.current, payload)
        submitting.current = true
        setProcessing(true)
        try {
            const res = await fetch("/api/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: pendingOperation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar la venta. El carrito se conserva.")
            pendingOperation.current = null
            const ticketUrl = data.sale?.id ? `/admin/tickets/venta/${data.sale.id}` : undefined
            setLastSale({
                product: cart.length === 1 ? cart[0].product.name : `${cart.length} productos`,
                quantity: data.quantity,
                total: data.total,
                ticketUrl,
                kind: data.sale?.kind ?? data.kind,
            })
            toast.success(`${data.sale?.kind === "WORKSHOP" ? "Nota a taller" : "Venta"} ${data.sale?.kind === "WORKSHOP" ? "NT" : "V"}-${String(data.sale?.number ?? "").padStart(6, "0")} registrada: ${data.quantity} unidad(es) — ${formatPrice(data.total)}`)
            setCart([])
            setWorkshopSale(false)
            setCreditCustomer(null)
            setCreditSearch("")
            setCreditResults([])
            setCashGiven("")
            setTransferRef("")
            setSplitMode(false)
            setSplitPayments([{ method: "EFECTIVO", amount: "" }])
            setShowCheckout(false)
        } catch (error) {
            toast.error(error instanceof TypeError
                ? "No se pudo confirmar el resultado. Reintenta sin cambiar la venta para evitar duplicados."
                : error instanceof Error ? error.message : "No se pudo registrar la venta. El carrito se conserva.")
        } finally {
            submitting.current = false
            setProcessing(false)
        }
    }

    // Cliente taller/negocio (STORE/TECHNICIAN): la nota a taller se activa sola.
    const workshopCustomer = creditCustomer?.customerType === "STORE" || creditCustomer?.customerType === "TECHNICIAN"
    const workshopActive = workshopSale || workshopCustomer
    // Con nota a taller activa el mostrador cobra (y muestra) precio de mayoreo,
    // igual que lo resolverá el servidor al registrar la venta.
    const unitPrice = (product: Product) => (workshopActive ? product.wholesalePrice : product.retailPrice)
    const cartTotal = cart.reduce((sum, item) => sum + (unitPrice(item.product) * item.quantity), 0)
    const cartItems = cart.reduce((sum, item) => sum + item.quantity, 0)

    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ShoppingCart className="h-6 w-6" />
                        Venta Rápida
                        {cajaOpen !== null && (
                            cajaOpen ? (
                                <Badge variant="default" className="bg-green-600 text-xs font-normal ml-2">Caja abierta</Badge>
                            ) : (
                                <Link href="/admin/caja">
                                    <Badge variant="destructive" className="text-xs font-normal ml-2 cursor-pointer hover:opacity-80">Caja cerrada — Abrir</Badge>
                                </Link>
                            )
                        )}
                    </h1>
                    <p className="text-muted-foreground">
                        Registra ventas en local y actualiza el inventario
                    </p>
                    {lastSale && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                            Última venta: {lastSale.product} — {lastSale.quantity} ud(s)
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {branches.length > 1 && (
                        <Select value={branchId} onValueChange={setBranchId}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Sucursal" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map(b => (
                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    <ExportButton type="sales" branchId={branchId || undefined} />
                    <Button onClick={() => setShowScanner(true)} disabled={processing} size="lg" variant="outline">
                        <ScanBarcode className="h-5 w-5 mr-2" />
                        Escanear
                    </Button>
                </div>
            </div>

            {/* Search */}
            <Card>
                <CardContent className="p-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            aria-label="Buscar producto para vender"
                            disabled={processing}
                            placeholder="Buscar producto por nombre o código..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 text-lg h-12"
                            autoFocus
                        />
                        {searching && (
                            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                        )}
                    </div>

                    {products.length > 0 && (
                        <div className="mt-3 border rounded-lg max-h-64 overflow-y-auto">
                            {products.map((product) => (
                                <button
                                    key={product.id}
                                    className="w-full text-left p-4 hover:bg-muted border-b last:border-0 flex items-center justify-between"
                                    onClick={() => addToCart(product)}
                                    disabled={product.stock === 0}
                                >
                                    <div>
                                        <p className="font-medium">{product.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            Stock: {product.stock} • ${product.retailPrice.toLocaleString()}
                                        </p>
                                    </div>
                                    {product.stock > 0 ? (
                                        <Plus className="h-5 w-5 text-green-600" />
                                    ) : (
                                        <Badge variant="destructive">Sin stock</Badge>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Cart */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5" />
                            Carrito
                            {cartItems > 0 && (
                                <Badge>{cartItems}</Badge>
                            )}
                        </span>
                        {cart.length > 0 && (
                            <span className="text-xl font-bold text-green-600">
                                ${cartTotal.toLocaleString()}
                            </span>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-6">
                    {cart.length === 0 ? (
                        <EmptyState 
                            icon={Package} 
                            title="Carrito vacío" 
                            description="Escanea o busca productos para agregar" 
                        />
                    ) : (
                        <div className="space-y-3">
                            {cart.map((item) => (
                                <div
                                    key={item.product.id}
                                    className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border rounded-lg"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{item.product.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            ${unitPrice(item.product).toLocaleString()} c/u{workshopActive ? " · mayoreo" : ""}
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between w-full sm:w-auto gap-4">
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => updateQuantity(item.product.id, -1)}
                                                disabled={processing || item.quantity <= 1}
                                                aria-label={`Reducir cantidad de ${item.product.name}`}
                                            >
                                                <Minus className="h-4 w-4" />
                                            </Button>
                                            <span className="w-8 text-center font-bold">{item.quantity}</span>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => updateQuantity(item.product.id, 1)}
                                                disabled={processing || item.quantity >= item.product.stock}
                                                aria-label={`Aumentar cantidad de ${item.product.name}`}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <p className="font-bold min-w-[3rem] text-right">
                                                ${(unitPrice(item.product) * item.quantity).toLocaleString()}
                                            </p>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-600 hover:text-red-700 h-8 w-8 p-0"
                                                onClick={() => removeFromCart(item.product.id)}
                                                disabled={processing}
                                                aria-label={`Quitar ${item.product.name} de la venta`}
                                            >
                                                <X className="h-5 w-5" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            <div className="pt-4 border-t sticky bottom-0 bg-background pb-4 sm:pb-0">
                                <Button
                                    className="w-full h-14 text-lg"
                                    size="lg"
                                    onClick={() => setShowCheckout(true)}
                                    disabled={processing}
                                >
                                    {processing ? (
                                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                    ) : (
                                        <DollarSign className="h-5 w-5 mr-2" />
                                    )}
                                    Cobrar ${cartTotal.toLocaleString()}
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Last Sale Success */}
            {lastSale && (
                <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 mt-4">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <CheckCircle className="h-8 w-8 text-green-600" />
                            <div>
                                <p className="font-medium text-green-800 dark:text-green-400">
                                    Última venta registrada
                                    {lastSale.kind === "WORKSHOP" && <Badge variant="secondary" className="ml-2">Nota a taller</Badge>}
                                </p>
                                <p className="text-sm text-green-600 dark:text-green-500">
                                    {lastSale.product} × {lastSale.quantity} — {formatPrice(lastSale.total)}
                                </p>
                            </div>
                        </div>
                        {lastSale.ticketUrl && <Button variant="outline" size="sm" className="mt-3" asChild><Link href={lastSale.ticketUrl} target="_blank" rel="noopener noreferrer">Abrir ticket</Link></Button>}
                    </CardContent>
                </Card>
            )}

            {/* Scanner Dialog */}
            <Dialog open={showScanner} onOpenChange={setShowScanner}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Escanear Producto</DialogTitle>
                    </DialogHeader>
                    <BarcodeScanner
                        onScan={handleScan}
                        onClose={() => setShowScanner(false)}
                    />
                </DialogContent>
            </Dialog>
            <Dialog open={showCheckout} onOpenChange={(open) => { if (!submitting.current) setShowCheckout(open) }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Finalizar Venta</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="bg-primary/10 p-4 rounded-lg flex justify-between items-center">
                            <span className="font-medium text-lg">Total a pagar:</span>
                            <span className="text-2xl font-bold text-primary">{formatPrice(cartTotal)}</span>
                        </div>

                        {/* Nota de venta a taller: cobra mayoreo y emite folio NT-.
                            Con cliente STORE/TECHNICIAN el servidor la impone:
                            el toggle queda marcado y solo se muestra el badge. */}
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="workshop-sale"
                                checked={workshopActive}
                                disabled={processing || workshopCustomer}
                                onCheckedChange={(checked) => setWorkshopSale(checked === true)}
                            />
                            <Label htmlFor="workshop-sale" className="cursor-pointer font-normal">
                                Venta a taller <span className="text-xs text-muted-foreground">(precio de mayoreo)</span>
                            </Label>
                            {workshopCustomer && <Badge variant="secondary">Taller — mayoreo automático</Badge>}
                        </div>

                        {!splitMode ? (
                            <div className="space-y-2">
                                <Label>Método de Pago</Label>
                                <div className="flex gap-2">
                                    <div className="flex-1">
                                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                            <SelectTrigger disabled={processing}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                                                <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                                                <SelectItem value="TARJETA">Tarjeta / Terminal</SelectItem>
                                                <SelectItem value="CREDITO">💳 A crédito (cobro a cuenta)</SelectItem>
                                            </SelectContent>
                                        </Select>
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
                                        <Label htmlFor="transfer-ref">Referencia de la transferencia *</Label>
                                        <Input
                                            id="transfer-ref"
                                            placeholder="Folio SPEI / clave de rastreo"
                                            maxLength={200}
                                            disabled={processing}
                                            value={transferRef}
                                            onChange={e => setTransferRef(e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>
                        ) : (
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
                                                <Select value={p.method} onValueChange={(m) => setSplitPayments(prev => prev.map((x, j) => j === i ? { ...x, method: m } : x))}>
                                                    <SelectTrigger disabled={processing}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                                                        <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                                                        <SelectItem value="TARJETA">Tarjeta / Terminal</SelectItem>
                                                        <SelectItem value="CREDITO">💳 Crédito</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <Input
                                                type="number"
                                                min="0"
                                                placeholder="0.00"
                                                aria-label={`Monto pago ${i + 1}`}
                                                disabled={processing}
                                                value={p.amount}
                                                onChange={e => setSplitPayments(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                                                className="w-28"
                                            />
                                            {splitPayments.length > 1 && (
                                                <Button type="button" variant="ghost" size="icon" disabled={processing} aria-label="Quitar método" onClick={() => setSplitPayments(prev => prev.filter((_, j) => j !== i))}>
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                        {p.method === "TRANSFERENCIA" && (
                                            <Input
                                                placeholder="Referencia SPEI / folio de la transferencia *"
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
                                        const next = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"].find(m => !used.has(m)) ?? "EFECTIVO"
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
                                        <p className={`text-sm font-medium ${diff > 0 ? "text-destructive" : "text-amber-600"}`}>
                                            {diff > 0 ? `Faltan ${formatPrice(diff)}` : `Sobran ${formatPrice(-diff)}`}
                                        </p>
                                    ) : (
                                        <p className="text-sm font-medium text-green-600">✓ Los pagos cubren el total</p>
                                    )
                                })()}
                            </div>
                        )}

                        {!splitMode && paymentMethod === "EFECTIVO" && (
                            <div className="space-y-2">
                                <Label>Efectivo Recibido (Calculadora de Cambio)</Label>
                                <Input 
                                    type="number" 
                                    placeholder="Ej: 500"
                                    disabled={processing}
                                    aria-label="Efectivo recibido"
                                    value={cashGiven}
                                    onChange={e => setCashGiven(e.target.value)}
                                />
                                {cashGiven && parseFloat(cashGiven) >= cartTotal && (
                                    <p className="text-green-600 font-medium text-sm mt-1">
                                        Cambio: {formatPrice(parseFloat(cashGiven) - cartTotal)}
                                    </p>
                                )}
                                {cashGiven && parseFloat(cashGiven) < cartTotal && (
                                    <p className="text-destructive font-medium text-sm mt-1">
                                        Faltan: {formatPrice(cartTotal - parseFloat(cashGiven))}
                                    </p>
                                )}
                            </div>
                        )}

                        {(splitMode ? splitPayments.some(p => p.method === "CREDITO" && parseFloat(p.amount) > 0) : paymentMethod === "CREDITO") && (
                            <div className="space-y-3">
                                {!creditCustomer ? (
                                    <>
                                        <div className="space-y-2">
                                            <Label>Buscar Cliente con Crédito</Label>
                                            <div className="relative">
                                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                                <Input
                                                    placeholder="Nombre o teléfono..."
                                                    disabled={processing}
                                                    aria-label="Buscar cliente para venta a crédito"
                                                    value={creditSearch}
                                                    onChange={(e) => {
                                                        setCreditSearch(e.target.value)
                                                        searchCreditCustomers(e.target.value)
                                                    }}
                                                    className="pl-9"
                                                />
                                                {creditSearching && (
                                                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin" />
                                                )}
                                            </div>
                                        </div>
                                        {creditResults.length > 0 && (
                                            <div className="border rounded-lg max-h-36 overflow-y-auto">
                                                {creditResults.map((u) => {
                                                    const available = Math.max(0, (u.creditLimit || 0) - (u.creditBalance || 0))
                                                    return (
                                                        <button
                                                            key={u.id}
                                                            className="w-full text-left p-2.5 hover:bg-muted border-b last:border-0 text-sm"
                                                            onClick={() => { setCreditCustomer(u); setCreditSearch(""); setCreditResults([]) }}
                                                        >
                                                            <p className="font-medium">{u.name}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                Disponible: ${available.toLocaleString()} de ${(u.creditLimit || 0).toLocaleString()}
                                                            </p>
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}
                                        {creditSearch.length >= 2 && creditResults.length === 0 && !creditSearching && (
                                            <p className="text-xs text-muted-foreground text-center py-2">
                                                No se encontraron clientes con crédito
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <div className="p-3 bg-primary/10 rounded-lg">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <p className="font-semibold text-sm">💳 {creditCustomer.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    Disponible: ${Math.max(0, (creditCustomer.creditLimit ?? 0) - (creditCustomer.creditBalance ?? 0)).toLocaleString()}
                                                    {" "}de ${(creditCustomer.creditLimit ?? 0).toLocaleString()}
                                                </p>
                                            </div>
                                            <Button variant="ghost" size="sm" disabled={processing} onClick={() => setCreditCustomer(null)}>Cambiar</Button>
                                        </div>
                                        {(() => {
                                            const charge = splitMode
                                                ? splitPayments.filter(p => p.method === "CREDITO").reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
                                                : cartTotal
                                            const available = Math.max(0, (creditCustomer.creditLimit ?? 0) - (creditCustomer.creditBalance ?? 0))
                                            return charge > available ? (
                                                <p className="text-destructive text-xs font-medium mt-2">
                                                    ⚠️ El cargo a crédito ({formatPrice(charge)}) supera lo disponible ({formatPrice(available)})
                                                </p>
                                            ) : null
                                        })()}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCheckout(false)} disabled={processing}>Cancelar</Button>
                        <Button 
                            onClick={async (e) => {
                                e.preventDefault();
                                await processSale();
                            }} 
                            disabled={processing || (!splitMode && paymentMethod === "EFECTIVO" && Boolean(cashGiven && parseFloat(cashGiven) < cartTotal)) || (splitMode ? (splitPayments.some(p => p.method === "CREDITO" && parseFloat(p.amount) > 0) && !creditCustomer) : (paymentMethod === "CREDITO" && (!creditCustomer || cartTotal > Math.max(0, (creditCustomer.creditLimit ?? 0) - (creditCustomer.creditBalance ?? 0)))))}
                        >
                            {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Confirmar venta
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}
