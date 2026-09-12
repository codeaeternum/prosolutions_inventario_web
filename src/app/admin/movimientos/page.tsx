"use client"

import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog"
import Link from "next/link"
import { Loader2, Trash2, Plus, Printer, Share2, Undo2, MoreHorizontal } from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"
import { toast } from "sonner"

interface Movement {
    id: string
    type: string
    quantity: number
    returnableQuantity: number
    previousStock: number
    newStock: number
    reason: string | null
    unitPrice: number | null
    totalPrice: number | null
    createdAt: string
    source?: string
    product: {
        id: string
        name: string
    }
    user: {
        id: string
        name: string
    } | null
    branch?: { id: string; name: string } | null
    toBranch?: { id: string; name: string } | null
}

const movementTypes = [
    { value: "ALL", label: "Todos" },
    { value: "SALE", label: "Ventas" },
    { value: "CANCELLED", label: "Reservas canceladas" },
    { value: "IN", label: "Entradas" },
    { value: "OUT", label: "Salidas" },
    { value: "TRANSFER", label: "Traspasos" },
    { value: "ADJUSTMENT_IN", label: "Ajuste (+)" },
    { value: "ADJUSTMENT_OUT", label: "Ajuste (-)" },
    { value: "RETURN", label: "Devoluciones" },
    { value: "DAMAGED", label: "Dañado" },
    { value: "LOST", label: "Perdido" },
]

