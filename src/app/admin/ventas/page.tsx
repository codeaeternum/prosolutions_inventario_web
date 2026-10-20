"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExportButton } from "@/components/admin/export-button"
import { BarcodeScanner } from "@/components/barcode-scanner"
import { CheckCircle, ClipboardList, QrCode, ReceiptText, ScanBarcode, ShoppingCart } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"
import { CartPanel } from "@/components/pos/cart-panel"
import { CheckoutDialog } from "@/components/pos/checkout-dialog"
import { LayawaysSheet } from "@/components/pos/layaways-sheet"
import { ParkedSalesSheet } from "@/components/pos/parked-sales-sheet"
import { QuotesSheet } from "@/components/pos/quotes-sheet"
import { ProductCatalog } from "@/components/pos/product-catalog"
import { ShortcutHints } from "@/components/pos/shortcut-hints"
import { SuspendDialog } from "@/components/pos/suspend-dialog"
import { usePosDocuments } from "@/components/pos/use-pos-documents"
import {
    cartTotalOf, cartUnitsOf, exactCodeMatches,
    type CartItem, type CheckoutResult, type PosCustomer, type PosProduct,
} from "@/components/pos/types"

interface LastTicket { kind: CheckoutResult["kind"]; description: string; quantity: number; total: number; ticketUrl?: string }
const KIND_BADGE: Record<CheckoutResult["kind"], string | null> = { SALE: null, WORKSHOP: "Nota a taller", LAYAWAY: "Apartado", QUOTE: "Cotización" }

