"use client"

import { useCallback, useEffect, useState } from "react"
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
import { EmptyState } from "@/components/admin/empty-state"
import { MermaDialog, MERMA_NOTE_PREFIX } from "@/components/admin/inventario/merma-dialog"
import { Loader2, PackageX, Plus } from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"

/**
 * Mermas = movimientos OUT que no son venta (paymentMethod null). DAMAGED/LOST
 * se guardan como OUT en la BD; el subtipo real viaja en notes ("merma:damaged"|
 * "merma:lost", ver merma-dialog.tsx). Los OUT sin marca pueden ser mermas
 * antiguas o salidas de uso interno: se listan con el tipo "Salida".
 */

interface MermaMovement {
    id: string
    type: string
    quantity: number
    reason: string | null
    notes: string | null
    createdAt: string
    product: {
        id: string
        name: string
        barcode: string | null
        costPrice: number | null
    } | null
    user: { id: string; name: string } | null
    branch?: { id: string; name: string } | null
}

type MermaKind = "DAMAGED" | "LOST" | "OUT"

function mermaKind(m: MermaMovement): MermaKind {
    const note = m.notes?.toLowerCase() ?? ""
    if (note.startsWith(`${MERMA_NOTE_PREFIX}damaged`)) return "DAMAGED"
    if (note.startsWith(`${MERMA_NOTE_PREFIX}lost`)) return "LOST"
    return "OUT"
}

