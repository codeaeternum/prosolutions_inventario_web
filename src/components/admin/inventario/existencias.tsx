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
import { EmptyState } from "@/components/admin/empty-state"
import { AlertTriangle, Loader2, Package, Search, Warehouse } from "lucide-react"

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
    const quantityByBranch = (p: StockProduct, branchId: string) =>
        p.branches.find((b) => b.branchId === branchId)?.quantity ?? 0

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
            </div>

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
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
