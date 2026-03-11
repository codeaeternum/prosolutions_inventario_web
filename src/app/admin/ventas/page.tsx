"use client"

import { useState, useEffect, useCallback } from "react"
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
import { Breadcrumbs } from "@/components/admin/breadcrumbs"
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
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"

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
    const [loading, setLoading] = useState(false)
    const [showScanner, setShowScanner] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [products, setProducts] = useState<Product[]>([])
    const [searching, setSearching] = useState(false)
    const [cart, setCart] = useState<SaleItem[]>([])
    const [processing, setProcessing] = useState(false)
    const [lastSale, setLastSale] = useState<{ product: string, quantity: number } | null>(null)

    // Checkout modal state
    const [showCheckout, setShowCheckout] = useState(false)
    const [paymentMethod, setPaymentMethod] = useState("EFECTIVO")
    const [cashGiven, setCashGiven] = useState("")

    const handleScan = async (code: string) => {
        const cleanCode = code.trim()
        if (!cleanCode) return

        setShowScanner(false)
        setSearching(true)
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(cleanCode)}`)
            const data = await res.json()
            if (data.products && data.products.length > 0) {
                addToCart(data.products[0])
                toast.success("Producto agregado")
            } else {
                toast.error("Producto no encontrado: " + cleanCode)
            }
        } catch (error) {
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
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(cleanQuery)}`)
            const data = await res.json()
            setProducts(data.products || [])
        } catch (error) {
            console.error("Error searching products:", error)
        } finally {
            setSearching(false)
        }
    }, [])

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
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id)
            if (existing) {
                return prev.map(item =>
                    item.product.id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
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

    const processSale = async () => {
        if (cart.length === 0) return

        setProcessing(true)
        try {
            // Process each item as a SALE movement
            let lastMovementId = "";
            for (const item of cart) {
                const res = await fetch("/api/inventory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        productId: item.product.id,
                        type: "SALE",
                        quantity: item.quantity,
                        reason: "Venta en local",
                        unitPrice: item.product.retailPrice,
                        totalPrice: item.product.retailPrice * item.quantity,
                    }),
                })

                if (!res.ok) {
                    const error = await res.json()
                    toast.error(`Error: ${error.error}`)
                    return
                }
                const data = await res.json();
                lastMovementId = data.id; // Guardamos el id para el ticket
            }

            const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)
            const totalPrice = cart.reduce((sum, item) => sum + (item.product.retailPrice * item.quantity), 0)

            toast.success(`✅ Venta registrada: ${totalItems} producto(s) - $${totalPrice.toLocaleString()}`)

            setLastSale({
                product: cart.length === 1 ? cart[0].product.name : `${cart.length} productos`,
                quantity: totalItems
            })
            setCart([])

            // Opcional: Si fue una sola línea, abrir el ticket de esa venta
            if (cart.length === 1 && lastMovementId) {
                window.open(`/admin/tickets/venta/${lastMovementId}`, '_blank');
            }
        } catch (error) {
            console.error("Error processing sale:", error)
            toast.error("Error al procesar venta")
        } finally {
            setProcessing(false)
        }
    }

    const cartTotal = cart.reduce((sum, item) => sum + (item.product.retailPrice * item.quantity), 0)
    const cartItems = cart.reduce((sum, item) => sum + item.quantity, 0)

    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <Breadcrumbs items={[{ label: "Venta Rápida" }]} />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <ShoppingCart className="h-6 w-6" />
                        Venta Rápida
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
                <Button onClick={() => setShowScanner(true)} size="lg" variant="outline">
                    <ScanBarcode className="h-5 w-5 mr-2" />
                    Escanear
                </Button>
            </div>

            {/* Search */}
            <Card>
                <CardContent className="p-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
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
                                            ${item.product.retailPrice.toLocaleString()} c/u
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between w-full sm:w-auto gap-4">
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => updateQuantity(item.product.id, -1)}
                                                disabled={item.quantity <= 1}
                                            >
                                                <Minus className="h-4 w-4" />
                                            </Button>
                                            <span className="w-8 text-center font-bold">{item.quantity}</span>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => updateQuantity(item.product.id, 1)}
                                                disabled={item.quantity >= item.product.stock}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <p className="font-bold min-w-[3rem] text-right">
                                                ${(item.product.retailPrice * item.quantity).toLocaleString()}
                                            </p>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-600 hover:text-red-700 h-8 w-8 p-0"
                                                onClick={() => removeFromCart(item.product.id)}
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
                                <p className="font-medium text-green-800 dark:text-green-400">Última venta registrada</p>
                                <p className="text-sm text-green-600 dark:text-green-500">
                                    {lastSale.product} × {lastSale.quantity}
                                </p>
                            </div>
                        </div>
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
            <Dialog open={showCheckout} onOpenChange={setShowCheckout}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Finalizar Venta</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="bg-primary/10 p-4 rounded-lg flex justify-between items-center">
                            <span className="font-medium text-lg">Total a pagar:</span>
                            <span className="text-2xl font-bold text-primary">{formatPrice(cartTotal)}</span>
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Método de Pago</Label>
                            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                                    <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                                    <SelectItem value="TARJETA">Tarjeta / Terminal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {paymentMethod === "EFECTIVO" && (
                            <div className="space-y-2">
                                <Label>Efectivo Recibido (Calculadora de Cambio)</Label>
                                <Input 
                                    type="number" 
                                    placeholder="Ej: 500"
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
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowCheckout(false)} disabled={processing}>Cancelar</Button>
                        <Button 
                            onClick={async (e) => {
                                e.preventDefault();
                                setShowCheckout(false);
                                await processSale();
                            }} 
                            disabled={processing || (paymentMethod === "EFECTIVO" && Boolean(cashGiven && parseFloat(cashGiven) < cartTotal))}
                        >
                            {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Cobrar e Imprimir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}