export default function VentasPage() {
    const router = useRouter()
    const { data: session, status: sessionStatus } = useSession()
    const [searchQuery, setSearchQuery] = useState("")
    // ?escanear=1 (redirect de /admin/verificar) abre el escáner en modo QR
    // al montar — estado inicial perezoso, no efecto.
    const [showScanner, setShowScanner] = useState(() =>
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("escanear") === "1")
    const [scanMode, setScanMode] = useState<"producto" | "qr">(() =>
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("escanear") === "1" ? "qr" : "producto")
    const [cart, setCart] = useState<CartItem[]>([])
    const [customer, setCustomer] = useState<PosCustomer | null>(null)
    // Nota a taller: precio de taller. Un cliente STORE/TECHNICIAN la fuerza.
    const [workshopSale, setWorkshopSale] = useState(false)
    const [resumedDoc, setResumedDoc] = useState<{ id: string; number: number; kind?: string } | null>(null)
    const [lastTicket, setLastTicket] = useState<LastTicket | null>(null)
    const [processing, setProcessing] = useState(false)
    const submitting = useRef(false)
    const [docsRefreshKey, setDocsRefreshKey] = useState(0)
    const [showCheckout, setShowCheckout] = useState(false)
    const [showSuspend, setShowSuspend] = useState(false)
    const [showParked, setShowParked] = useState(false)
    // ?apartados=1 — los apartados mostrador de Pedidos (/admin/clientes?tab=pedidos) abren el cajón.
    // Estado inicial perezoso: abrir un drawer al montar es estado inicial, no efecto.
    const [showLayaways, setShowLayaways] = useState(() =>
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("apartados") === "1")
    // ?escanear=1 — llega del redirect de /admin/verificar (QR de apartado).

    const [showQuotes, setShowQuotes] = useState(false)
    const [showMobileCart, setShowMobileCart] = useState(false)
    // ?encargo=<id> — "Cobrar" desde Pedidos: prellena cliente + pieza y
    // muestra la cotización/anticipo del encargo como referencia de cobro.
    const [encargoCtx, setEncargoCtx] = useState<{ id: string; description: string; priceQuoted: number | null; deposit: number } | null>(null)
    // Pieza del encargo pendiente de prellenar: espera a que la sucursal
    // activa esté resuelta para pedir el stock POR SUCURSAL — sin branchId
    // /api/search/pos devuelve el total de catálogo y el badge del ticket
    // mentiría hasta que el servidor topara al cobrar.
    const [pendingEncargoProduct, setPendingEncargoProduct] = useState<{ productId: string; quantity: number } | null>(null)
    const encargoProductFetched = useRef(false)
    const [cajaOpen, setCajaOpen] = useState<boolean | null>(null)
    const [autoTicket, setAutoTicket] = useState(true) // sale_auto_ticket; una falla de lectura no apaga la impresión
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
    // Marca el fin de la carga de sucursales (éxito o fallo): sin ella un
    // catálogo vacío sería indistinguible de "aún cargando".
    const [branchesLoaded, setBranchesLoaded] = useState(false)
    const [branchId, setBranchId] = useState("")
    // Empleado con sucursales asignadas: la terminal solo ofrece las suyas —
    // elegir otra convertía cada llamada en 403 y el error de /api/caja se
    // renderizaba como "Caja cerrada". Vacío/ADMIN = sin restricción.
    const allowedBranchIds = session?.user?.role === "ADMIN" ? null : session?.user?.allowedBranchIds
    const visibleBranches = useMemo(
        () => allowedBranchIds?.length ? branches.filter(b => allowedBranchIds.includes(b.id)) : branches,
        [branches, allowedBranchIds],
    )
    // Sucursal efectiva derivada (nunca una ajena al empleado): la elegida si
    // sigue siendo visible, si no la primera asignada. Mientras la sesión
    // carga va vacía para no consultar con una sucursal aún no validada.
    const activeBranchId = sessionStatus === "loading" ? ""
        : visibleBranches.some(b => b.id === branchId) ? branchId : (visibleBranches[0]?.id ?? "")

    useEffect(() => {
        fetch("/api/settings").then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setAutoTicket(d.saleAutoTicket !== false) }).catch(() => {})
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            setBranches((d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive))
        }).catch(() => {}).finally(() => setBranchesLoaded(true))
        // ?cliente=<id> — atajo "Nueva venta" desde la ficha Cliente 360.
        const params = new URLSearchParams(window.location.search)
        const preselectId = params.get("cliente")
        if (preselectId) {
            fetch(`/api/users/pos?id=${preselectId}`).then(r => r.ok ? r.json() : null)
                .then(d => { const u = d?.users?.[0]; if (u) setCustomer(u) }).catch(() => {})
        }
        // ?encargo=<id> — cobrar un encargo que ya llegó: cliente, pieza y
        // referencia de lo cotizado/anticipado. El encargo se marca DELIVERED
        // aparte; aquí solo se prellena el ticket.
        const encargoId = params.get("encargo")
        if (encargoId) {
            // /api/encargos exige el módulo inventario: un cajero solo-ventas
            // recibe 403 — se avisa en vez de fallar en silencio.
            interface EncargoListItem {
                id: string; description: string; priceQuoted?: number | null
                deposit?: number | null; customerId?: string | null
                productId?: string | null; quantity?: number | null
            }
            fetch("/api/encargos").then(async r => {
                const d: { encargos?: EncargoListItem[]; error?: string } | null = await r.json().catch(() => null)
                if (!r.ok) throw new Error(d?.error || "No se pudieron cargar los encargos")
                return d
            }).then(d => {
                const e = (d?.encargos ?? []).find(x => x.id === encargoId)
                if (!e) {
                    toast.error("No se encontró el encargo a cobrar — puede ser de otra sucursal")
                    return
                }
                setEncargoCtx({ id: e.id, description: e.description, priceQuoted: e.priceQuoted ?? null, deposit: e.deposit ?? 0 })
                if (e.customerId) {
                    fetch(`/api/users/pos?id=${e.customerId}`).then(r => r.ok ? r.json() : null)
                        .then(dd => { const u = dd?.users?.[0]; if (u) setCustomer(u) }).catch(() => {})
                }
                if (e.productId) {
                    // El fetch sale en el efecto de abajo, ya con sucursal:
                    // dispararlo aquí traería el stock total de catálogo.
                    setPendingEncargoProduct({ productId: e.productId, quantity: Math.max(1, e.quantity ?? 1) })
                }
            }).catch(err => {
                toast.error(err instanceof Error ? err.message : "No se pudo cargar el encargo")
            })
        }
    }, [])

    useEffect(() => {
        // activeBranchId ya espera a la sesión y cae en una sucursal visible:
        // nunca se consulta la caja de una sucursal ajena (403 → "cerrada").
        if (!activeBranchId) return
        fetch(`/api/caja?branchId=${activeBranchId}`).then(r => r.ok ? r.json() : null).then(d => setCajaOpen(!!d?.active)).catch(() => {})
    }, [activeBranchId])

    useEffect(() => {
        // Prefill del producto del encargo, diferido a que sesión y catálogo
        // de sucursales resolvieran: con activeBranchId la búsqueda trae el
        // stock del local (overlay idéntico al de resumeDoc para documentos);
        // si no hay sucursal resoluble se busca igual — con el stock total.
        if (!pendingEncargoProduct || encargoProductFetched.current) return
        if (sessionStatus === "loading" || !branchesLoaded) return
        encargoProductFetched.current = true
        const { productId, quantity } = pendingEncargoProduct
        fetch(`/api/search/pos?q=${encodeURIComponent(productId)}${activeBranchId ? `&branchId=${encodeURIComponent(activeBranchId)}` : ""}`)
            .then(r => r.ok ? r.json() : null)
            .then(dd => {
                const p = (dd?.products ?? []).find((x: PosProduct) => x.id === productId)
                if (p) setCart(prev => prev.length ? prev : [{ product: p, quantity }])
            }).catch(() => {})
            .finally(() => setPendingEncargoProduct(null))
    }, [pendingEncargoProduct, sessionStatus, branchesLoaded, activeBranchId])

    const workshopCustomer = customer?.customerType === "STORE" || customer?.customerType === "TECHNICIAN"
    const workshopActive = workshopSale || workshopCustomer
    const cartTotal = cartTotalOf(cart, workshopActive)
    const cartUnits = cartUnitsOf(cart)
    const clearTicket = useCallback(() => { setCart([]); setCustomer(null); setWorkshopSale(false); setResumedDoc(null) }, [])

    // Un documento suspendido se cobra con sus líneas snapshot: si el cajero
    // edita el ticket retomado, se desliga y cobra como venta nueva (la
    // suspendida queda guardada para retomarla o descartarla). Como venta
    // nueva el servidor cobra el catálogo vigente — las líneas retomadas
    // restauran el precio guardado al recuperar, no el snapshot.
    const detachIfResumed = () => {
        setResumedDoc(prev => {
            if (prev) toast.info("Ticket desligado de la suspendida — se cobra como venta nueva")
            return null
        })
        setCart(prev => prev.map(item => item.product.catalogRetailPrice != null
            ? {
                ...item,
                product: {
                    ...item.product,
                    retailPrice: item.product.catalogRetailPrice,
                    wholesalePrice: item.product.catalogWholesalePrice ?? item.product.catalogRetailPrice,
                },
            }
            : item))
    }

    const addToCart = (product: PosProduct) => {
        if (submitting.current) return
        const existing = cart.find(item => item.product.id === product.id)
        if (product.stock < 1 || (existing?.quantity ?? 0) >= product.stock) {
            toast.error("No hay más existencias disponibles de este producto")
            return
        }
        detachIfResumed()
        setCart(prev => {
            const found = prev.find(item => item.product.id === product.id)
            if (found) return prev.map(item => item.product.id === product.id ? { ...item, quantity: Math.min(item.product.stock, item.quantity + 1) } : item)
            return [...prev, { product, quantity: 1 }]
        })
        setSearchQuery("")
    }

    const updateQuantity = (productId: string, delta: number) => {
        detachIfResumed()
        setCart(prev => prev.map(item => item.product.id === productId
            ? { ...item, quantity: Math.max(1, Math.min(item.product.stock, item.quantity + delta)) } : item))
    }
    const removeFromCart = (productId: string) => {
        detachIfResumed()
        setCart(prev => prev.filter(item => item.product.id !== productId))
    }

    // Coincidencia exacta por barcode/id → alta directa en el ticket. La
    // comparten el escáner de cámara y la pistola HID (Enter en el buscador);
    // quietMiss silencia el aviso cuando el texto solo estaba filtrando.
    const addByExactCode = async (code: string, opts?: { quietMiss?: boolean }): Promise<boolean> => {
        const clean = code.trim()
        if (!clean) return false
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(clean)}${activeBranchId ? `&branchId=${activeBranchId}` : ""}`)
            if (!res.ok) throw new Error()
            const data: { products?: PosProduct[] } = await res.json()
            const matches = exactCodeMatches(data.products ?? [], clean)
            if (matches.length === 1) { addToCart(matches[0]); return true }
            if (!opts?.quietMiss) toast.error(matches.length > 1 ? "El código coincide con más de un producto. Selecciónalo en la búsqueda." : "Sin coincidencia exacta. Busca y selecciona el producto manualmente.")
            return false
        } catch {
            if (!opts?.quietMiss) toast.error("Error al buscar producto")
            return false
        }
    }

    // El QR de un apartado del cliente apunta a /verificar/<codigo>; si lo
    // escaneado trae esa forma, se abre la verificación en vez de buscar
    // producto. Un solo escáner, dos destinos.
    const handleScan = async (code: string) => {
        const clean = code.trim()
        if (!clean) return
        setShowScanner(false)
        const verifyMatch = clean.match(/\/verificar\/([^/?#\s]+)/)
        if (scanMode === "qr" || verifyMatch) {
            const reservationCode = verifyMatch ? verifyMatch[1] : clean
            router.push(`/verificar/${encodeURIComponent(reservationCode)}`)
            return
        }
        await addByExactCode(clean)
    }

    const { suspendSale, resumeDoc } = usePosDocuments({
        cart, customer, branchId: activeBranchId, workshopActive, submittingRef: submitting,
        setCart, setCustomer, setWorkshopSale, setResumedDoc, clearTicket,
        onDocumentsChanged: () => setDocsRefreshKey(k => k + 1),
    })

    const handleCompleted = useCallback((result: CheckoutResult, popup?: Window | null) => {
        // Cobro de encargo: el documento se vendió/entregó → el encargo queda
        // DELIVERED (el cobro ya quedó registrado por la venta; el PATCH es
        // solo el cierre del ciclo del encargo).
        if (encargoCtx && (result.kind === "SALE" || result.kind === "WORKSHOP" || result.kind === "LAYAWAY")) {
            fetch(`/api/encargos/${encargoCtx.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "DELIVERED" }),
            }).catch(() => {})
        }
        const ticketUrl = result.ticketId ? `/admin/tickets/venta/${result.ticketId}${result.paidWithCard ? "?copias=2" : ""}` : undefined
        setLastTicket({ kind: result.kind, description: result.description, quantity: result.quantity, total: result.total, ticketUrl })
        clearTicket()
        setShowCheckout(false)
        setDocsRefreshKey(k => k + 1)
        const folio = result.number != null ? ` #${String(result.number).padStart(6, "0")}` : ""
        const detail = `${result.description} — ${result.quantity} ud(s) · ${formatPrice(result.total)}`
        if (result.kind === "LAYAWAY") {
            toast.success(`Apartado${folio} creado: ${detail}`, { action: { label: "Ver apartados", onClick: () => setShowLayaways(true) } })
        } else if (result.kind === "QUOTE") {
            toast.success(`Cotización${folio} creada: ${detail}`, {
                action: ticketUrl ? { label: "Imprimir cotización", onClick: () => window.open(ticketUrl, "_blank", "noopener,noreferrer") } : undefined,
            })
        } else {
            toast.success(`${result.kind === "WORKSHOP" ? "Nota a taller" : "Venta"}${folio} registrada: ${detail}`)
        }
        // Auto-impresión (sale_auto_ticket): la pestaña ya venía abierta en
        // blanco desde el click de cobrar; aquí solo se navega al ticket.
        if (popup) {
            if (ticketUrl) popup.location.href = ticketUrl
            else popup.close()
        } else if (result.kind !== "QUOTE" && autoTicket && ticketUrl) {
            toast.info("El navegador bloqueó la pestaña del ticket; usa «Abrir ticket».")
        }
    }, [autoTicket, clearTicket, encargoCtx])

    // Atajos de mostrador: F2/Ctrl+Enter cobran, Esc limpia. +/−/Supr van en cada línea del ticket.
    const anyOverlayOpen = showCheckout || showSuspend || showParked || showLayaways || showQuotes || showScanner || showMobileCart
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null
            const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
            // Con cualquier overlay abierto F2/Ctrl+Enter no disparan otro
            // cobro — antes apilaban el checkout encima del diálogo activo.
            if (!anyOverlayOpen && (e.key === "F2" || ((e.ctrlKey || e.metaKey) && e.key === "Enter"))) {
                if (e.key === "F2" || !typing) { e.preventDefault(); if (cart.length > 0 && !submitting.current) setShowCheckout(true) }
                return
            }
            if (e.key === "Escape" && !anyOverlayOpen && searchQuery) setSearchQuery("")
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [cart.length, searchQuery, anyOverlayOpen])

    const setBusy = (busy: boolean) => { submitting.current = busy; setProcessing(busy) }
    const panelProps = {
        cart, workshopActive, customer, onCustomerChange: setCustomer, resumedDoc,
        onDetachResumed: detachIfResumed, processing, cajaOpen,
        onUpdateQuantity: updateQuantity, onRemove: removeFromCart, onClear: clearTicket,
        onCheckout: () => setShowCheckout(true), onSuspend: () => setShowSuspend(true),
        onOpenParked: () => setShowParked(true), onOpenLayaways: () => setShowLayaways(true),
        onOpenQuotes: () => setShowQuotes(true),
    }

    return (
        <div className="space-y-4 pb-24 lg:pb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <ShoppingCart className="h-6 w-6" /> Punto de Venta
                        {cajaOpen !== null && (cajaOpen
                            ? <Badge className="bg-green-600 text-xs font-normal">Caja abierta</Badge>
                            : <Link href="/admin/caja"><Badge variant="destructive" className="text-xs font-normal cursor-pointer hover:opacity-80">Caja cerrada — Abrir</Badge></Link>)}
                    </h1>
                    {lastTicket && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-0.5">
                            Último: {lastTicket.description} — {lastTicket.quantity} ud(s)
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {visibleBranches.length > 1 && (
                        <Select value={activeBranchId} onValueChange={setBranchId}>
                            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Sucursal" /></SelectTrigger>
                            <SelectContent>{visibleBranches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                        </Select>
                    )}
                    <ExportButton type="sales" branchId={activeBranchId || undefined} />
                    <Button onClick={() => { setScanMode("qr"); setShowScanner(true) }} disabled={processing} variant="outline" title="Escanea el QR que muestra el cliente para entregar su apartado">
                        <QrCode className="h-5 w-5 sm:mr-2" /><span className="hidden sm:inline">QR apartado</span>
                    </Button>
                    <Button onClick={() => { setScanMode("producto"); setShowScanner(true) }} disabled={processing} variant="outline">
                        <ScanBarcode className="h-5 w-5 sm:mr-2" /><span className="hidden sm:inline">Escanear</span>
                    </Button>
                </div>
            </div>

            {encargoCtx && (
                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <CardContent className="p-3 flex items-center gap-3">
                        <ClipboardList className="h-5 w-5 text-amber-600 shrink-0" />
                        <p className="text-sm text-amber-800 dark:text-amber-300 flex-1 min-w-0">
                            <span className="font-medium">Encargo:</span> {encargoCtx.description}
                            {encargoCtx.priceQuoted != null && ` · Cotizado ${formatPrice(encargoCtx.priceQuoted)}`}
                            {encargoCtx.deposit > 0 && ` · Anticipo ${formatPrice(encargoCtx.deposit)}`}
                        </p>
                        <Button variant="ghost" size="sm" onClick={() => setEncargoCtx(null)}>Quitar</Button>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start">
                <ProductCatalog branchId={activeBranchId} workshopActive={workshopActive} disabled={processing} query={searchQuery} onQueryChange={setSearchQuery} onAdd={addToCart} onSubmitCode={code => void addByExactCode(code, { quietMiss: true })} refreshKey={docsRefreshKey} />
                <div className="hidden lg:block"><CartPanel {...panelProps} /></div>
            </div>

            {lastTicket && (
                <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
                    <CardContent className="p-4 flex items-center gap-3">
                        <CheckCircle className="h-7 w-7 text-green-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-green-800 dark:text-green-400 text-sm">
                                Último movimiento registrado
                                {KIND_BADGE[lastTicket.kind] && <Badge variant="secondary" className="ml-2">{KIND_BADGE[lastTicket.kind]}</Badge>}
                            </p>
                            <p className="text-sm text-green-600 dark:text-green-500 truncate">{lastTicket.description} × {lastTicket.quantity} — {formatPrice(lastTicket.total)}</p>
                        </div>
                        {lastTicket.ticketUrl && <Button variant="outline" size="sm" asChild><Link href={lastTicket.ticketUrl} target="_blank" rel="noopener noreferrer">Abrir ticket</Link></Button>}
                    </CardContent>
                </Card>
            )}

            <ShortcutHints />

            {/* Ticket como barra inferior en pantallas angostas */}
            <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Button className="w-full h-12" onClick={() => setShowMobileCart(true)} disabled={cart.length === 0}>
                    <ReceiptText className="h-5 w-5 mr-2" />
                    Ticket {cartUnits > 0 && `(${cartUnits})`} — {formatPrice(cartTotal)}
                </Button>
            </div>
            <Sheet open={showMobileCart} onOpenChange={setShowMobileCart}>
                <SheetContent side="bottom" className="max-h-[85dvh] p-4">
                    <SheetHeader className="pb-2"><SheetTitle className="sr-only">Ticket</SheetTitle></SheetHeader>
                    <CartPanel {...panelProps} variant="plain" />
                </SheetContent>
            </Sheet>

            <Dialog open={showScanner} onOpenChange={setShowScanner}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>{scanMode === "qr" ? "Escanear QR del apartado" : "Escanear producto"}</DialogTitle></DialogHeader>
                    <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
                </DialogContent>
            </Dialog>

            <CheckoutDialog open={showCheckout} onOpenChange={setShowCheckout} cart={cart} cartTotal={cartTotal}
                workshopActive={workshopActive} workshopCustomer={workshopCustomer} onWorkshopSaleChange={setWorkshopSale}
                customer={customer} onCustomerChange={setCustomer} branchId={activeBranchId} cajaOpen={cajaOpen}
                resumedDoc={resumedDoc} onBusyChange={setBusy} autoOpenTicket={autoTicket} onCompleted={handleCompleted} />
            <SuspendDialog open={showSuspend} onOpenChange={setShowSuspend} onConfirm={suspendSale} />
            <ParkedSalesSheet open={showParked} onOpenChange={setShowParked} branchId={activeBranchId} onResume={resumeDoc} refreshKey={docsRefreshKey} />
            <LayawaysSheet open={showLayaways} onOpenChange={setShowLayaways} branchId={activeBranchId} refreshKey={docsRefreshKey} autoOpenTicket={autoTicket} />
            <QuotesSheet open={showQuotes} onOpenChange={setShowQuotes} branchId={activeBranchId} onResume={resumeDoc} refreshKey={docsRefreshKey} />
        </div>
    )
}
