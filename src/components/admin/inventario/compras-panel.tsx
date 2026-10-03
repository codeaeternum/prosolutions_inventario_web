"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
import { EmptyState } from "@/components/admin/empty-state"
import { SugerirCompraPanel } from "@/components/admin/inventario/sugerir-compra-panel"
import { CompraDialog } from "@/components/admin/inventario/compra-dialog"
import { PagoProveedorDialog, SUPPLIER_METHOD_LABELS, type PendingPurchase } from "@/components/admin/inventario/pago-proveedor-dialog"
import { Banknote, CheckCircle2, Eye, Loader2, PackageCheck, Pencil, Plus, Send, ShoppingCart, X, XCircle } from "lucide-react"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"
import { toast } from "sonner"

type PurchaseStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED"
type PurchaseAction = "ORDER" | "RECEIVE" | "CANCEL"

interface SupplierPaymentRow {
    id: string
    amountCents: number
    method: string
    notes: string | null
    createdAt: string
    createdBy: { id: string; name: string } | null
}

interface PurchaseRow {
    id: string
    number: number
    status: PurchaseStatus
    notes: string | null
    totalCents: number
    paidCents: number
    dueAt: string | null
    paidAt: string | null
    receivedAt: string | null
    createdAt: string
    supplier: { id: string; name: string } | null
    branch: { id: string; name: string }
    createdBy: { id: string; name: string } | null
    items: {
        id: string
        quantity: number
        receivedQty: number
        unitCostCents: number
        product: { id: string; name: string; barcode: string | null }
    }[]
    supplierPayments: SupplierPaymentRow[]
}

interface SupplierOption { id: string; name: string }
interface BranchOption { id: string; name: string; isActive?: boolean }

