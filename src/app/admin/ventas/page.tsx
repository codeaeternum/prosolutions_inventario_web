"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ExportButton } from "@/components/admin/export-button"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle, ClipboardList, Keyboard, QrCode, ReceiptText, RotateCcw, ScanBarcode, ShoppingCart, Volume2, VolumeX } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"
import type { ClientOperationKey } from "@/lib/client-operation-key"
import { CartPanel } from "@/components/pos/cart-panel"
import { CheckoutDialog } from "@/components/pos/checkout-dialog"
import { LayawaysSheet } from "@/components/pos/layaways-sheet"
import { ParkedSalesSheet } from "@/components/pos/parked-sales-sheet"
import { QuotesSheet } from "@/components/pos/quotes-sheet"
import { SalesReturnsSheet } from "@/components/pos/sales-returns-sheet"
import { ProductCatalog } from "@/components/pos/product-catalog"
import { ShortcutHints, ShortcutsHelpDialog } from "@/components/pos/shortcut-hints"
import { SuspendDialog } from "@/components/pos/suspend-dialog"
import { usePosDocuments } from "@/components/pos/use-pos-documents"
import { playPosTone, posSoundEnabled, setPosSoundEnabled } from "@/components/pos/pos-sound"
import { POS_TICKET_STORAGE_KEY, parsePosTicket, serializePosTicket } from "@/components/pos/ticket-storage"
import {
    cartTotalOf, cartUnitsOf, exactCodeMatches, parseQuantityCode,
    type CartItem, type CheckoutResult, type PosCustomer, type PosProduct,
} from "@/components/pos/types"

