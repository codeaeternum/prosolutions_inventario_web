"use client"

import { useState, useEffect } from "react"
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
import Link from "next/link"
import { Breadcrumbs } from "@/components/admin/breadcrumbs"
import { CalendarIcon, Search, Loader2, RefreshCcw, Trash2, Plus } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface Movement {
    id: string
    type: string
    quantity: number
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
}

const movementTypes = [
    { value: "ALL", label: "Todos" },
    { value: "SALE", label: "Ventas" },
    { value: "CANCELLED", label: "Reservas canceladas" },
    { value: "IN", label: "Entradas" },
    { value: "OUT", label: "Salidas" },
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
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; source: string } | null>(null)

    const fetchMovements = async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            params.set("limit", limit.toString())
            params.set("offset", ((page - 1) * limit).toString())

            if (typeFilter !== "ALL") {
                params.set("type", typeFilter)
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
    }, [page, typeFilter])

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
            case "DAMAGED": return { label: "Dañado", color: "bg-orange-100 text-orange-800" }
            case "LOST": return { label: "Perdido", color: "bg-muted text-muted-foreground" }
            default: return { label: type, color: "bg-muted text-foreground" }
        }
    }


    const handleDelete = async (id: string, source: string) => {
        setDeleteDialogOpen(false)
        setDeleteTarget(null)
        try {
            const res = await fetch(`/api/inventory?id=${id}&source=${source}`, {
                method: "DELETE"
            })
            if (res.ok) {
                fetchMovements()
            }
        } catch (error) {
            console.error("Error deleting:", error)
        }
    }

    return (
        <div className="space-y-6">
            <Breadcrumbs items={[{ label: "Movimientos" }]} />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Movimientos</h1>
                    <p className="text-sm text-muted-foreground">Historial de entradas, salidas y ajustes</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button asChild variant="outline" size="sm" className="gap-2">
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
                                    <TableHead className="text-right">Precio Unit.</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead>Usuario</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading && movements.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                                        </TableCell>
                                    </TableRow>
                                ) : movements.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                            No hay movimientos registrados
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    movements.map((mov) => {
                                        const config = getTypeConfig(mov.type)
                                        return (
                                            <TableRow key={mov.id}>
                                                <TableCell className="font-medium">
                                                    <span>{formatDate(mov.createdAt)}</span>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary" className={config.color}>
                                                        {config.label}
                                                    </Badge>
                                                    {mov.reason && (
                                                        <p className="text-xs text-muted-foreground mt-1 max-w-[150px] truncate" title={mov.reason}>
                                                            {mov.reason}
                                                        </p>
                                                    )}
                                                </TableCell>
                                                <TableCell>{mov.product?.name || "Producto eliminado"}</TableCell>
                                                <TableCell className={getStateColor(mov.type)}>
                                                    {isNegative(mov.type) ? "-" : "+"}{mov.quantity}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {mov.unitPrice ? `$${mov.unitPrice.toLocaleString()}` : "-"}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {mov.totalPrice ? `$${mov.totalPrice.toLocaleString()}` : "-"}
                                                </TableCell>
                                                <TableCell>
                                                    {mov.user?.name || "Sistema"}
                                                </TableCell>
                                                <TableCell className="flex justify-end gap-1">
                                                    {mov.type === "SALE" && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-blue-500 hover:text-blue-700"
                                                            asChild
                                                        >
                                                            <a href={`/admin/tickets/venta/${mov.id}`} target="_blank" rel="noreferrer" title="Imprimir Ticket">
                                                                🖨️
                                                            </a>
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                                        onClick={() => {
                                                            setDeleteTarget({ id: mov.id, source: mov.source || "MOVEMENT" })
                                                            setDeleteDialogOpen(true)
                                                        }}
                                                        title="Eliminar Movimiento"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
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

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta acción no se puede deshacer. El registro se borrará del historial.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() =>
                                deleteTarget && void handleDelete(deleteTarget.id, deleteTarget.source)
                            }
                        >
                            Eliminar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

function isNegative(type: string) {
    return ["OUT", "SALE", "pet_loss", "DAMAGED", "LOST", "ADJUSTMENT_OUT"].includes(type)
}

function getStateColor(type: string) {
    if (["SALE", "OUT"].includes(type)) return "text-right font-medium text-red-600"
    if (["IN", "ADJUSTMENT_IN"].includes(type)) return "text-right font-medium text-green-600"
    return "text-right font-medium"
}