const STATUS_CONFIG: Record<PurchaseStatus, { label: string; className: string }> = {
    DRAFT: { label: "Borrador", className: "bg-muted text-muted-foreground border-border" },
    ORDERED: { label: "Ordenada", className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300" },
    // Estados terminales en neutro: ya no piden acción (sin verde "sano" ni rojo "alerta").
    RECEIVED: { label: "Recibida", className: "bg-muted text-foreground border-border" },
    CANCELLED: { label: "Cancelada", className: "bg-muted text-muted-foreground border-border line-through" },
}

const STATUS_FILTERS = [
    { value: "ALL", label: "Todas" },
    { value: "DRAFT", label: "Borrador" },
    { value: "ORDERED", label: "Ordenadas" },
    { value: "RECEIVED", label: "Recibidas" },
    { value: "CANCELLED", label: "Canceladas" },
]

const ACTION_CONFIG: Record<PurchaseAction, { label: string; title: string; description: string }> = {
    ORDER: { label: "Ordenar", title: "¿Marcar como ordenada?", description: "Confirma que el pedido ya se hizo al proveedor. Aún no entra stock." },
    RECEIVE: { label: "Recibir", title: "¿Recibir la mercancía?", description: "El stock de todos los productos entrará a la sucursal de la orden y se actualizará el costo." },
    CANCEL: { label: "Cancelar compra", title: "¿Cancelar esta orden?", description: "La orden queda cancelada y no modifica stock. Esta acción no se puede deshacer." },
}

function folio(number: number) {
    return `OC-${String(number).padStart(6, "0")}`
}

/** ¿Se puede registrar un abono contra esta OC? (ORDERED|RECEIVED con saldo y proveedor). */
function isPayable(p: PurchaseRow) {
    return (p.status === "ORDERED" || p.status === "RECEIVED") && p.supplier !== null && p.totalCents - p.paidCents > 0
}

function toPendingPurchase(p: PurchaseRow): PendingPurchase {
    return {
        id: p.id,
        number: p.number,
        folio: folio(p.number),
        status: p.status,
        totalCents: p.totalCents,
        paidCents: p.paidCents,
        saldoCents: p.totalCents - p.paidCents,
        dueAt: p.dueAt,
    }
}

interface ComprasPanelProps {
    /**
     * Se dispara cuando la tarjeta de sugerencias agrega insumos a la lista de
     * compras del almacén (vive en la pestaña Encargos): el padre la remonta
     * con un refreshKey para que muestre los pendientes nuevos.
     */
    onNeedsChanged?: () => void
}

export function ComprasPanel({ onNeedsChanged }: ComprasPanelProps = {}) {
    const [purchases, setPurchases] = useState<PurchaseRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState("ALL")

    const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
    const [branches, setBranches] = useState<BranchOption[]>([])

    const [createOpen, setCreateOpen] = useState(false)
    const [editTarget, setEditTarget] = useState<PurchaseRow | null>(null)
    const [detail, setDetail] = useState<PurchaseRow | null>(null)
    const [payTarget, setPayTarget] = useState<PurchaseRow | null>(null)
    const [pending, setPending] = useState<{ purchase: PurchaseRow; action: PurchaseAction } | null>(null)
    const [acting, setActing] = useState(false)
    // Mini-form de recepción parcial por línea (purchaseItemId abierto + captura).
    const [receivingItem, setReceivingItem] = useState<string | null>(null)
    const [receiveQty, setReceiveQty] = useState("")
    const [receiving, setReceiving] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

    const fetchPurchases = useCallback(async (signal?: AbortSignal): Promise<PurchaseRow[] | null> => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== "ALL") params.set("status", statusFilter)
            const res = await fetch(`/api/purchases?${params}`, { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar compras")
            const rows = (data?.purchases ?? []) as PurchaseRow[]
            if (!signal?.aborted) setPurchases(rows)
            return rows
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar compras")
            return null
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [statusFilter])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchPurchases(controller.signal))
        return () => controller.abort()
    }, [fetchPurchases])

    // Catálogos del diálogo de creación (una sola vez).
    useEffect(() => {
        fetch("/api/suppliers").then(r => r.ok ? r.json() : null).then(d => {
            setSuppliers((d?.suppliers ?? []).filter((s: SupplierOption & { isActive?: boolean }) => s.isActive !== false))
        }).catch(() => {})
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            setBranches((d?.branches ?? []).filter((b: BranchOption) => b.isActive !== false))
        }).catch(() => {})
    }, [])

    const requestAction = (purchase: PurchaseRow, action: PurchaseAction) => setPending({ purchase, action })

    const confirmAction = async () => {
        if (!pending || acting) return
        const { purchase, action } = pending
        setActing(true)
        const payload = { action }
        // La huella incluye la OC: una llave retenida tras un fallo de red no se
        // reutiliza si el usuario confirma la misma acción sobre OTRA orden.
        operation.current = getClientOperationKey(operation.current, { ...payload, purchaseId: purchase.id })
        try {
            const res = await fetch(`/api/purchases/${purchase.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo actualizar la orden.")
            operation.current = null
            if (action === "RECEIVE") {
                toast.success("Stock recibido", { description: `Stock recibido en ${data?.branchName ?? purchase.branch.name}` })
            } else if (action === "ORDER") {
                toast.success(`Orden ${folio(purchase.number)} marcada como ordenada`)
            } else {
                toast.success(`Orden ${folio(purchase.number)} cancelada`)
            }
            setPending(null)
            void fetchPurchases()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta la misma acción.")
        } finally {
            setActing(false)
        }
    }

    const unitsOf = (p: PurchaseRow) => p.items.reduce((sum, i) => sum + i.quantity, 0)
    const receivedOf = (p: PurchaseRow) => p.items.reduce((sum, i) => sum + i.receivedQty, 0)

    /** Recepción parcial: POST { action: "RECEIVE_PARTIAL", items: […] } con la captura de UNA línea. */
    const submitPartialReceive = async (purchase: PurchaseRow, purchaseItemId: string, pendingQty: number) => {
        if (receiving) return
        // Number() (no parseInt): "1.5" se rechaza en vez de truncarse a 1.
        const qty = Number(receiveQty)
        if (!Number.isInteger(qty) || qty < 1 || qty > pendingQty) {
            toast.error(`Cantidad inválida: recibe entre 1 y ${pendingQty} unidades.`)
            return
        }
        setReceiving(true)
        const payload = { action: "RECEIVE_PARTIAL", items: [{ purchaseItemId, quantity: qty }] }
        operation.current = getClientOperationKey(operation.current, payload)
        try {
            const res = await fetch(`/api/purchases/${purchase.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo registrar la recepción.")
            operation.current = null
            if (data?.status === "RECEIVED") {
                toast.success(`Orden ${folio(purchase.number)} recibida completa`)
            } else {
                toast.success("Recepción parcial registrada", {
                    description: `Quedan ${data?.remaining ?? "?"} unidades pendientes`,
                })
            }
            setReceivingItem(null)
            const rows = await fetchPurchases()
            // El detalle sigue abierto: se refresca con la fila ya actualizada.
            setDetail(prev => (prev?.id === purchase.id ? rows?.find(r => r.id === purchase.id) ?? null : prev))
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta la misma acción.")
        } finally {
            setReceiving(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* Qué conviene pedir: stock bajo + encargos pendientes → lista de compras */}
            <SugerirCompraPanel onChanged={onNeedsChanged} />

            {/* Toolbar: acción primaria primero; el filtro queda como control secundario */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva compra
                </Button>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-44">
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                        {STATUS_FILTERS.map(f => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {error ? (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{error}</p>
                    <Button variant="outline" onClick={() => void fetchPurchases()}>Reintentar</Button>
                </div>
            ) : loading && purchases.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : purchases.length === 0 ? (
                <EmptyState
                    icon={ShoppingCart}
                    title="No hay órdenes de compra"
                    description={statusFilter !== "ALL"
                        ? "Prueba con otro filtro de estado."
                        : "Registra la primera orden de compra para dar entrada al stock del proveedor al recibirla."}
                />
            ) : (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                            Órdenes de compra
                        </CardTitle>
                        <CardDescription>
                            Al recibir una orden, las unidades entran a la sucursal indicada
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Folio</TableHead>
                                        <TableHead className="hidden md:table-cell">Proveedor</TableHead>
                                        <TableHead className="hidden lg:table-cell">Sucursal</TableHead>
                                        <TableHead className="text-center">Productos</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="hidden sm:table-cell">Fecha</TableHead>
                                        <TableHead className="text-right">
                                            <span className="sr-only">Acciones</span>
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {purchases.map(p => {
                                        const config = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.DRAFT
                                        return (
                                            <TableRow key={p.id} className={loading ? "opacity-60" : ""}>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {folio(p.number)}
                                                    {p.supplier && (
                                                        <p className="text-xs text-muted-foreground md:hidden">{p.supplier.name}</p>
                                                    )}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell">
                                                    {p.supplier?.name ?? <span className="text-muted-foreground">—</span>}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell">{p.branch.name}</TableCell>
                                                <TableCell className="text-center tabular-nums">
                                                    {p.items.length} · {unitsOf(p)} ud
                                                </TableCell>
                                                <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                                                    {formatPrice(p.totalCents / 100)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap gap-1">
                                                        <Badge variant="outline" className={config.className}>
                                                            {config.label}
                                                        </Badge>
                                                        {p.status === "ORDERED" && receivedOf(p) > 0 && (
                                                            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">
                                                                Parcial {receivedOf(p)}/{unitsOf(p)} ud
                                                            </Badge>
                                                        )}
                                                        {p.totalCents > 0 && p.paidCents >= p.totalCents && (
                                                            <Badge variant="secondary">
                                                                Pagada
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground whitespace-nowrap">
                                                    {formatDate(p.createdAt)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() => setDetail(p)}
                                                            title={`Ver detalle de ${folio(p.number)}`}
                                                            aria-label={`Ver detalle de ${folio(p.number)}`}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        {p.status === "DRAFT" && (
                                                            <>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8"
                                                                    onClick={() => setEditTarget(p)}
                                                                    title={`Editar ${folio(p.number)}`}
                                                                    aria-label={`Editar ${folio(p.number)}`}
                                                                >
                                                                    <Pencil className="h-4 w-4" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-blue-600"
                                                                    onClick={() => requestAction(p, "ORDER")}
                                                                    title="Marcar como ordenada"
                                                                    aria-label="Marcar como ordenada"
                                                                >
                                                                    <Send className="h-4 w-4" />
                                                                </Button>
                                                            </>
                                                        )}
                                                        {p.status === "ORDERED" && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-green-600"
                                                                onClick={() => requestAction(p, "RECEIVE")}
                                                                title="Recibir mercancía (entra stock)"
                                                                aria-label="Recibir mercancía"
                                                            >
                                                                <PackageCheck className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        {isPayable(p) && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-amber-600"
                                                                onClick={() => setPayTarget(p)}
                                                                title={`Registrar pago (saldo ${formatPrice((p.totalCents - p.paidCents) / 100)})`}
                                                                aria-label={`Registrar pago de ${folio(p.number)}`}
                                                            >
                                                                <Banknote className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        {(p.status === "DRAFT" || p.status === "ORDERED") && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-red-600"
                                                                onClick={() => requestAction(p, "CANCEL")}
                                                                title="Cancelar orden"
                                                                aria-label="Cancelar orden"
                                                            >
                                                                <XCircle className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <CompraDialog
                suppliers={suppliers}
                branches={branches}
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSaved={() => void fetchPurchases()}
            />

            {/* Edición de borrador (mismo diálogo, modo PATCH) */}
            <CompraDialog
                suppliers={suppliers}
                branches={branches}
                open={editTarget !== null}
                onOpenChange={(open) => { if (!open) setEditTarget(null) }}
                onSaved={() => void fetchPurchases()}
                purchase={editTarget}
            />

            {/* Abono ligado a esta OC */}
            <PagoProveedorDialog
                open={payTarget !== null}
                onOpenChange={(open) => { if (!open) setPayTarget(null) }}
                supplier={payTarget?.supplier ?? null}
                purchases={payTarget ? [toPendingPurchase(payTarget)] : []}
                fixedPurchase={payTarget ? toPendingPurchase(payTarget) : null}
                onSaved={() => void fetchPurchases()}
            />

            {/* Detalle de la orden */}
            <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) { setDetail(null); setReceivingItem(null) } }}>
                <DialogContent className="sm:max-w-lg">
                    {detail && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                                    {folio(detail.number)}
                                    <Badge variant="outline" className={STATUS_CONFIG[detail.status].className}>
                                        {STATUS_CONFIG[detail.status].label}
                                    </Badge>
                                </DialogTitle>
                                <DialogDescription>
                                    {detail.supplier?.name ?? "Sin proveedor"} · {detail.branch.name} · {formatDate(detail.createdAt)}
                                    {detail.createdBy ? ` · ${detail.createdBy.name}` : ""}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="rounded-md border divide-y">
                                {detail.items.map(item => {
                                    const pendingQty = item.quantity - item.receivedQty
                                    return (
                                        <div key={item.id} className="p-3 flex justify-between items-center gap-3">
                                            <div className="min-w-0">
                                                <p className="font-medium text-sm truncate">{item.product.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {item.product.barcode || "Sin código"}
                                                    {detail.status === "ORDERED" && ` · Recibidas ${item.receivedQty}/${item.quantity} ud`}
                                                </p>
                                            </div>
                                            <div className="text-right shrink-0 text-sm tabular-nums">
                                                {item.quantity} × {formatPrice(item.unitCostCents / 100)} ={" "}
                                                <span className="font-medium">{formatPrice(item.quantity * item.unitCostCents / 100)}</span>
                                                {detail.status === "ORDERED" && pendingQty > 0 && (
                                                    receivingItem === item.id ? (
                                                        <form
                                                            className="mt-1 flex items-center justify-end gap-1"
                                                            onSubmit={e => { e.preventDefault(); void submitPartialReceive(detail, item.id, pendingQty) }}
                                                        >
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                max={pendingQty}
                                                                inputMode="numeric"
                                                                value={receiveQty}
                                                                onChange={e => setReceiveQty(e.target.value)}
                                                                className="h-7 w-20 text-right tabular-nums"
                                                                autoFocus
                                                                disabled={receiving}
                                                                aria-label={`Cantidad a recibir de ${item.product.name}`}
                                                            />
                                                            <Button type="submit" size="sm" className="h-7 px-2" disabled={receiving}>
                                                                {receiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "OK"}
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 px-2"
                                                                onClick={() => setReceivingItem(null)}
                                                                disabled={receiving}
                                                                title="Dejar de capturar"
                                                                aria-label="Dejar de capturar la recepción parcial"
                                                            >
                                                                <X className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </form>
                                                    ) : (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            className="mt-1 h-7"
                                                            onClick={() => { setReceivingItem(item.id); setReceiveQty(String(pendingQty)) }}
                                                        >
                                                            Recibir
                                                        </Button>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="flex justify-between items-center pt-1">
                                <span className="text-sm text-muted-foreground">
                                    {detail.receivedAt ? `Recibida ${formatDate(detail.receivedAt)}` : `${unitsOf(detail)} unidades`}
                                </span>
                                <span className="font-semibold tabular-nums">Total: {formatPrice(detail.totalCents / 100)}</span>
                            </div>

                            {/* Cuenta por pagar de la OC */}
                            {detail.supplier && (detail.status === "ORDERED" || detail.status === "RECEIVED") && (
                                <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                                    <div className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">Pagado</span>
                                        <span className="tabular-nums">{formatPrice(detail.paidCents / 100)}</span>
                                    </div>
                                    <div className="flex justify-between gap-2">
                                        <span className="text-muted-foreground">Saldo</span>
                                        <span className={`font-medium tabular-nums ${detail.totalCents - detail.paidCents > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                                            {detail.totalCents - detail.paidCents > 0
                                                ? formatPrice((detail.totalCents - detail.paidCents) / 100)
                                                : "Liquidada"}
                                        </span>
                                    </div>
                                    {detail.dueAt && detail.totalCents - detail.paidCents > 0 && (
                                        <p className={`text-xs ${new Date(detail.dueAt) < new Date() ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                            Promesa de pago: {formatDay(detail.dueAt)}
                                        </p>
                                    )}
                                    {detail.paidAt && (
                                        <p className="text-xs text-muted-foreground">Liquidada el {formatDay(detail.paidAt)}</p>
                                    )}
                                </div>
                            )}

                            {/* Abonos ligados a esta OC */}
                            {detail.supplierPayments.length > 0 && (
                                <div className="rounded-md border divide-y max-h-40 overflow-y-auto">
                                    {detail.supplierPayments.map(p => (
                                        <div key={p.id} className="px-3 py-2 flex justify-between items-center gap-3 text-sm">
                                            <div className="min-w-0">
                                                <p className="font-medium">{SUPPLIER_METHOD_LABELS[p.method] ?? p.method}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {formatDate(p.createdAt)}{p.createdBy ? ` · ${p.createdBy.name}` : ""}
                                                    {p.notes ? ` · ${p.notes}` : ""}
                                                </p>
                                            </div>
                                            <span className="tabular-nums font-medium shrink-0">{formatPrice(p.amountCents / 100)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {detail.notes && (
                                <p className="text-sm text-muted-foreground border rounded-md p-3">{detail.notes}</p>
                            )}
                            <div className="flex justify-end gap-2 pt-1">
                                {isPayable(detail) && (
                                    <Button variant="outline" onClick={() => { setDetail(null); setPayTarget(detail) }}>
                                        <Banknote className="mr-2 h-4 w-4" /> Pagar
                                    </Button>
                                )}
                                {detail.status === "DRAFT" && (
                                    <>
                                        <Button variant="outline" onClick={() => { setEditTarget(detail); setDetail(null) }}>
                                            <Pencil className="mr-2 h-4 w-4" /> Editar
                                        </Button>
                                        <Button onClick={() => { setDetail(null); requestAction(detail, "ORDER") }}>
                                            <Send className="mr-2 h-4 w-4" /> Ordenar
                                        </Button>
                                    </>
                                )}
                                {detail.status === "ORDERED" && (
                                    <Button onClick={() => { setDetail(null); requestAction(detail, "RECEIVE") }}>
                                        <CheckCircle2 className="mr-2 h-4 w-4" /> Recibir mercancía
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Confirmación de cambio de estado */}
            <AlertDialog open={pending !== null} onOpenChange={(open) => { if (!open && !acting) setPending(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {pending ? `${ACTION_CONFIG[pending.action].title} (${folio(pending.purchase.number)})` : ""}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {pending ? ACTION_CONFIG[pending.action].description : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={acting}>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            variant={pending?.action === "CANCEL" ? "destructive" : "default"}
                            onClick={(e) => { e.preventDefault(); void confirmAction() }}
                            disabled={acting}
                        >
                            {acting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {pending ? ACTION_CONFIG[pending.action].label : "Confirmar"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
