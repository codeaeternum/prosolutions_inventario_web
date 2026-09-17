"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
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
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/admin/empty-state"
import { TraspasoDialog } from "@/components/admin/inventario/traspaso-dialog"
import { ConteoPanel } from "@/components/admin/inventario/conteo-panel"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { AlertTriangle, ArrowLeftRight, ClipboardList, Loader2, Package, Search, Warehouse } from "lucide-react"
import { toast } from "sonner"

interface BranchColumn {
    id: string
    name: string
}

interface StockProduct {
    id: string
    name: string
    barcode: string | null
    category: { id: string; name: string } | null
    minStock: number
    total: number
    branches: { branchId: string; branchName: string; quantity: number }[]
}

interface StockResponse {
    products: StockProduct[]
    branches: BranchColumn[]
    categories: { id: string; name: string }[]
    summary: { products: number; lowStock: number; outOfStock: number }
}

type StockStatus = "agotado" | "bajo" | "ultimas" | "ok"

function getStatus(p: StockProduct): StockStatus {
    if (p.total === 0) return "agotado"
    if (p.total <= p.minStock) return "bajo"
    if (p.total <= p.minStock * 2) return "ultimas"
    return "ok"
}

const STATUS_CONFIG: Record<StockStatus, { label: string; className: string }> = {
    agotado: { label: "Agotado", className: "bg-destructive/10 text-destructive border-destructive/20" },
    bajo: { label: "Stock bajo", className: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300" },
    ultimas: { label: "Últimas", className: "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300" },
    ok: { label: "OK", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300" },
}

export function ExistenciasPanel() {
    const [data, setData] = useState<StockResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [search, setSearch] = useState("")
    const [categoryId, setCategoryId] = useState("ALL")
    const [lowStockOnly, setLowStockOnly] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [debouncedSearch, setDebouncedSearch] = useState("")

    // Traspaso directo entre sucursales
    const [transferProduct, setTransferProduct] = useState<StockProduct | null>(null)
    const [transferOpen, setTransferOpen] = useState(false)
    const openTransfer = (p: StockProduct) => {
        setTransferProduct(p)
        setTransferOpen(true)
    }

    // Conteo físico: diálogo de inicio + panel inline con la sesión abierta.
    const [countDialogOpen, setCountDialogOpen] = useState(false)
    const [countBranchId, setCountBranchId] = useState("")
    const [countNotes, setCountNotes] = useState("")
    const [countBlind, setCountBlind] = useState(false)
    const [creatingCount, setCreatingCount] = useState(false)
    const [focusCountId, setFocusCountId] = useState<string | null>(null)
    const [countsRefreshKey, setCountsRefreshKey] = useState(0)
    const createOp = useRef<ClientOperationKey | null>(null)

    useEffect(() => {
        debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [search])

    const fetchStock = useCallback(async (signal?: AbortSignal) => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams()
            if (debouncedSearch) params.set("search", debouncedSearch)
            if (categoryId !== "ALL") params.set("categoryId", categoryId)
            if (lowStockOnly) params.set("lowStock", "true")
            const res = await fetch(`/api/inventory/stock?${params}`, { signal })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Error al cargar existencias")
            if (!signal?.aborted) setData(json)
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar existencias")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [debouncedSearch, categoryId, lowStockOnly])

    useEffect(() => {
        const controller = new AbortController()
        // Diferido a un callback: setState sincrónico en el cuerpo del efecto está prohibido.
        void Promise.resolve().then(() => fetchStock(controller.signal))
        return () => controller.abort()
    }, [fetchStock])

    const products = data?.products ?? []
    const branches = data?.branches ?? []
    const categories = data?.categories ?? []
    // El traspaso solo aplica con 2+ sucursales activas.
    const canTransfer = branches.length >= 2
    const quantityByBranch = (p: StockProduct, branchId: string) =>
        p.branches.find((b) => b.branchId === branchId)?.quantity ?? 0

    const openCountDialog = () => {
        setCountBranchId(branches[0]?.id ?? "")
        setCountNotes("")
        setCountBlind(false)
        setCountDialogOpen(true)
    }

    const createCount = async () => {
        if (creatingCount) return
        if (!countBranchId) return toast.error("Selecciona la sucursal a contar.")
        const payload = { branchId: countBranchId, notes: countNotes.trim() || undefined, blind: countBlind }
        createOp.current = getClientOperationKey(createOp.current, payload)
        setCreatingCount(true)
        try {
            const res = await fetch("/api/inventory/counts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: createOp.current.key }),
            })
            const json = await res.json().catch(() => null)
            if (!res.ok) throw new Error(json?.error || "No se pudo abrir el conteo.")
            createOp.current = null
            toast.success(`Conteo ${json?.folio ?? ""} abierto`, {
                description: `Captura lo que hay físicamente en ${json?.count?.branch?.name ?? "la sucursal"}.`,
            })
            setCountDialogOpen(false)
            setFocusCountId(json?.count?.id ?? null)
            setCountsRefreshKey(k => k + 1)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta abrir el conteo.")
        } finally {
            setCreatingCount(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
                <div className="relative flex-1 min-w-0 sm:max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar por nombre o código..."
                        aria-label="Buscar productos por nombre o código"
                        className="pl-9"
                    />
                </div>
                <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger className="w-full sm:w-52">
                        <SelectValue placeholder="Categoría" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ALL">Todas las categorías</SelectItem>
                        {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    variant={lowStockOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLowStockOnly((v) => !v)}
                >
                    <AlertTriangle className="mr-1 h-4 w-4" />
                    Solo stock bajo
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={openCountDialog}
                    disabled={branches.length === 0}
                    className="sm:ml-auto"
                >
                    <ClipboardList className="mr-1 h-4 w-4" />
                    Conteo físico
                </Button>
            </div>

            {/* Sesión de conteo físico abierta + historial */}
            <ConteoPanel
                focusCountId={focusCountId}
                refreshKey={countsRefreshKey}
                onChanged={() => void fetchStock()}
            />

            {/* Resumen */}
            {data && !loading && (
                <p className="text-sm text-muted-foreground">
                    {data.summary.products} producto{data.summary.products === 1 ? "" : "s"}
                    {data.summary.outOfStock > 0 && ` · ${data.summary.outOfStock} agotado${data.summary.outOfStock === 1 ? "" : "s"}`}
                    {data.summary.lowStock > 0 && ` · ${data.summary.lowStock} con stock bajo`}
                </p>
            )}

            {error ? (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{error}</p>
                    <Button variant="outline" onClick={() => void fetchStock()}>Reintentar</Button>
                </div>
            ) : loading && !data ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : products.length === 0 ? (
                <EmptyState
                    icon={Package}
                    title="No se encontraron productos"
                    description={
                        search || categoryId !== "ALL" || lowStockOnly
                            ? "Prueba con otros filtros de búsqueda."
                            : "Aún no hay productos activos en el catálogo."
                    }
                    action={!(search || categoryId !== "ALL" || lowStockOnly) ? { label: "Agregar producto", href: "/admin/productos/nuevo" } : undefined}
                />
            ) : (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Warehouse className="h-5 w-5 text-muted-foreground" />
                            Existencias por sucursal
                        </CardTitle>
                        <CardDescription>
                            Desglose de unidades disponibles en cada sucursal activa
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="min-w-[200px]">Producto</TableHead>
                                        <TableHead className="hidden lg:table-cell">Categoría</TableHead>
                                        {branches.map((b) => (
                                            <TableHead key={b.id} className="text-center whitespace-nowrap">
                                                {b.name}
                                            </TableHead>
                                        ))}
                                        <TableHead className="text-center">Total</TableHead>
                                        <TableHead className="text-center hidden md:table-cell">Mín.</TableHead>
                                        <TableHead className="text-right">Estado</TableHead>
                                        {canTransfer && (
                                            <TableHead className="w-12 text-right">
                                                <span className="sr-only">Acciones</span>
                                            </TableHead>
                                        )}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {products.map((p) => {
                                        const status = getStatus(p)
                                        const config = STATUS_CONFIG[status]
                                        return (
                                            <TableRow key={p.id} className={loading ? "opacity-60" : ""}>
                                                <TableCell>
                                                    <Link
                                                        href={`/admin/productos/${p.id}`}
                                                        className="font-medium hover:underline"
                                                    >
                                                        {p.name}
                                                    </Link>
                                                    <p className="text-xs text-muted-foreground">
                                                        {p.barcode || "Sin código"}
                                                    </p>
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell">
                                                    <Badge variant="outline" className="text-xs font-normal">
                                                        {p.category?.name ?? "—"}
                                                    </Badge>
                                                </TableCell>
                                                {branches.map((b) => {
                                                    const qty = quantityByBranch(p, b.id)
                                                    return (
                                                        <TableCell
                                                            key={b.id}
                                                            className={`text-center tabular-nums ${qty === 0 ? "text-muted-foreground/50" : ""}`}
                                                        >
                                                            {qty}
                                                        </TableCell>
                                                    )
                                                })}
                                                <TableCell className="text-center font-semibold tabular-nums">
                                                    {p.total}
                                                </TableCell>
                                                <TableCell className="text-center text-muted-foreground hidden md:table-cell tabular-nums">
                                                    {p.minStock}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Badge variant="outline" className={config.className}>
                                                        {config.label}
                                                    </Badge>
                                                </TableCell>
                                                {canTransfer && (
                                                    <TableCell className="text-right">
                                                        {p.branches.some((b) => b.quantity > 0) && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8"
                                                                onClick={() => openTransfer(p)}
                                                                title={`Mover ${p.name} entre sucursales`}
                                                                aria-label={`Mover ${p.name} entre sucursales`}
                                                            >
                                                                <ArrowLeftRight className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            <TraspasoDialog
                product={transferProduct}
                branches={branches}
                open={transferOpen}
                onOpenChange={setTransferOpen}
                onSaved={() => void fetchStock()}
            />

            {/* Inicio de sesión de conteo físico */}
            <Dialog open={countDialogOpen} onOpenChange={setCountDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ClipboardList className="h-5 w-5 text-muted-foreground" />
                            Nuevo conteo físico
                        </DialogTitle>
                        <DialogDescription>
                            Captura lo que hay realmente en la sucursal; al aplicar, el sistema
                            ajusta las diferencias y las deja auditadas en el historial.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="conteo-branch">Sucursal a contar</Label>
                            <Select value={countBranchId} onValueChange={setCountBranchId}>
                                <SelectTrigger id="conteo-branch">
                                    <SelectValue placeholder="Sucursal" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((b) => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="conteo-notes">Notas (opcional)</Label>
                            <Input
                                id="conteo-notes"
                                placeholder="Ej: conteo de fin de mes, auditoría sorpresa…"
                                value={countNotes}
                                onChange={(e) => setCountNotes(e.target.value)}
                                maxLength={1000}
                            />
                        </div>
                        <div className="flex items-start gap-2">
                            <Checkbox
                                id="conteo-blind"
                                checked={countBlind}
                                onCheckedChange={(v) => setCountBlind(v === true)}
                            />
                            <Label htmlFor="conteo-blind" className="text-sm font-normal leading-tight cursor-pointer">
                                Conteo ciego — el contador no ve el stock esperado
                            </Label>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setCountDialogOpen(false)} disabled={creatingCount}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void createCount()} disabled={creatingCount || !countBranchId}>
                            {creatingCount
                                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : <ClipboardList className="mr-2 h-4 w-4" />}
                            Abrir conteo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