const KIND_CONFIG: Record<MermaKind, { label: string; className: string }> = {
    DAMAGED: { label: "Dañado", className: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300" },
    LOST: { label: "Perdido", className: "bg-muted text-muted-foreground border-border" },
    OUT: { label: "Salida", className: "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-300" },
}

const TYPE_FILTERS = [
    { value: "ALL", label: "Todas" },
    { value: "DAMAGED", label: "Dañado" },
    { value: "LOST", label: "Perdido" },
]

const PAGE_SIZE = 20
const SUMMARY_LIMIT = 100

interface MonthSummary {
    units: number
    damaged: number
    lost: number
    other: number
    costEstimate: number | null // null si ningún producto tiene costPrice
    withoutCost: number // unidades sin dato de costo (estimado parcial)
}

export function MermasPanel() {
    const [movements, setMovements] = useState<MermaMovement[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(1)

    const [typeFilter, setTypeFilter] = useState("ALL")
    const [branchFilter, setBranchFilter] = useState("ALL")
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])

    const [summary, setSummary] = useState<MonthSummary | null>(null)
    const [createOpen, setCreateOpen] = useState(false)

    // Lista paginada: MERMAS = todas las salidas no-venta; DAMAGED/LOST usan la marca en notes.
    const fetchMovements = useCallback(async (signal?: AbortSignal) => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams()
            params.set("type", typeFilter === "ALL" ? "MERMAS" : typeFilter)
            params.set("limit", PAGE_SIZE.toString())
            params.set("offset", ((page - 1) * PAGE_SIZE).toString())
            if (branchFilter !== "ALL") params.set("branchId", branchFilter)

            const res = await fetch(`/api/inventory?${params}`, { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar mermas")
            if (!signal?.aborted) setMovements(data?.movements ?? [])
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar mermas")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [page, typeFilter, branchFilter])

    // Resumen del mes en curso: unidades y costo estimado (costPrice actual del producto).
    const fetchSummary = useCallback(async (signal?: AbortSignal) => {
        try {
            const params = new URLSearchParams()
            params.set("type", "MERMAS")
            params.set("limit", SUMMARY_LIMIT.toString())
            if (branchFilter !== "ALL") params.set("branchId", branchFilter)
            const res = await fetch(`/api/inventory?${params}`, { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok || signal?.aborted) return

            const now = new Date()
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
            const monthRows = (data?.movements ?? []).filter(
                (m: MermaMovement) => new Date(m.createdAt) >= monthStart
            )

            let units = 0, damaged = 0, lost = 0, other = 0
            let cost = 0, costed = 0, withoutCost = 0
            for (const m of monthRows as MermaMovement[]) {
                units += m.quantity
                const kind = mermaKind(m)
                if (kind === "DAMAGED") damaged += m.quantity
                else if (kind === "LOST") lost += m.quantity
                else other += m.quantity
                if (m.product?.costPrice != null) {
                    cost += m.quantity * m.product.costPrice
                    costed += m.quantity
                } else {
                    withoutCost += m.quantity
                }
            }
            setSummary({ units, damaged, lost, other, costEstimate: costed > 0 ? cost : null, withoutCost })
        } catch {
            // El resumen es informativo: si falla, la lista sigue funcionando.
        }
    }, [branchFilter])

    useEffect(() => {
        const controller = new AbortController()
        // Diferido a un callback: setState sincrónico en el cuerpo del efecto está prohibido.
        void Promise.resolve().then(() => fetchMovements(controller.signal))
        return () => controller.abort()
    }, [fetchMovements])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchSummary(controller.signal))
        return () => controller.abort()
    }, [fetchSummary])

    useEffect(() => {
        fetch("/api/branches").then(r => r.ok ? r.json() : null).then(d => {
            setBranches((d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive))
        }).catch(() => {})
    }, [])

    const refresh = () => {
        void fetchMovements()
        void fetchSummary()
    }

    const monthLabel = new Date().toLocaleDateString("es-MX", { month: "long" })

    return (
        <div className="space-y-4">
            {/* Resumen del mes */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                    <CardHeader className="pb-1 pt-4 px-4">
                        <CardDescription className="capitalize">{monthLabel}: unidades</CardDescription>
                        <CardTitle className="text-2xl tabular-nums">
                            {summary ? summary.units : "—"}
                        </CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-1 pt-4 px-4">
                        <CardDescription>Dañadas</CardDescription>
                        <CardTitle className="text-2xl tabular-nums text-orange-600">
                            {summary ? summary.damaged : "—"}
                        </CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-1 pt-4 px-4">
                        <CardDescription>Perdidas</CardDescription>
                        <CardTitle className="text-2xl tabular-nums">
                            {summary ? summary.lost : "—"}
                        </CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-1 pt-4 px-4">
                        <CardDescription>Costo estimado</CardDescription>
                        <CardTitle className="text-2xl tabular-nums">
                            {summary?.costEstimate != null ? formatPrice(summary.costEstimate) : "—"}
                        </CardTitle>
                        {summary && summary.costEstimate != null && summary.withoutCost > 0 && (
                            <p className="text-xs text-muted-foreground">
                                Parcial: {summary.withoutCost} ud sin costo registrado
                            </p>
                        )}
                    </CardHeader>
                </Card>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
                <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1) }}>
                    <SelectTrigger className="w-full sm:w-44">
                        <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                        {TYPE_FILTERS.map(f => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {branches.length > 0 && (
                    <Select value={branchFilter} onValueChange={(v) => { setBranchFilter(v); setPage(1) }}>
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
                <div className="sm:ml-auto">
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Registrar merma
                    </Button>
                </div>
            </div>

            {error ? (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{error}</p>
                    <Button variant="outline" onClick={refresh}>Reintentar</Button>
                </div>
            ) : loading && movements.length === 0 ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : movements.length === 0 ? (
                <EmptyState
                    icon={PackageX}
                    title="Sin mermas registradas"
                    description={
                        typeFilter !== "ALL" || branchFilter !== "ALL"
                            ? "Prueba con otros filtros."
                            : "Cuando un producto se dañe o se pierda, regístralo aquí para descontarlo del inventario."
                    }
                />
            ) : (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <PackageX className="h-5 w-5 text-muted-foreground" />
                            Mermas y salidas
                        </CardTitle>
                        <CardDescription>
                            Unidades dadas de baja por daño, pérdida u otras salidas sin venta
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Producto</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead className="text-right">Cant.</TableHead>
                                        <TableHead className="text-right hidden md:table-cell">Costo est.</TableHead>
                                        <TableHead className="hidden md:table-cell">Sucursal</TableHead>
                                        <TableHead className="hidden lg:table-cell">Motivo</TableHead>
                                        <TableHead className="hidden md:table-cell">Registró</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {movements.map(m => {
                                        const kind = mermaKind(m)
                                        const config = KIND_CONFIG[kind]
                                        const cost = m.product?.costPrice != null ? m.quantity * m.product.costPrice : null
                                        return (
                                            <TableRow key={m.id} className={loading ? "opacity-60" : ""}>
                                                <TableCell className="whitespace-nowrap text-sm">
                                                    {formatDate(m.createdAt)}
                                                </TableCell>
                                                <TableCell>
                                                    <p className="font-medium">{m.product?.name || "Producto eliminado"}</p>
                                                    <p className="text-xs text-muted-foreground md:hidden">
                                                        {m.branch?.name ?? ""}
                                                    </p>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={config.className}>
                                                        {config.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-medium text-red-600 tabular-nums">
                                                    -{m.quantity}
                                                </TableCell>
                                                <TableCell className="text-right hidden md:table-cell tabular-nums">
                                                    {cost != null ? formatPrice(cost) : <span className="text-muted-foreground">—</span>}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                                    {m.branch?.name ?? "—"}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground max-w-[220px]">
                                                    <span className="line-clamp-2" title={m.reason ?? undefined}>
                                                        {m.reason ?? "—"}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                                    {m.user?.name ?? "Sistema"}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Paginación */}
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
                                disabled={movements.length < PAGE_SIZE || loading}
                            >
                                Siguiente
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <MermaDialog
                branches={branches}
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSaved={refresh}
            />
        </div>
    )
}
