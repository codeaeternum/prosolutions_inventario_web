"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/admin/empty-state"
import { BusinessStatusButton } from "@/components/platform/business-status-button"
import { Building2, Eye, Loader2, RefreshCw } from "lucide-react"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"

interface PlatformBusiness {
    id: string
    name: string
    slug: string
    category: string
    isActive: boolean
    createdAt: string
    counts: {
        users: number
        products: number
        repairOrders: number
        sales: number
        branches: number
    }
    salesTotal: number
    lastActivityAt: string | null
}

export function BusinessesPanel() {
    const [businesses, setBusinesses] = useState<PlatformBusiness[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchBusinesses = useCallback(async () => {
        setError(null)
        try {
            const res = await fetch("/api/platform/businesses")
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar las empresas")
            setBusinesses(data?.businesses ?? [])
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error al cargar las empresas")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void Promise.resolve().then(fetchBusinesses)
    }, [fetchBusinesses])

    const markStatus = (id: string, isActive: boolean) => {
        setBusinesses(prev => prev.map(b => (b.id === id ? { ...b, isActive } : b)))
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const activas = businesses.filter(b => b.isActive).length
    const suspendidas = businesses.length - activas

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Empresas</h2>
                    <p className="text-muted-foreground">
                        {businesses.length} registrada{businesses.length === 1 ? "" : "s"}
                        {" · "}{activas} activa{activas === 1 ? "" : "s"}
                        {suspendidas > 0 && ` · ${suspendidas} suspendida${suspendidas === 1 ? "" : "s"}`}
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); void fetchBusinesses() }}>
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                    Actualizar
                </Button>
            </div>

            {error && (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{error}</p>
                    <Button variant="outline" onClick={() => { setLoading(true); void fetchBusinesses() }}>
                        Reintentar
                    </Button>
                </div>
            )}

            {!error && businesses.length === 0 ? (
                <EmptyState
                    icon={Building2}
                    title="No hay empresas"
                    description="Todavía no se registra ninguna empresa en esta instancia."
                />
            ) : !error && (
                <div className="rounded-lg border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Empresa</TableHead>
                                <TableHead>Slug</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Usuarios</TableHead>
                                <TableHead className="text-right">Productos</TableHead>
                                <TableHead className="text-right">Órdenes</TableHead>
                                <TableHead className="text-right">Ventas</TableHead>
                                <TableHead>Última actividad</TableHead>
                                <TableHead>Registro</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {businesses.map(b => (
                                <TableRow key={b.id} className={b.isActive ? "" : "opacity-70"}>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{b.name}</span>
                                            <span className="text-xs text-muted-foreground">{b.category}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {b.isActive ? (
                                            <Link
                                                href={`/${b.slug}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-primary hover:underline font-mono text-xs"
                                            >
                                                /{b.slug}
                                            </Link>
                                        ) : (
                                            <span className="font-mono text-xs text-muted-foreground" title="Vitrina inactiva">
                                                /{b.slug}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5">
                                            <Badge variant={b.isActive ? "success" : "destructive"}>
                                                {b.isActive ? "Activa" : "Suspendida"}
                                            </Badge>
                                            {/* Sin operación → candidata a borrado desde el detalle. */}
                                            {b.counts.products === 0 && b.counts.repairOrders === 0 && b.counts.sales === 0 && (
                                                <Badge variant="outline" className="text-muted-foreground" title="Sin operación registrada: se puede eliminar desde la ficha">
                                                    Vacía
                                                </Badge>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{b.counts.users}</TableCell>
                                    <TableCell className="text-right tabular-nums">{b.counts.products}</TableCell>
                                    <TableCell className="text-right tabular-nums">{b.counts.repairOrders}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="tabular-nums font-medium">{formatPrice(b.salesTotal)}</span>
                                            <span className="text-xs text-muted-foreground tabular-nums">
                                                {b.counts.sales} venta{b.counts.sales === 1 ? "" : "s"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                        {b.lastActivityAt ? formatDate(b.lastActivityAt) : "Sin actividad"}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                        {formatDay(b.createdAt)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="ghost" size="icon" asChild>
                                                <Link href={`/platform/${b.id}`} aria-label={`Ver ${b.name}`}>
                                                    <Eye className="h-4 w-4" />
                                                </Link>
                                            </Button>
                                            <BusinessStatusButton
                                                business={b}
                                                size="sm"
                                                onChanged={(isActive) => markStatus(b.id, isActive)}
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    )
}
