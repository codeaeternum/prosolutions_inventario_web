"use client"

import { useState, useEffect } from "react"
import { useCart } from "@/components/cart-context"
import { useCurrency } from "@/components/currency-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Trash2, ShoppingCart, ArrowLeft, Upload, CheckCircle2, CreditCard } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { ImageUpload } from "@/components/image-upload"

const DEFAULT_DEPOSIT_PERCENTAGE = 50

export default function CartPage() {
    const { items, removeItem, updateQuantity, clearCart, totalPrice } = useCart()
    const { formatPrice } = useCurrency()
    const router = useRouter()

    const [reservationType, setReservationType] = useState<"TEMPORARY" | "DEPOSIT" | "CREDIT">("TEMPORARY")
    const [proofImages, setProofImages] = useState<string[]>([])
    const [loading, setLoading] = useState(false)
    const [depositPercentage, setDepositPercentage] = useState(DEFAULT_DEPOSIT_PERCENTAGE)
    const [creditInfo, setCreditInfo] = useState<{ creditLimit: number | null; creditBalance: number } | null>(null)

    useEffect(() => {
        fetch("/api/settings")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data?.depositPercentage != null) setDepositPercentage(Number(data.depositPercentage))
            })
            .catch(() => {
                toast.error("No se pudo cargar la configuración. El porcentaje de depósito puede no ser correcto.")
            })
    }, [])

    useEffect(() => {
        fetch("/api/credit/balance")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => data?.creditLimit != null ? setCreditInfo(data) : setCreditInfo(null))
            .catch(() => setCreditInfo(null))
    }, [])

    const handleCheckout = async () => {
        if (items.length === 0) return
        if (reservationType === "DEPOSIT" && proofImages.length === 0) {
            toast.error("Sube al menos un comprobante de pago para continuar con la reserva con depósito")
            return
        }
        const total = Number(totalPrice) || 0
        if (reservationType === "CREDIT" && creditInfo && (creditInfo.creditLimit == null || creditInfo.creditBalance + total > creditInfo.creditLimit)) {
            toast.error("No tienes crédito disponible para este monto. Elige otra forma de pago.")
            return
        }

        setLoading(true)
        try {
            const type = reservationType === "CREDIT" ? "TEMPORARY" : reservationType
            const paymentMethod = reservationType === "CREDIT" ? "CREDIT" : undefined
            for (const item of items) {
                const body = {
                    productId: item.productId,
                    quantity: item.quantity,
                    type,
                    paymentProofUrl: reservationType === "DEPOSIT" ? proofImages[0] : undefined,
                    paymentMethod,
                }

                const res = await fetch("/api/reservations", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                })

                if (!res.ok) {
                    const data = await res.json()
                    throw new Error(`Error reservando ${item.name}: ${data.error}`)
                }
            }

            clearCart()
            toast.success("?Reserva exitosa! Redirigiendo a tus reservas...")
            router.push("/mis-reservas")
        } catch (err) {
            console.error("Checkout error:", err)
            const message = err instanceof Error ? err.message : "Error al procesar la reserva. Revisa tu conexi?n e intenta de nuevo."
            toast.error(message)
        } finally {
            setLoading(false)
        }
    }

    if (items.length === 0) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
                <main id="main-content" className="flex flex-col items-center" role="main">
                <div className="bg-muted p-6 rounded-full mb-4">
                    <ShoppingCart className="h-12 w-12 text-muted-foreground" aria-hidden />
                </div>
                <h1 className="text-2xl font-bold mb-2">Tu carrito est? vac?o</h1>
                <p className="text-muted-foreground mb-8">Agrega productos del cat?logo para reservar.</p>
                <Button asChild>
                    <Link href="/catalogo">
                        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                        Ir al cat?logo
                    </Link>
                </Button>
                </main>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-muted/40 pb-24">
            <header className="sticky top-0 safe-area-sticky z-50 border-b bg-background/95 backdrop-blur px-4 h-14 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" asChild>
                        <Link href="/catalogo">
                            <ArrowLeft className="h-5 w-5" />
                        </Link>
                    </Button>
                    <h1 className="font-bold text-lg flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5" />
                        Carrito ({items.length})
                    </h1>
                </div>
                <Button variant="ghost" size="sm" asChild className="text-primary">
                    <Link href="/catalogo">
                        Continuar comprando
                    </Link>
                </Button>
            </header>

            <main id="main-content" className="container max-w-lg mx-auto p-4 space-y-6" role="main">
                {/* Items List */}
                <div className="space-y-4">
                    {items.map((item) => (
                        <Card key={item.productId} className="overflow-hidden">
                            <CardContent className="p-3 flex gap-3">
                                <div className="h-20 w-20 bg-muted rounded-md relative flex-shrink-0 overflow-hidden">
                                    {item.image ? (
                                        <Image src={item.image} alt={item.name} fill sizes="80px" className="object-cover" />
                                    ) : (
                                        <div className="flex h-full items-center justify-center">
                                            <ShoppingCart className="h-8 w-8 text-muted-foreground/30" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div>
                                        <h3 className="font-medium text-sm line-clamp-2" title={item.name || "Producto"}>
                                            {item.name || "Producto"}
                                        </h3>
                                        <p className="text-primary font-bold">{formatPrice(item.price)}</p>
                                    </div>
                                    <div className="flex items-center justify-between mt-2">
                                        <div className="flex items-center gap-2 border rounded-md">
                                            <button
                                                type="button"
                                                className="px-2 py-1 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                                onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                                                disabled={item.quantity <= 1}
                                                aria-label="Reducir cantidad"
                                            >-</button>
                                            <span className="text-sm font-medium w-4 text-center">{item.quantity}</span>
                                            <button
                                                type="button"
                                                className="px-2 py-1 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                                                onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                                                disabled={item.quantity >= item.maxStock}
                                                aria-label="Aumentar cantidad"
                                            >+</button>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                            onClick={() => removeItem(item.productId)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* Reservation Type & Checkout */}
                <Card className="border-primary/20 shadow-md">
                    <CardContent className="p-4 space-y-4">
                        <h3 className="font-semibold">Tipo de Reserva</h3>
                        <div className={`grid gap-3 ${creditInfo ? "grid-cols-3" : "grid-cols-2"}`}>
                            <div
                                className={`border rounded-lg p-3 cursor-pointer transition-colors ${reservationType === "TEMPORARY" ? "bg-primary/5 border-primary ring-1 ring-primary" : "hover:bg-muted/50"}`}
                                onClick={() => setReservationType("TEMPORARY")}
                            >
                                <div className="font-medium text-sm">Temporal</div>
                                <div className="text-xs text-muted-foreground mt-1">Expira en 30 min</div>
                                <div className="text-xs text-muted-foreground">Sin pago previo</div>
                            </div>
                            <div
                                className={`border rounded-lg p-3 cursor-pointer transition-colors ${reservationType === "DEPOSIT" ? "bg-primary/5 border-primary ring-1 ring-primary" : "hover:bg-muted/50"}`}
                                onClick={() => setReservationType("DEPOSIT")}
                            >
                                <div className="font-medium text-sm">Con Depósito</div>
                                <div className="text-xs text-muted-foreground mt-1">Expira en 24h</div>
                                <div className="text-xs text-muted-foreground">Requiere comprobante</div>
                            </div>
                            {creditInfo && creditInfo.creditLimit != null && creditInfo.creditLimit > 0 && (
                                <div
                                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${reservationType === "CREDIT" ? "bg-primary/5 border-primary ring-1 ring-primary" : "hover:bg-muted/50"}`}
                                    onClick={() => setReservationType("CREDIT")}
                                >
                                    <div className="font-medium text-sm flex items-center gap-1">
                                        <CreditCard className="h-3.5 w-3.5" />
                                        A crédito
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Disponible: {formatPrice(Math.max(0, creditInfo.creditLimit - creditInfo.creditBalance))}
                                    </div>
                                    <div className="text-xs text-muted-foreground">Se cobra a tu cuenta</div>
                                </div>
                            )}
                        </div>

                        {reservationType === "DEPOSIT" && (
                            <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-2">
                                <label className="text-sm font-medium flex items-center gap-2">
                                    <Upload className="h-4 w-4" />
                                    Subir Comprobante
                                </label>
                                <ImageUpload
                                    images={proofImages}
                                    onChange={setProofImages}
                                    maxImages={1}
                                    className="w-full"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Foto o captura del comprobante de transferencia o pago.
                                </p>
                            </div>
                        )}

                        <div className="pt-4 border-t flex items-center justify-between">
                            <span className="font-medium">Total Estimado</span>
                            <span className="text-xl font-bold text-primary">{formatPrice(Number(totalPrice) || 0)}</span>
                        </div>

                        {reservationType === "DEPOSIT" && (
                            <div className="rounded-lg bg-muted/60 p-3 space-y-2 border">
                                <div className="text-sm font-medium text-muted-foreground">Resumen de dep?sito</div>
                                <div className="flex justify-between text-sm">
                                    <span>Total del carrito</span>
                                    <span className="font-medium">{formatPrice(Number(totalPrice) || 0)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                    <span>Porcentaje de dep?sito</span>
                                    <span className="font-medium">{depositPercentage}%</span>
                                </div>
                                <div className="flex justify-between font-semibold text-primary pt-1 border-t">
                                    <span>Dep?sito a pagar ({depositPercentage}%)</span>
                                    <span>{formatPrice(((Number(totalPrice) || 0) * depositPercentage) / 100)}</span>
                                </div>
                                <div className="flex justify-between text-sm text-muted-foreground">
                                    <span>Saldo restante a pagar al recoger</span>
                                    <span>{formatPrice((Number(totalPrice) || 0) - ((Number(totalPrice) || 0) * depositPercentage) / 100)}</span>
                                </div>
                            </div>
                        )}

                        <Button className="w-full h-12 text-lg" onClick={handleCheckout} disabled={loading}>
                            {loading ? "Procesando..." : (
                                <>
                                    <CheckCircle2 className="mr-2 h-5 w-5" />
                                    Confirmar Reserva
                                </>
                            )}
                        </Button>
                    </CardContent>
                </Card>
            </main>
        </div>
    )
}