export default function MovimientosPage() {
    const [loading, setLoading] = useState(false)
    const [movements, setMovements] = useState<Movement[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit] = useState(20)

    // Filters
    const [typeFilter, setTypeFilter] = useState<string>("ALL")
    const [branchFilter, setBranchFilter] = useState<string>("ALL")
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])

    // Delete dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; source: string } | null>(null)

    // Return dialog
    const [returnDialogOpen, setReturnDialogOpen] = useState(false)
    const returnOperation = useRef<ClientOperationKey | null>(null)
    const [returnTarget, setReturnTarget] = useState<Movement | null>(null)
    const [returnQty, setReturnQty] = useState("1")
    const [returnReason, setReturnReason] = useState("")
    const [returningInProgress, setReturningInProgress] = useState(false)

    // Actions menu (mobile-friendly popover alternative)
    const [actionsOpenId, setActionsOpenId] = useState<string | null>(null)

    const fetchMovements = async () => {
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

            const res = await fetch(`/api/inventory?${params.toString()}`)
            const data = await res.json()

            if (res.ok) {
                setMovements(data.movements)
                setTotal(data.total)
            }
        } catch (error) {
            console.error("Error fetching movements:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchMovements()
    }, [page, typeFilter, branchFilter])

    useEffect(() => {
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            setBranches((d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive))
        }).catch(() => {})
    }, [])

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
    const displayReason = (reason: string | null) =>
        reason ? (reasonLabels[reason] ?? reason) : null

    const getTypeConfig = (type: string) => {
        switch (type) {
            case "SALE": return { label: "Venta", color: "bg-green-100 text-green-800" }
            case "CANCELLED": return { label: "Reserva cancelada", color: "bg-gray-100 text-gray-700" }
            case "IN": return { label: "Entrada", color: "bg-blue-100 text-blue-800" }
            case "OUT": return { label: "Salida", color: "bg-red-100 text-red-800" }
            case "ADJUSTMENT": return { label: "Ajuste", color: "bg-slate-100 text-slate-700" }
            case "ADJUSTMENT_IN": return { label: "Ajuste (+)", color: "bg-blue-50 text-blue-600" }
            case "ADJUSTMENT_OUT": return { label: "Ajuste (-)", color: "bg-red-50 text-red-600" }
            case "RETURN": return { label: "Devolución", color: "bg-yellow-100 text-yellow-800" }
            case "TRANSFER": return { label: "Traspaso", color: "bg-blue-100 text-blue-800" }
            case "DAMAGED": return { label: "Dañado", color: "bg-orange-100 text-orange-800" }
            case "LOST": return { label: "Perdido", color: "bg-muted text-muted-foreground" }
            default: return { label: type, color: "bg-muted text-foreground" }
        }
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
        const config = getTypeConfig(mov.type)
        let text = `*PROSOLUTIONS - ${config.label}*\n`
        text += `Folio: ${mov.id.substring(0, 8)}\n`
        text += `Fecha: ${formatDate(mov.createdAt)}\n`
        if (mov.user?.name) text += `Atendió: ${mov.user.name}\n`
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

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Movimientos</h1>
                    <p className="text-sm text-muted-foreground">Historial de entradas, salidas y ajustes</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <Button asChild variant="outline" size="sm" className="gap-2 shrink-0">
                        <Link href="/admin/inventario">
                            <Plus className="h-4 w-4" />
                            Registrar movimiento
                        </Link>
                    </Button>
                    <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="w-full sm:w-48">
                        <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                        {movementTypes.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {branches.length > 0 && (
                    <Select value={branchFilter} onValueChange={setBranchFilter}>
                        <SelectTrigger className="w-full sm:w-44">
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
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Historial</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Producto</TableHead>
                                    <TableHead className="text-right">Cant.</TableHead>
                                    <TableHead className="text-right hidden md:table-cell">Precio Unit.</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="hidden md:table-cell">Usuario</TableHead>
                                    <TableHead className="hidden md:table-cell">Sucursal</TableHead>
                                    <TableHead className="w-[50px] md:w-[120px] text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading && movements.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="h-24 text-center">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                                        </TableCell>
                                    </TableRow>
                                ) : movements.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                                            No hay movimientos registrados
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    movements.map((mov) => {
                                        const config = getTypeConfig(mov.type)
                                        const isActionsOpen = actionsOpenId === mov.id
                                        return (
                                            <TableRow key={mov.id}>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    <span>{formatDate(mov.createdAt)}</span>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary" className={config.color}>
                                                        {config.label}
                                                    </Badge>
                                                    {displayReason(mov.reason) && (
                                                        <p className="text-xs text-muted-foreground mt-1 max-w-[150px] truncate" title={displayReason(mov.reason) ?? undefined}>
                                                            {displayReason(mov.reason)}
                                                        </p>
                                                    )}
                                                </TableCell>
                                                <TableCell>{mov.product?.name || "Producto eliminado"}</TableCell>
                                                <TableCell className={getStateColor(mov.type)}>
                                                    {isNegative(mov.type) ? "-" : "+"}{mov.quantity}
                                                </TableCell>
                                                <TableCell className="text-right hidden md:table-cell">
                                                    {mov.unitPrice ? formatPrice(mov.unitPrice) : "-"}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {mov.totalPrice ? formatPrice(mov.totalPrice) : "-"}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell">
                                                    {mov.user?.name || "Sistema"}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                                    {mov.type === "TRANSFER" && mov.toBranch
                                                        ? `${mov.branch?.name ?? "—"} → ${mov.toBranch.name}`
                                                        : mov.branch?.name ?? "—"}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="relative inline-block">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8"
                                                            onClick={() => setActionsOpenId(isActionsOpen ? null : mov.id)}
                                                            title="Acciones"
                                                        >
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>

                                                        {isActionsOpen && (
                                                            <>
                                                                {/* Overlay to close on click outside */}
                                                                <div className="fixed inset-0 z-40" onClick={() => setActionsOpenId(null)} />
                                                                <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[180px]">
                                                                    {/* Print Ticket */}
                                                                    {(mov.type === "SALE" || mov.type === "RETURN") && (
                                                                        <a
                                                                            href={mov.source === "RESERVATION" ? `/admin/tickets/reserva/${mov.id}` : `/admin/tickets/venta/${mov.id}`}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted w-full text-left"
                                                                            onClick={() => setActionsOpenId(null)}
                                                                        >
                                                                            <Printer className="h-4 w-4" />
                                                                            Reimprimir Ticket
                                                                        </a>
                                                                    )}

                                                                    {/* WhatsApp Share */}
                                                                    {(mov.type === "SALE" || mov.type === "RETURN") && (
                                                                        <button
                                                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted w-full text-left"
                                                                            onClick={() => {
                                                                                handleShareWhatsApp(mov)
                                                                                setActionsOpenId(null)
                                                                            }}
                                                                        >
                                                                            <Share2 className="h-4 w-4" />
                                                                            Enviar por WhatsApp
                                                                        </button>
                                                                    )}

                                                                    {/* Return */}
                                                                    {mov.type === "SALE" && (
                                                                        <button
                                                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted w-full text-left text-yellow-600"
                                                                            onClick={() => {
                                                                                setReturnTarget(mov)
                                                                                setReturnQty(String(mov.quantity))
                                                                                setReturnDialogOpen(true)
                                                                                setActionsOpenId(null)
                                                                            }}
                                                                        >
                                                                            <Undo2 className="h-4 w-4" />
                                                                            Devolver
                                                                        </button>
                                                                    )}

                                                                    {/* Separator */}
                                                                    <div className="border-t border-border my-1" />

                                                                    {/* Cancel/Delete */}
                                                                    
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-end space-x-2 py-4">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                        >
                            Anterior
                        </Button>
                        <div className="text-sm text-muted-foreground">
                            Página {page}
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => p + 1)}
                            disabled={movements.length < limit || loading}
                        >
                            Siguiente
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Delete Dialog */}


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

function isNegative(type: string) {
    return ["OUT", "SALE", "pet_loss", "DAMAGED", "LOST", "ADJUSTMENT_OUT"].includes(type)
}

function getStateColor(type: string) {
    if (["SALE", "OUT"].includes(type)) return "text-right font-medium text-red-600"
    if (["IN", "ADJUSTMENT_IN", "RETURN"].includes(type)) return "text-right font-medium text-green-600"
    return "text-right font-medium"
}
