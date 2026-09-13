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
import { CompraDialog } from "@/components/admin/inventario/compra-dialog"
import { CheckCircle2, Eye, Loader2, PackageCheck, Plus, Send, ShoppingCart, XCircle } from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"
import { toast } from "sonner"

type PurchaseStatus = "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED"
type PurchaseAction = "ORDER" | "RECEIVE" | "CANCEL"

interface PurchaseRow {
    id: string
    number: number
    status: PurchaseStatus
    notes: string | null
    totalCents: number
    receivedAt: string | null
    createdAt: string
    supplier: { id: string; name: string } | null
    branch: { id: string; name: string }
    createdBy: { id: string; name: string } | null
    items: {
        id: string
        quantity: number
        unitCostCents: number
        product: { id: string; name: string; barcode: string | null }
    }[]
}

interface SupplierOption { id: string; name: string }
interface BranchOption { id: string; name: string; isActive?: boolean }

const STATUS_CONFIG: Record<PurchaseStatus, { label: string; className: string }> = {
    DRAFT: { label: "Borrador", className: "bg-muted text-muted-foreground border-border" },
    ORDERED: { label: "Ordenada", className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300" },
    RECEIVED: { label: "Recibida", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300" },
    CANCELLED: { label: "Cancelada", className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300" },
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

export function ComprasPanel() {
    const [purchases, setPurchases] = useState<PurchaseRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState("ALL")

    const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
    const [branches, setBranches] = useState<BranchOption[]>([])

    const [createOpen, setCreateOpen] = useState(false)
    const [detail, setDetail] = useState<PurchaseRow | null>(null)
    const [pending, setPending] = useState<{ purchase: PurchaseRow; action: PurchaseAction } | null>(null)
    const [acting, setActing] = useState(false)
    const operation = useRef<ClientOperationKey | null>(null)

    const fetchPurchases = useCallback(async (signal?: AbortSignal) => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams()
            if (statusFilter !== "ALL") params.set("status", statusFilter)
            const res = await fetch(`/api/purchases?${params}`, { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar compras")
            if (!signal?.aborted) setPurchases(data?.purchases ?? [])
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar compras")
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
        operation.current = getClientOperationKey(operation.current, payload)
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

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                        <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                        {STATUS_FILTERS.map(f => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <div className="sm:ml-auto">
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nueva compra
                    </Button>
                </div>
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
                                                    <Badge variant="outline" className={config.className}>
                                                        {config.label}
                                                    </Badge>
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

            {/* Detalle de la orden */}
            <Dialog open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null) }}>
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
                                {detail.items.map(item => (
                                    <div key={item.id} className="p-3 flex justify-between items-center gap-3">
                                        <div className="min-w-0">
                                            <p className="font-medium text-sm truncate">{item.product.name}</p>
                                            <p className="text-xs text-muted-foreground">{item.product.barcode || "Sin código"}</p>
                                        </div>
                                        <div className="text-right shrink-0 text-sm tabular-nums">
                                            {item.quantity} × {formatPrice(item.unitCostCents / 100)} ={" "}
                                            <span className="font-medium">{formatPrice(item.quantity * item.unitCostCents / 100)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex justify-between items-center pt-1">
                                <span className="text-sm text-muted-foreground">
                                    {detail.receivedAt ? `Recibida ${formatDate(detail.receivedAt)}` : `${unitsOf(detail)} unidades`}
                                </span>
                                <span className="font-semibold tabular-nums">Total: {formatPrice(detail.totalCents / 100)}</span>
                            </div>
                            {detail.notes && (
                                <p className="text-sm text-muted-foreground border rounded-md p-3">{detail.notes}</p>
                            )}
                            {(detail.status === "DRAFT" || detail.status === "ORDERED") && (
                                <div className="flex justify-end gap-2 pt-1">
                                    {detail.status === "DRAFT" && (
                                        <Button variant="outline" onClick={() => { setDetail(null); requestAction(detail, "ORDER") }}>
                                            <Send className="mr-2 h-4 w-4" /> Ordenar
                                        </Button>
                                    )}
                                    {detail.status === "ORDERED" && (
                                        <Button onClick={() => { setDetail(null); requestAction(detail, "RECEIVE") }}>
                                            <CheckCircle2 className="mr-2 h-4 w-4" /> Recibir mercancía
                                        </Button>
                                    )}
                                </div>
                            )}
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
