"use client"

import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { useState, useEffect, useRef, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
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
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog"
import { Pagination } from "@/components/ui/pagination"
import { EmptyState } from "@/components/admin/empty-state"
import {
    Loader2,
    Printer,
    Share2,
    Undo2,
    MoreHorizontal,
    SlidersHorizontal,
    X,
    History,
    ShoppingCart,
    PackagePlus,
    PackageMinus,
    PackageX,
    PackageSearch,
    ArrowLeftRight,
    Scale,
    Ban,
    RotateCcw,
    CircleDashed,
    type LucideIcon,
} from "lucide-react"
import { cn, formatDate, formatDay, formatPrice } from "@/lib/utils"
import { toast } from "sonner"

interface Movement {
    id: string
    type: string
    quantity: number
    returnableQuantity: number
    previousStock: number
    newStock: number
    reason: string | null
    /** Marca interna ("merma:damaged", "merma:lost") con que la API distingue
        el subtipo de una salida — el enum MovementType no tiene DAMAGED/LOST. */
    notes?: string | null
    /** Presente solo en ventas POS; una salida sin paymentMethod es merma/uso. */
    paymentMethod?: string | null
    unitPrice: number | null
    totalPrice: number | null
    createdAt: string
    source?: string
    product: {
        id: string
        name: string
        /** La API lo expone porque este tab ya exige módulo inventario. */
        costPrice?: number | null
    }
    user: {
        id: string
        name: string
        role?: string
    } | null
    branch?: { id: string; name: string } | null
    toBranch?: { id: string; name: string } | null
}

// Valores que acepta ?type= en /api/inventory. "Ajuste (+)/(−)" se fusionó en
// "Ajustes": la API mapeaba ambos a ADJUSTMENT y devolvía lo mismo.
const movementTypes = [
    { value: "ALL", label: "Todos" },
    { value: "SALE", label: "Ventas" },
    { value: "CANCELLED", label: "Reservas canceladas" },
    { value: "IN", label: "Entradas" },
    { value: "OUT", label: "Salidas" },
    { value: "TRANSFER", label: "Traspasos" },
    { value: "ADJUSTMENT", label: "Ajustes" },
    { value: "RETURN", label: "Devoluciones" },
    { value: "MERMAS", label: "Mermas" },
    { value: "DAMAGED", label: "Dañado" },
    { value: "LOST", label: "Perdido" },
]

interface TypeVisual {
    label: string
    icon: LucideIcon
    badge: string
}

const MUTED_BADGE = "bg-muted text-muted-foreground"
const LOSS_BADGE = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"

/** Lenguaje visual por tipo: icono fijo + badge. Lo cotidiano (venta,
    entrada, traspaso, ajuste) va apagado y el color se reserva a lo que
    conviene revisar — mermas, reservas canceladas y devoluciones. */
const TYPE_VISUALS: Record<string, TypeVisual> = {
    SALE: { label: "Venta", icon: ShoppingCart, badge: MUTED_BADGE },
    IN: { label: "Entrada", icon: PackagePlus, badge: MUTED_BADGE },
    OUT: { label: "Salida", icon: PackageMinus, badge: LOSS_BADGE },
    DAMAGED: { label: "Dañado", icon: PackageX, badge: LOSS_BADGE },
    LOST: { label: "Perdido", icon: PackageSearch, badge: LOSS_BADGE },
    TRANSFER: { label: "Traspaso", icon: ArrowLeftRight, badge: MUTED_BADGE },
    ADJUSTMENT: { label: "Ajuste", icon: Scale, badge: MUTED_BADGE },
    RETURN: { label: "Devolución", icon: RotateCcw, badge: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
    CANCELLED: { label: "Reserva cancelada", icon: Ban, badge: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
}

const typeVisual = (mov: Movement): TypeVisual => {
    if (mov.type === "OUT") {
        if (mov.notes?.startsWith("merma:damaged")) return TYPE_VISUALS.DAMAGED
        if (mov.notes?.startsWith("merma:lost")) return TYPE_VISUALS.LOST
    }
    const visual = TYPE_VISUALS[mov.type]
    return visual ?? { label: mov.type, icon: CircleDashed, badge: "bg-muted text-foreground" }
}

/** Signo por delta real de stock (newStock − previousStock): un ajuste puede
    sumar o restar, mientras que traspasos y reservas canceladas no cambian el
    stock total del negocio → "±" apagado. Las salidas sin venta (mermas, uso
    interno) son la única pérdida que se pinta de rojo.
    Ojo: las reservas llegan con prev/new en 0 — ahí el delta no informa y el
    tipo decide (una reserva COMPLETED es una venta: el stock salió). */
const qtyDisplay = (mov: Movement): { text: string; cls: string } => {
    const delta = mov.newStock - mov.previousStock
    if (delta > 0) return { text: `+${mov.quantity}`, cls: "text-emerald-600 dark:text-emerald-400" }
    if (delta < 0 || mov.type === "SALE") {
        const isLoss = mov.type === "OUT" && !mov.paymentMethod
        return { text: `-${mov.quantity}`, cls: isLoss ? "text-red-600 dark:text-red-400" : "text-foreground" }
    }
    return { text: `±${mov.quantity}`, cls: "text-muted-foreground" }
}

const branchLabel = (mov: Movement) =>
    mov.type === "TRANSFER" && mov.toBranch
        ? `${mov.branch?.name ?? "—"} → ${mov.toBranch.name}`
        : mov.branch?.name ?? "—"

/** Acciones disponibles por fila: hoy solo las ventas/devoluciones tienen
    ticket, WhatsApp o devolución vinculada. */
const hasActions = (mov: Movement) => mov.type === "SALE" || mov.type === "RETURN"

// Relativo para lo reciente ("hace 5 min"), fecha para lo viejo — mismo
// criterio que actividad-panel. `now` viene de estado porque Date.now()
// durante render está prohibido (react-hooks/purity).
const formatWhen = (iso: string, now: number | null): string => {
    if (now === null) return formatDate(iso)
    const diffMin = Math.floor((now - new Date(iso).getTime()) / 60000)
    if (diffMin < 0) return formatDate(iso) // reloj del cliente adelantado al server
    if (diffMin < 1) return "ahora"
    if (diffMin < 60) return `hace ${diffMin} min`
    const hours = Math.floor(diffMin / 60)
    if (hours < 24) return `hace ${hours} h`
    const days = Math.floor(hours / 24)
    if (days < 7) return `hace ${days} d`
    return formatDay(iso)
}

interface HistorialMovimientosProps {
    /** Al venir de la lista de stock: filtra el feed a un solo producto. */
    productId?: string | null
    productName?: string | null
    onClearProduct?: () => void
}

export function HistorialMovimientos({ productId, productName, onClearProduct }: HistorialMovimientosProps = {}) {
    const [loading, setLoading] = useState(false)
    const [movements, setMovements] = useState<Movement[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit] = useState(20)
    // Marca de tiempo de la última carga para el "hace N min" (ver formatWhen).
    const [now, setNow] = useState<number | null>(null)

    // Filters — solo lo que la API acepta: type, branchId, productId.
    const [typeFilter, setTypeFilter] = useState<string>("ALL")
    const [branchFilter, setBranchFilter] = useState<string>("ALL")
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
    const [filtersOpen, setFiltersOpen] = useState(false)

    // Return dialog
    const [returnDialogOpen, setReturnDialogOpen] = useState(false)
    const returnOperation = useRef<ClientOperationKey | null>(null)
    const [returnTarget, setReturnTarget] = useState<Movement | null>(null)
    const [returnQty, setReturnQty] = useState("1")
    const [returnReason, setReturnReason] = useState("")
    const [returningInProgress, setReturningInProgress] = useState(false)

    // Actions menu (mobile-friendly popover alternative)
    const [actionsOpenId, setActionsOpenId] = useState<string | null>(null)

    const fetchMovements = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            params.set("limit", limit.toString())
            params.set("offset", ((page - 1) * limit).toString())

            if (typeFilter !== "ALL") {
                params.set("type", typeFilter)
            }
            if (branchFilter !== "ALL") {
                params.set("branchId", branchFilter)
            }
            if (productId) {
                params.set("productId", productId)
            }

            const res = await fetch(`/api/inventory?${params.toString()}`)
            const data = await res.json()

            if (res.ok) {
                setMovements(data.movements)
                setTotal(typeof data.total === "number" ? data.total : data.movements.length)
                setNow(Date.now())
            } else {
                toast.error(data?.error || "No se pudieron cargar los movimientos")
            }
        } catch (error) {
            console.error("Error fetching movements:", error)
            toast.error("No se pudieron cargar los movimientos")
        } finally {
            setLoading(false)
        }
    }, [page, typeFilter, branchFilter, productId, limit])

    useEffect(() => {
        // Diferido a un callback: setState sincrónico en el cuerpo del efecto está prohibido.
        void Promise.resolve().then(fetchMovements)
    }, [fetchMovements])

    // Al entrar un filtro de producto la paginación anterior ya no aplica.
    useEffect(() => {
        void Promise.resolve().then(() => setPage(1))
    }, [productId])

    useEffect(() => {
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            setBranches((d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive))
        }).catch(() => {})
    }, [])

    // Cambiar de filtro reinicia a la primera página — con la página vieja el
    // offset podría caer más allá del total filtrado y mostrar lista vacía.
    const applyTypeFilter = (value: string) => { setTypeFilter(value); setPage(1) }
    const applyBranchFilter = (value: string) => { setBranchFilter(value); setPage(1) }

    const activeFilterCount = (typeFilter !== "ALL" ? 1 : 0) + (branchFilter !== "ALL" ? 1 : 0) + (productId ? 1 : 0)
    const hasActiveFilters = activeFilterCount > 0
    const clearFilters = () => {
        setTypeFilter("ALL")
        setBranchFilter("ALL")
        onClearProduct?.()
        setPage(1)
    }

    const reasonLabels: Record<string, string> = {
        ADJUSTMENT: "Ajuste",
        ADJUSTMENT_IN: "Ajuste de entrada",
        ADJUSTMENT_OUT: "Ajuste de salida",
        SALE: "Venta",
        RETURN: "Devolución",
        TRANSFER: "Traspaso",
        DAMAGED: "Dañado",
        LOST: "Perdido",
    }
    const displayReason = (reason: string | null) => {
        if (!reason) return null
        if (reasonLabels[reason]) return reasonLabels[reason]
        // Referencias crudas ("Reserva temporal #tjn5eq7e") → solo la parte
        // legible; el texto completo sigue disponible en el tooltip (title).
        return reason.replace(/\s*#\w{5,}\s*$/, "")
    }

    // El usuario ligado al movimiento puede ser la cuenta cliente que reservó
    // (rol CUSTOMER) — se muestra como "Cliente: nombre" para no confundirlo
    // con un empleado; sin usuario = acción del sistema (cron, auto).
    const displayUser = (mov: Movement) => {
        if (!mov.user?.name) return "Sistema"
        if (mov.user.role === "CUSTOMER") return `Cliente: ${mov.user.name}`
        return mov.user.name
    }

    const handleReturn = async () => {
        if (!returnTarget || returningInProgress) return
        const qty = parseInt(returnQty)
        if (!qty || qty < 1 || qty > returnTarget.returnableQuantity) {
            toast.error(`Cantidad inválida (máx: ${returnTarget.returnableQuantity})`)
            return
        }

        setReturningInProgress(true)
        try {
            const payload = {
                productId: returnTarget.product.id, type: "RETURN", quantity: qty,
                reason: returnReason || `Devolución de venta ${returnTarget.id.substring(0, 8)}`,
                ...(returnTarget.source === "RESERVATION" ? { reservationId: returnTarget.id } : { relatedId: returnTarget.id }),
            }
            returnOperation.current = getClientOperationKey(returnOperation.current, payload)
            const res = await fetch("/api/inventory", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: returnOperation.current.key }),
            })

            if (res.ok) {
                returnOperation.current = null
                toast.success(`Devolución registrada: ${qty} ud(s) de ${returnTarget.product.name}`)
                setReturnDialogOpen(false)
                setReturnTarget(null)
                setReturnQty("1")
                setReturnReason("")
                fetchMovements()
            } else {
                const data = await res.json().catch(() => null)
                toast.error(data?.error || "Error al procesar devolución")
            }
        } catch {
            toast.error("Error de conexión")
        } finally {
            setReturningInProgress(false)
        }
    }

    const handleShareWhatsApp = (mov: Movement) => {
        const config = typeVisual(mov)
        let text = `*PROSOLUTIONS - ${config.label}*\n`
        text += `Folio: ${mov.id.substring(0, 8)}\n`
        text += `Fecha: ${formatDate(mov.createdAt)}\n`
        if (mov.user?.name) text += `Atendió: ${displayUser(mov)}\n`
        text += `------------------------\n`
        text += `${mov.quantity}x ${mov.product?.name || "Producto"}`
        if (mov.unitPrice) text += ` - ${formatPrice(mov.unitPrice)}`
        text += `\n`
        text += `------------------------\n`
        if (mov.totalPrice) text += `*TOTAL: ${formatPrice(mov.totalPrice)}*\n`
        if (mov.reason) text += `Motivo: ${mov.reason}\n`
        text += `\n¡Gracias por tu preferencia!`

        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    }

    // Menú "⋯" compartido por la fila de tabla (desktop) y la tarjeta (móvil):
    // solo se renderiza si el movimiento tiene alguna acción real.
    const renderActionsMenu = (mov: Movement) => {
        if (!hasActions(mov)) return null
        const isActionsOpen = actionsOpenId === mov.id
        const close = () => setActionsOpenId(null)
        return (
            <div className="relative inline-block">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setActionsOpenId(isActionsOpen ? null : mov.id)}
                    title="Acciones"
                    aria-label={`Acciones del movimiento ${mov.id.substring(0, 8)}`}
                    aria-haspopup="menu"
                    aria-expanded={isActionsOpen}
                >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>

                {isActionsOpen && (
                    <>
                        {/* Overlay to close on click outside */}
                        <div className="fixed inset-0 z-40" aria-hidden="true" onClick={close} />
                        <div
                            role="menu"
                            aria-label="Acciones del movimiento"
                            className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px]"
                            onKeyDown={(e) => { if (e.key === "Escape") close() }}
                        >
                            {/* Print Ticket */}
                            <a
                                role="menuitem"
                                href={mov.source === "RESERVATION" ? `/admin/tickets/reserva/${mov.id}` : `/admin/tickets/venta/${mov.id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted w-full text-left"
                                onClick={close}
                            >
                                <Printer className="h-4 w-4" aria-hidden="true" />
                                Reimprimir Ticket
                            </a>

                            {/* WhatsApp Share */}
                            <button
                                role="menuitem"
                                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted w-full text-left"
                                onClick={() => {
                                    handleShareWhatsApp(mov)
                                    close()
                                }}
                            >
                                <Share2 className="h-4 w-4" aria-hidden="true" />
                                Enviar por WhatsApp
                            </button>

                            {/* Return — solo queda saldo por devolver */}
                            {mov.type === "SALE" && (
                                <button
                                    role="menuitem"
                                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted w-full text-left text-yellow-600 disabled:pointer-events-none disabled:opacity-50"
                                    disabled={mov.returnableQuantity <= 0}
                                    onClick={() => {
                                        setReturnTarget(mov)
                                        setReturnQty(String(Math.min(mov.quantity, mov.returnableQuantity)))
                                        setReturnDialogOpen(true)
                                        close()
                                    }}
                                >
                                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                                    Devolver
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Historial</CardTitle>
                    <CardDescription>
                        Entradas, salidas, mermas, traspasos, conteos y devoluciones
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* ── Filtros: la API solo acepta type, branchId y productId
                        (chip). En móvil se colapsan tras "Filtros" con el
                        conteo de activos, igual que en Stock ── */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant={filtersOpen ? "secondary" : "outline"}
                                size="sm"
                                className="h-9 shrink-0 gap-1.5 sm:hidden"
                                onClick={() => setFiltersOpen((o) => !o)}
                                aria-expanded={filtersOpen}
                                aria-controls="historial-filtros"
                            >
                                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                                Filtros
                                {activeFilterCount > 0 && (
                                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
                                        {activeFilterCount}
                                    </span>
                                )}
                            </Button>
                            {/* Chip del producto filtrado (se llega desde el
                                botón de historial en Stock): siempre visible
                                para que se note que la lista está acotada */}
                            {productId && (
                                <Badge variant="secondary" className="gap-1 pr-1 max-w-full">
                                    <span className="min-w-0 truncate">Producto: {productName ?? productId}</span>
                                    {onClearProduct && (
                                        <button
                                            type="button"
                                            onClick={onClearProduct}
                                            className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-destructive/15 hover:text-destructive"
                                            aria-label={`Quitar filtro de producto ${productName ?? productId}`}
                                        >
                                            <X className="h-3 w-3" aria-hidden="true" />
                                        </button>
                                    )}
                                </Badge>
                            )}
                            {loading && movements.length > 0 && (
                                <span role="status">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                                    <span className="sr-only">Actualizando movimientos…</span>
                                </span>
                            )}
                        </div>
                        <div
                            id="historial-filtros"
                            className={cn(
                                "gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center",
                                filtersOpen ? "flex flex-col" : "hidden sm:flex"
                            )}
                        >
                            <Select value={typeFilter} onValueChange={applyTypeFilter}>
                                <SelectTrigger className="w-full sm:w-48" aria-label="Filtrar por tipo de movimiento">
                                    <SelectValue placeholder="Tipo" />
                                </SelectTrigger>
                                <SelectContent>
                                    {movementTypes.map((t) => (
                                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {branches.length > 0 && (
                                <Select value={branchFilter} onValueChange={applyBranchFilter}>
                                    <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por sucursal">
                                        <SelectValue placeholder="Sucursal" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Todas las sucursales</SelectItem>
                                        {branches.map(b => (
                                            <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                            {hasActiveFilters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 gap-1.5 self-start sm:self-center"
                                    onClick={clearFilters}
                                >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                    Limpiar filtros
                                </Button>
                            )}
                        </div>
                    </div>

                    <div aria-busy={loading}>
                        {loading && movements.length === 0 ? (
                            <div className="flex h-40 items-center justify-center" role="status">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                                <span className="sr-only">Cargando movimientos…</span>
                            </div>
                        ) : movements.length === 0 ? (
                            <EmptyState
                                icon={History}
                                title="Sin movimientos"
                                description={hasActiveFilters
                                    ? "Ningún movimiento coincide con los filtros activos. Prueba limpiarlos."
                                    : "Las entradas, salidas, mermas y ventas que registres van a aparecer aquí."}
                            />
                        ) : (
                            <>
                                {/* Desktop: tabla con encabezado fijo — el wrapper
                                    del Table (overflow-auto) recibe la altura máxima
                                    y los th quedan pegados arriba al hacer scroll */}
                                <div className="hidden rounded-md border md:block [&>div]:max-h-[70vh]">
                                    <Table>
                                        <TableCaption className="sr-only">
                                            Historial de movimientos de inventario
                                        </TableCaption>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card whitespace-nowrap">Fecha</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card">Tipo</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card">Producto</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card text-right">Cant.</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card text-right">Precio Unit.</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card text-right">Total</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card">Usuario</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card">Sucursal</TableHead>
                                                <TableHead className="sticky top-0 z-10 border-b bg-card w-[60px] text-right"><span className="sr-only">Acciones</span></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {movements.map((mov) => {
                                                const config = typeVisual(mov)
                                                const qty = qtyDisplay(mov)
                                                const reason = displayReason(mov.reason)
                                                return (
                                                    <TableRow key={mov.id}>
                                                        <TableCell className="font-medium whitespace-nowrap">
                                                            <time dateTime={mov.createdAt} title={formatDate(mov.createdAt)}>
                                                                {formatWhen(mov.createdAt, now)}
                                                            </time>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="secondary" className={cn("gap-1 whitespace-nowrap", config.badge)}>
                                                                <config.icon className="h-3 w-3" aria-hidden="true" />
                                                                {config.label}
                                                            </Badge>
                                                            {reason && (
                                                                <p className="text-xs text-muted-foreground mt-1 max-w-[150px] truncate" title={reason}>
                                                                    {reason}
                                                                </p>
                                                            )}
                                                        </TableCell>
                                                        <TableCell>{mov.product?.name || "Producto eliminado"}</TableCell>
                                                        <TableCell className={cn("text-right font-medium tabular-nums whitespace-nowrap", qty.cls)}>
                                                            {qty.text}
                                                        </TableCell>
                                                        <TableCell className="text-right whitespace-nowrap">
                                                            {mov.unitPrice ? formatPrice(mov.unitPrice) : "-"}
                                                            {mov.product?.costPrice != null && (
                                                                <p className="text-xs font-normal text-muted-foreground" title="Precio de costo (solo visible para inventario)">
                                                                    Costo {formatPrice(mov.product.costPrice)}
                                                                </p>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium whitespace-nowrap">
                                                            {mov.totalPrice ? formatPrice(mov.totalPrice) : "-"}
                                                        </TableCell>
                                                        <TableCell>
                                                            {displayUser(mov)}
                                                        </TableCell>
                                                        <TableCell className="text-sm text-muted-foreground">
                                                            {branchLabel(mov)}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {renderActionsMenu(mov)}
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>

                                {/* Móvil: cada movimiento como tarjeta apilada —
                                    badge + cantidad arriba, meta y acciones abajo */}
                                <ul className="space-y-3 md:hidden">
                                    {movements.map((mov) => {
                                        const config = typeVisual(mov)
                                        const qty = qtyDisplay(mov)
                                        const reason = displayReason(mov.reason)
                                        return (
                                            <li key={mov.id} className="rounded-lg border bg-card p-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <Badge variant="secondary" className={cn("gap-1 whitespace-nowrap", config.badge)}>
                                                            <config.icon className="h-3 w-3" aria-hidden="true" />
                                                            {config.label}
                                                        </Badge>
                                                        <p className="mt-1.5 font-medium leading-snug">
                                                            {mov.product?.name || "Producto eliminado"}
                                                        </p>
                                                    </div>
                                                    <span className={cn("shrink-0 tabular-nums text-base font-semibold", qty.cls)}>
                                                        {qty.text}
                                                    </span>
                                                </div>
                                                {reason && (
                                                    <p className="mt-1 text-xs text-muted-foreground" title={reason}>
                                                        {reason}
                                                    </p>
                                                )}
                                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                                    <time dateTime={mov.createdAt} title={formatDate(mov.createdAt)}>
                                                        {formatWhen(mov.createdAt, now)}
                                                    </time>
                                                    <span>{displayUser(mov)}</span>
                                                    <span className="min-w-0 truncate">{branchLabel(mov)}</span>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
                                                    <div className="min-w-0 text-sm">
                                                        {mov.totalPrice ? (
                                                            <span className="font-medium">{formatPrice(mov.totalPrice)}</span>
                                                        ) : null}
                                                        {mov.unitPrice ? (
                                                            <span className="text-xs text-muted-foreground">
                                                                {mov.totalPrice ? " · " : ""}{formatPrice(mov.unitPrice)} c/u
                                                            </span>
                                                        ) : null}
                                                        {mov.product?.costPrice != null && (
                                                            <span className="text-xs text-muted-foreground">
                                                                {(mov.totalPrice || mov.unitPrice) ? " · " : ""}costo {formatPrice(mov.product.costPrice)}
                                                            </span>
                                                        )}
                                                        {!mov.totalPrice && !mov.unitPrice && mov.product?.costPrice == null && (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </div>
                                                    {renderActionsMenu(mov)}
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </>
                        )}
                    </div>

                    {total > 0 && (
                        <div className="pt-2">
                            <Pagination
                                page={page}
                                limit={limit}
                                total={total}
                                totalPages={Math.max(1, Math.ceil(total / limit))}
                                onPageChange={setPage}
                                disabled={loading}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Return Dialog */}
            <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Registrar Devolución</DialogTitle>
                        <DialogDescription>
                            Se devolverá stock al inventario y se registrará la salida de dinero en caja (si está abierta).
                        </DialogDescription>
                    </DialogHeader>

                    {returnTarget && (
                        <div className="space-y-4">
                            <div className="bg-muted rounded-lg p-3 space-y-1">
                                <p className="font-medium">{returnTarget.product?.name}</p>
                                <p className="text-sm text-muted-foreground">
                                    Venta original: {returnTarget.quantity} ud(s)
                                    {returnTarget.totalPrice ? ` — ${formatPrice(returnTarget.totalPrice)}` : ""}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="returnQty">Cantidad a devolver (máx: {returnTarget.returnableQuantity})</Label>
                                <Input
                                    id="returnQty"
                                    type="number"
                                    min="1"
                                    max={returnTarget.returnableQuantity}
                                    value={returnQty}
                                    onChange={(e) => setReturnQty(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="returnReason">Motivo de la devolución</Label>
                                <Input
                                    id="returnReason"
                                    value={returnReason}
                                    onChange={(e) => setReturnReason(e.target.value)}
                                    placeholder="Ej: Producto defectuoso, error en la venta..."
                                />
                            </div>

                            {returnTarget.unitPrice && (
                                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                                        Monto a devolver: {formatPrice(returnTarget.unitPrice * (parseInt(returnQty) || 0))}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleReturn} disabled={returningInProgress} className="gap-2">
                            {returningInProgress && <Loader2 className="h-4 w-4 animate-spin" />}
                            <Undo2 className="h-4 w-4" />
                            Confirmar Devolución
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
