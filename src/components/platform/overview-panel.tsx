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
import {
    Building2,
    CircleDollarSign,
    Loader2,
    Package,
    RefreshCw,
    TrendingUp,
    Users,
    Wrench,
} from "lucide-react"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"
import { directoryCategoryLabel } from "@/lib/directory-categories"

/**
 * Sección "Resumen" de la consola /platform: centro de mando del operador.
 * KPIs globales de la instancia + tabla "Salud por negocio" con las 50
 * empresas de actividad más reciente. Consume /api/platform/overview.
 * Todo es agregado cross-tenant — no muestra datos de clientes finales.
 */

interface PlatformOverview {
    businesses: { total: number; active: number; inactive: number; newLast30d: number }
    users: {
        total: number
        pendingApprovals: number
        byRole: { ADMIN: number; EMPLOYEE: number; WORKSHOP: number; CUSTOMER: number }
    }
    orders: { total: number; openNow: number; last7d: number }
    sales: { countTotal: number; sumLast30d: number; countLast30d: number }
    products: { total: number }
    health: {
        id: string
        name: string
        slug: string
        category: string
        isActive: boolean
        createdAt: string
        usersCount: number
        ordersCount: number
        lastOrderAt: string | null
        salesLast30d: number
        pendingUsers: number
    }[]
}

export function OverviewPanel() {
    const [overview, setOverview] = useState<PlatformOverview | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchOverview = useCallback(async () => {
        setError(null)
        try {
            const res = await fetch("/api/platform/overview")
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar el resumen")
            setOverview(data)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error al cargar el resumen")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void Promise.resolve().then(fetchOverview)
    }, [fetchOverview])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (error || !overview) {
        return (
            <div role="alert" className="rounded-lg border p-6 space-y-3">
                <p>{error ?? "Sin datos del resumen"}</p>
                <Button variant="outline" onClick={() => { setLoading(true); void fetchOverview() }}>
                    Reintentar
                </Button>
            </div>
        )
    }

    const kpis = [
        {
            label: "Empresas activas",
            value: overview.businesses.active.toLocaleString("es-MX"),
            sub: `${overview.businesses.total} registradas · ${overview.businesses.inactive} suspendidas`,
            icon: Building2,
        },
        {
            label: "Altas en 30 días",
            value: overview.businesses.newLast30d.toLocaleString("es-MX"),
            sub: "empresas nuevas en la instancia",
            icon: TrendingUp,
        },
        {
            label: "Usuarios",
            value: overview.users.total.toLocaleString("es-MX"),
            sub: `${overview.users.pendingApprovals} por aprobar · ${overview.users.byRole.ADMIN} admin · ${overview.users.byRole.EMPLOYEE} empleados · ${overview.users.byRole.WORKSHOP} talleres`,
            icon: Users,
        },
        {
            label: "Órdenes abiertas",
            value: overview.orders.openNow.toLocaleString("es-MX"),
            sub: `${overview.orders.last7d} nuevas en 7 días · ${overview.orders.total} históricas`,
            icon: Wrench,
        },
        {
            label: "Ventas · 30 días",
            value: formatPrice(overview.sales.sumLast30d),
            sub: `${overview.sales.countLast30d} ventas del periodo · ${overview.sales.countTotal} históricas`,
            icon: CircleDollarSign,
        },
        {
            label: "Productos",
            value: overview.products.total.toLocaleString("es-MX"),
            sub: "en los catálogos de todos los negocios",
            icon: Package,
        },
    ]

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Resumen</h2>
                    <p className="text-muted-foreground">
                        Vista global de la instancia · solo datos agregados, sin información de clientes
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); void fetchOverview() }}>
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                    Actualizar
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {kpis.map(({ label, value, sub, icon: Icon }) => (
                    <div key={label} className="rounded-xl border bg-card p-5">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-muted-foreground">{label}</p>
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
                        <p className="mt-1 text-xs text-muted-foreground" title={sub}>{sub}</p>
                    </div>
                ))}
            </div>

            <div className="rounded-lg border bg-card">
                <div className="p-4 sm:p-6 pb-3">
                    <h3 className="font-semibold">Salud por negocio</h3>
                    <p className="text-xs text-muted-foreground">
                        Las {overview.health.length === 50 ? "50 " : ""}empresas con actividad más reciente
                    </p>
                </div>
                {overview.health.length === 0 ? (
                    <div className="px-4 sm:px-6 pb-6">
                        <EmptyState
                            icon={Building2}
                            title="No hay empresas"
                            description="Todavía no se registra ninguna empresa en esta instancia."
                        />
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Empresa</TableHead>
                                <TableHead>Categoría</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Usuarios</TableHead>
                                <TableHead className="text-right">Órdenes</TableHead>
                                <TableHead>Última orden</TableHead>
                                <TableHead className="text-right">Ventas 30d</TableHead>
                                <TableHead>Alta</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {overview.health.map(b => (
                                <TableRow key={b.id} className={b.isActive ? "" : "opacity-70"}>
                                    <TableCell>
                                        <Link
                                            href={`/platform/${b.id}`}
                                            className="font-medium text-primary hover:underline"
                                        >
                                            {b.name}
                                        </Link>
                                        <span className="block text-xs text-muted-foreground font-mono">
                                            /{b.slug}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                        {directoryCategoryLabel(b.category)}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={b.isActive ? "success" : "destructive"}>
                                            {b.isActive ? "Activa" : "Suspendida"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="tabular-nums">{b.usersCount}</span>
                                            {b.pendingUsers > 0 && (
                                                <span className="text-xs text-amber-600 dark:text-amber-400 tabular-nums">
                                                    {b.pendingUsers} pend.
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{b.ordersCount}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                        {b.lastOrderAt ? formatDate(b.lastOrderAt) : "Sin órdenes"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{b.salesLast30d}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                        {formatDay(b.createdAt)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    )
}