// html5-qrcode pesa ~350 KB y toca `window`: se difiere al abrir el diálogo.
const BarcodeScanner = dynamic(
    () => import("@/components/barcode-scanner").then(m => m.BarcodeScanner),
    { ssr: false, loading: () => <Skeleton className="aspect-square w-full" /> }
)

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
    // Borrador del ticket en localStorage: un reload o un corte a medio cobro
    // no pierde las líneas capturadas. No aplica al llegar con ?encargo= — el
    // prefill del encargo es la intención explícita y no debe pisarse. El
    // servidor revalida precios y existencias al cobrar (borrador, no verdad).
    const [restoredTicket] = useState(() => {
        if (typeof window === "undefined") return null
        try {
            if (new URLSearchParams(window.location.search).get("encargo")) return null
            return parsePosTicket(localStorage.getItem(POS_TICKET_STORAGE_KEY), Date.now())
        } catch {
            return null
        }
    })
    const [cart, setCart] = useState<CartItem[]>(() => restoredTicket?.cart ?? [])
    const [customer, setCustomer] = useState<PosCustomer | null>(() => restoredTicket?.customer ?? null)
    // Nota a taller: precio de taller. Un cliente STORE/TECHNICIAN la fuerza.
    const [workshopSale, setWorkshopSale] = useState(() => restoredTicket?.workshopSale ?? false)
    // Llave de idempotencia del cobro: viaja en el borrador — un crash a
    // medio POST la restaura y el reintento del mismo ticket la reusa (el
    // servidor deduplica → no hay doble cobro). CheckoutDialog la reporta
    // al generarla (submit) y la limpia al cobrar (null).
    const [checkoutKey, setCheckoutKey] = useState<ClientOperationKey | null>(() => restoredTicket?.checkoutKey ?? null)
    const [resumedDoc, setResumedDoc] = useState<{ id: string; number: number; kind?: string } | null>(null)
    const [lastTicket, setLastTicket] = useState<LastTicket | null>(null)
    const [processing, setProcessing] = useState(false)
    const submitting = useRef(false)
    const [docsRefreshKey, setDocsRefreshKey] = useState(0)
    const [showCheckout, setShowCheckout] = useState(false)
    const [showSuspend, setShowSuspend] = useState(false)
    const [showShortcuts, setShowShortcuts] = useState(false)
    // Flash en la línea recién agregada + beep: certeza de alta sin mirar.
    const [flash, setFlash] = useState<{ productId: string; nonce: number } | null>(null)
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [soundOn, setSoundOn] = useState(() => typeof window === "undefined" ? true : posSoundEnabled())
    const [showParked, setShowParked] = useState(false)
    // ?apartados=1 — los apartados mostrador de Pedidos (/admin/clientes?tab=pedidos) abren el cajón.
    // Estado inicial perezoso: abrir un drawer al montar es estado inicial, no efecto.
    const [showLayaways, setShowLayaways] = useState(() =>
        typeof window !== "undefined" && new URLSearchParams(window.location.search).get("apartados") === "1")
    // ?escanear=1 — llega del redirect de /admin/verificar (QR de apartado).

    const [showQuotes, setShowQuotes] = useState(false)
    const [showSalesHistory, setShowSalesHistory] = useState(false)
    const [salesInitialQuery, setSalesInitialQuery] = useState("")
    const [showMobileCart, setShowMobileCart] = useState(false)
    // ?encargo=<id> — "Cobrar" desde Pedidos o Encargos: prellena cliente + pieza y
    // aplica el precio cotizado y el anticipo del encargo al liquidar la venta.
    const [encargoCtx, setEncargoCtx] = useState<{ id: string; description: string; priceQuoted: number | null; deposit: number; productId: string | null; quantity: number } | null>(null)
    // Pieza del encargo pendiente de prellenar: espera a que la sucursal
    // activa esté resuelta para pedir el stock POR SUCURSAL — sin branchId
    // /api/search/pos devuelve el total de catálogo y el badge del ticket
    // mentiría hasta que el servidor topara al cobrar.
    const [pendingEncargoProduct, setPendingEncargoProduct] = useState<{ productId: string; quantity: number; priceQuoted: number | null } | null>(null)
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
        // ?encargo=<id> — cobrar un encargo que ya llegó: cliente, pieza,
        // precio cotizado y anticipo neto. La venta lo liquida y lo pasa a
        // DELIVERED en la misma transacción.
        const encargoId = params.get("encargo")
        if (encargoId) {
            interface EncargoDetail {
                id: string; description: string; status?: string; priceQuoted?: number | null
                deposit?: number | null; customerId?: string | null
                productId?: string | null; quantity?: number | null
            }
            fetch(`/api/encargos/${encodeURIComponent(encargoId)}`).then(async r => {
                const d: { encargo?: EncargoDetail; error?: string } | null = await r.json().catch(() => null)
                if (!r.ok) throw new Error(d?.error || "No se pudo cargar el encargo")
                return d
            }).then(d => {
                const e = d?.encargo
                if (!e) {
                    toast.error("No se encontró el encargo a cobrar — puede ser de otra sucursal")
                    return
                }
                if (e.status && e.status !== "READY") {
                    toast.error("Este encargo ya no está pendiente de entrega")
                    return
                }
                const priceQuoted = e.priceQuoted ?? null
                setEncargoCtx({ id: e.id, description: e.description, priceQuoted, deposit: e.deposit ?? 0, productId: e.productId ?? null, quantity: Math.max(1, e.quantity ?? 1) })
                if (e.customerId) {
                    fetch(`/api/users/pos?id=${e.customerId}`).then(r => r.ok ? r.json() : null)
                        .then(dd => { const u = dd?.users?.[0]; if (u) setCustomer(u) }).catch(() => {})
                }
                if (e.productId) {
                    // El fetch sale en el efecto de abajo, ya con sucursal:
                    // dispararlo aquí traería el stock total de catálogo.
                    setPendingEncargoProduct({ productId: e.productId, quantity: Math.max(1, e.quantity ?? 1), priceQuoted })
                }
            }).catch(err => {
                toast.error(err instanceof Error ? err.message : "No se pudo cargar el encargo")
            })
        }
    }, [])

    // Aviso único al recuperar el borrador (montaje): el cajero sabe de dónde
    // salieron esas líneas — y "Vaciar ticket" las descarta si no eran.
    useEffect(() => {
        if (restoredTicket) toast.info("Se recuperó el ticket que quedó sin cobrar")
    }, [restoredTicket])

    // El flash no deja timers colgados al desmontar.
    useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

    // El borrador se reescribe con cada cambio del ticket y se borra al
    // vaciarlo — un ticket cobrado/suspendido no resucita en el próximo load.
    useEffect(() => {
        try {
            if (cart.length === 0) localStorage.removeItem(POS_TICKET_STORAGE_KEY)
            else localStorage.setItem(POS_TICKET_STORAGE_KEY, serializePosTicket({ cart, customer, workshopSale, checkoutKey }, activeBranchId))
        } catch { /* storage lleno o modo privado: el ticket sigue en memoria */ }
    }, [cart, customer, workshopSale, checkoutKey, activeBranchId])

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
        const { productId, quantity, priceQuoted } = pendingEncargoProduct
        fetch(`/api/search/pos?q=${encodeURIComponent(productId)}${activeBranchId ? `&branchId=${encodeURIComponent(activeBranchId)}` : ""}`)
            .then(r => r.ok ? r.json() : null)
            .then(dd => {
                const p = (dd?.products ?? []).find((x: PosProduct) => x.id === productId)
                if (p) {
                    // priceQuoted es el TOTAL del encargo (las `quantity`
                    // piezas juntas): el unitario mostrado se prorratea para
                    // que el total del ticket coincida con lo cotizado — el
                    // servidor cobra el total exacto (encargoQuotedLineCents).
                    const unitQuoted = priceQuoted != null && priceQuoted > 0 ? priceQuoted / quantity : null
                    const productWithQuote: PosProduct = unitQuoted != null
                        ? {
                            ...p,
                            retailPrice: unitQuoted,
                            wholesalePrice: unitQuoted,
                            catalogRetailPrice: p.retailPrice,
                            catalogWholesalePrice: p.wholesalePrice,
                        }
                        : p
                    setCart(prev => prev.length ? prev : [{ product: productWithQuote, quantity }])
                }
            }).catch(() => {})
            .finally(() => setPendingEncargoProduct(null))
    }, [pendingEncargoProduct, sessionStatus, branchesLoaded, activeBranchId])

    const workshopCustomer = customer?.customerType === "STORE" || customer?.customerType === "TECHNICIAN"
    const workshopActive = workshopSale || workshopCustomer
    const cartTotal = cartTotalOf(cart, workshopActive)
    const cartUnits = cartUnitsOf(cart)
    const clearTicket = useCallback(() => { setCart([]); setCustomer(null); setWorkshopSale(false); setResumedDoc(null); setFlash(null); setCheckoutKey(null) }, [])

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

    // Espejo del ticket para lecturas fuera del ciclo de render: el escáner
    // continuo encadena scans con awaits de por medio — `cart` en la clausura
    // puede no traer aún la línea recién agregada y el tope de stock mentiría.
    const cartRef = useRef(cart)
    useEffect(() => { cartRef.current = cart }, [cart])

    const addToCart = (product: PosProduct, quantity = 1) => {
        if (submitting.current) return
        const existing = cartRef.current.find(item => item.product.id === product.id)
        const room = product.stock - (existing?.quantity ?? 0)
        if (product.stock < 1 || room <= 0) {
            if (soundOn) playPosTone("error")
            toast.error(product.stock < 1
                ? `«${product.name}» no tiene existencias en esta sucursal`
                : `Ya está en el ticket lo que hay de «${product.name}» (${product.stock} en existencia)`)
            return
        }
        const addQty = Math.min(quantity, room)
        if (addQty < quantity) toast.info(`Solo había ${room} en existencia — se agregó${room === 1 ? "" : "ron"} ${addQty}`)
        detachIfResumed()
        setCart(prev => {
            const found = prev.find(item => item.product.id === product.id)
            const applyEncargoQuote = !found && prev.length === 0 && encargoCtx && !encargoCtx.productId && encargoCtx.priceQuoted != null && encargoCtx.priceQuoted > 0
            // Mismo prorrateo que el prefill: priceQuoted es el TOTAL del
            // encargo — el unitario mostrado es total ÷ piezas del encargo.
            const freeTextUnitQuoted = applyEncargoQuote ? encargoCtx!.priceQuoted! / encargoCtx!.quantity : null
            const effectiveProduct: PosProduct = freeTextUnitQuoted != null
                ? {
                    ...product,
                    retailPrice: freeTextUnitQuoted,
                    wholesalePrice: freeTextUnitQuoted,
                    catalogRetailPrice: product.retailPrice,
                    catalogWholesalePrice: product.wholesalePrice,
                }
                : product
            const next = found
                ? prev.map(item => item.product.id === product.id ? { ...item, quantity: Math.min(item.product.stock, item.quantity + addQty) } : item)
                : [...prev, { product: effectiveProduct, quantity: addQty }]
            // El espejo se actualiza aquí también: otro scan a continuación
            // ya ve esta línea aunque el efecto todavía no corra.
            cartRef.current = next
            return next
        })
        setSearchQuery("")
        setFlash(prev => ({ productId: product.id, nonce: (prev?.nonce ?? 0) + 1 }))
        // El flash expira solo: si el ticket móvil se abre después, la línea
        // ya no debe "destellar" una alta vieja.
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(null), 700)
        if (soundOn) playPosTone("add")
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
            const search = async (q: string) => {
                const res = await fetch(`/api/search/pos?q=${encodeURIComponent(q)}${activeBranchId ? `&branchId=${activeBranchId}` : ""}`)
                if (!res.ok) throw new Error()
                const data: { products?: PosProduct[] } = await res.json()
                return data.products ?? []
            }
            const matches = exactCodeMatches(await search(clean), clean)
            if (matches.length === 1) { addToCart(matches[0]); return true }
            // "5*750123": cantidad + código en un escaneo. Se prueba DESPUÉS
            // del match completo: un barcode que empiece "5X…" sigue entrando
            // entero; solo el texto que NO es barcode se reinterpreta.
            const qtyCode = parseQuantityCode(clean)
            if (qtyCode) {
                const qtyMatches = exactCodeMatches(await search(qtyCode.code), qtyCode.code)
                if (qtyMatches.length === 1) { addToCart(qtyMatches[0], qtyCode.quantity); return true }
            }
            if (!opts?.quietMiss) {
                if (soundOn) playPosTone("error")
                toast.error(matches.length > 1 ? "El código coincide con más de un producto. Selecciónalo en la búsqueda." : "Sin coincidencia exacta. Busca y selecciona el producto manualmente.")
            }
            return false
        } catch {
            if (!opts?.quietMiss) toast.error("Error al buscar producto")
            return false
        }
    }

    // El QR de un apartado del cliente apunta a /verificar/<codigo>; un folio
    // V-... o URL de ticket de venta abre el historial para devolución/reimpresión.
    const handleScan = async (code: string) => {
        const clean = code.trim()
        if (!clean) return
        // Los códigos que NAVEGAN (folio de ticket, QR de apartado) cierran el
        // diálogo siempre; los de producto lo dejan abierto en modo continuo —
        // el cajero pasa pieza tras pieza y sale con «Listo (N)».
        if (/^(?:V|A|NT|C)-?0*(\d+)$/i.test(clean)) {
            setShowScanner(false)
            setSalesInitialQuery(clean)
            setShowSalesHistory(true)
            return
        }
        const saleTicketMatch = /\/admin\/tickets\/venta\/([^/?#\s]+)/.exec(clean)
        if (saleTicketMatch) {
            setShowScanner(false)
            const ticketRef = decodeURIComponent(saleTicketMatch[1])
            if (/^V-\d+$/i.test(ticketRef)) {
                setSalesInitialQuery(ticketRef)
            }
            setShowSalesHistory(true)
            return
        }
        const verifyMatch = clean.match(/\/verificar\/([^/?#\s]+)/)
        if (scanMode === "qr" || verifyMatch) {
            setShowScanner(false)
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
        // El encargo ya quedó liquidado y en estado DELIVERED dentro de la
        // misma transacción de la venta (sell / checkoutDocument).
        const ticketUrl = result.ticketId ? `/admin/tickets/venta/${result.ticketId}${result.paidWithCard ? "?copias=2" : ""}` : undefined
        setLastTicket({ kind: result.kind, description: result.description, quantity: result.quantity, total: result.total, ticketUrl })
        clearTicket()
        setEncargoCtx(null) // la venta saldó el encargo: la tarjeta ámbar ya no aplica
        setShowCheckout(false)
        setDocsRefreshKey(k => k + 1)
        // La siguiente venta arranca escaneando: el foco vuelve al buscador.
        setTimeout(() => (document.getElementById("pos-product-search") as HTMLInputElement | null)?.focus(), 0)
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
    }, [autoTicket, clearTicket])

    // Atajos de mostrador: F2/Ctrl+Enter cobran, / enfoca el buscador, F4 tickets,
    // F9 suspende, ? muestra la ayuda, Esc limpia. +/−/↑/↓/Supr van en cada línea.
    const anyOverlayOpen = showCheckout || showSuspend || showParked || showLayaways || showQuotes || showSalesHistory || showScanner || showMobileCart || showShortcuts
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null
            const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
            // Con cualquier overlay abierto los atajos del ticket no disparan —
            // antes apilaban el checkout encima del diálogo activo.
            if (!anyOverlayOpen && (e.key === "F2" || ((e.ctrlKey || e.metaKey) && e.key === "Enter"))) {
                if (e.key === "F2" || !typing) { e.preventDefault(); if (cart.length > 0 && !submitting.current) setShowCheckout(true) }
                return
            }
            if (!anyOverlayOpen && !typing && e.key === "/") {
                e.preventDefault()
                document.getElementById("pos-product-search")?.focus()
                return
            }
            if (!anyOverlayOpen && !typing && e.key === "?") {
                e.preventDefault()
                setShowShortcuts(true)
                return
            }
            if (!anyOverlayOpen && e.key === "F4") {
                e.preventDefault()
                setShowSalesHistory(true)
                return
            }
            if (!anyOverlayOpen && e.key === "F9") {
                e.preventDefault()
                if (cart.length > 0 && !submitting.current) setShowSuspend(true)
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
        onDetachResumed: detachIfResumed, processing, cajaOpen, flash,
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
                    <Button onClick={() => setShowSalesHistory(true)} disabled={processing} variant="outline" title="Consultar tickets recientes y procesar devoluciones o anulaciones (F4)" aria-label="Devoluciones / Tickets">
                        <RotateCcw className="h-5 w-5 sm:mr-2" aria-hidden="true" /><span className="hidden sm:inline">Devoluciones / Tickets</span>
                    </Button>
                    <Button onClick={() => { setScanMode("qr"); setShowScanner(true) }} disabled={processing} variant="outline" title="Escanea el QR que muestra el cliente para entregar su apartado" aria-label="Escanear QR de apartado">
                        <QrCode className="h-5 w-5 sm:mr-2" aria-hidden="true" /><span className="hidden sm:inline">QR apartado</span>
                    </Button>
                    <Button onClick={() => { setScanMode("producto"); setShowScanner(true) }} disabled={processing} variant="outline" aria-label="Escanear producto">
                        <ScanBarcode className="h-5 w-5 sm:mr-2" aria-hidden="true" /><span className="hidden sm:inline">Escanear</span>
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        onClick={() => setSoundOn(prev => { const next = !prev; setPosSoundEnabled(next); return next })}
                        title={soundOn ? "Silenciar beeps del mostrador" : "Activar beeps del mostrador"}
                        aria-label={soundOn ? "Silenciar beeps" : "Activar beeps"}
                        aria-pressed={soundOn}
                    >
                        {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="hidden sm:inline-flex"
                        onClick={() => setShowShortcuts(true)}
                        title="Atajos de teclado (?)"
                        aria-label="Atajos de teclado"
                    >
                        <Keyboard className="h-5 w-5" />
                    </Button>
                </div>
            </div>

            {encargoCtx && (
                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                    <CardContent className="p-3 flex items-center gap-3">
                        <ClipboardList className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-800 dark:text-amber-300 flex-1 min-w-0">
                            <span className="font-medium">Encargo:</span> {encargoCtx.description}
                            {encargoCtx.priceQuoted != null && ` · Cotizado ${formatPrice(encargoCtx.priceQuoted)}`}
                            {encargoCtx.deposit > 0 && ` · Anticipo ${formatPrice(encargoCtx.deposit)} (se descuenta al cobrar)`}
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setEncargoCtx(null)
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
                            }}
                        >
                            Quitar
                        </Button>
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
                        <CheckCircle className="h-7 w-7 text-green-600 dark:text-green-400 shrink-0" />
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
                    {/* Producto: modo continuo (mostrador con muchos items).
                        QR de apartado sigue single-shot: navega a /verificar. */}
                    <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} continuous={scanMode === "producto"} />
                </DialogContent>
            </Dialog>

            <CheckoutDialog open={showCheckout} onOpenChange={setShowCheckout} cart={cart} cartTotal={cartTotal}
                workshopActive={workshopActive} workshopCustomer={workshopCustomer} onWorkshopSaleChange={setWorkshopSale}
                customer={customer} onCustomerChange={setCustomer} branchId={activeBranchId} cajaOpen={cajaOpen}
                resumedDoc={resumedDoc} encargo={encargoCtx} onBusyChange={setBusy} autoOpenTicket={autoTicket}
                initialOperationKey={checkoutKey} onOperationKeyChange={setCheckoutKey}
                onCompleted={handleCompleted} />
            <SuspendDialog open={showSuspend} onOpenChange={setShowSuspend} onConfirm={suspendSale} />
            <ParkedSalesSheet open={showParked} onOpenChange={setShowParked} branchId={activeBranchId} onResume={resumeDoc} refreshKey={docsRefreshKey} hasTicket={cart.length > 0} />
            <LayawaysSheet open={showLayaways} onOpenChange={setShowLayaways} branchId={activeBranchId} refreshKey={docsRefreshKey} autoOpenTicket={autoTicket} />
            <QuotesSheet open={showQuotes} onOpenChange={setShowQuotes} branchId={activeBranchId} onResume={resumeDoc} refreshKey={docsRefreshKey} hasTicket={cart.length > 0} />
            <ShortcutsHelpDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
            <SalesReturnsSheet
                open={showSalesHistory}
                onOpenChange={setShowSalesHistory}
                branchId={activeBranchId}
                refreshKey={docsRefreshKey}
                initialQuery={salesInitialQuery}
                onReturned={() => {
                    setDocsRefreshKey(k => k + 1)
                    if (activeBranchId) {
                        fetch(`/api/caja?branchId=${activeBranchId}`).then(r => r.ok ? r.json() : null).then(d => setCajaOpen(!!d?.active)).catch(() => {})
                    }
                }}
            />
        </div>
    )
}
