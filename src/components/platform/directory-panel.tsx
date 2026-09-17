"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { ClipboardList, Loader2, MousePointerClick, RefreshCw, Search } from "lucide-react"
import { formatDay } from "@/lib/utils"

/**
 * Sección "Directorio" de la consola /platform: telemetría de /mercado en
 * los últimos 30 días (DirectoryEvent, global sin tenant). Mismo patrón
 * que BusinessesPanel: fetch a /api/platform/directory-stats, estados de
 * carga/error y tablas con el estilo shadcn del resto de la consola.
 */

interface DirectoryStats {
    windowDays: number
    totals: { searches: number; clicks: number; requests: number }
    topQueries: { query: string; count: number }[]
    topBusinesses: { businessId: string; name: string; slug: string; clicks: number }[]
    daily: { date: string; searches: number; clicks: number; requests: number; total: number }[]
}

export function DirectoryPanel() {
    const [stats, setStats] = useState<DirectoryStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchStats = useCallback(async () => {
        setError(null)
        try {
            const res = await fetch("/api/platform/directory-stats")
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar las métricas")
            setStats(data?.stats ?? null)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error al cargar las métricas")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void Promise.resolve().then(fetchStats)
    }, [fetchStats])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (error || !stats) {
        return (
            <div role="alert" className="rounded-lg border p-6 space-y-3">
                <p>{error ?? "Sin datos del directorio"}</p>
                <Button variant="outline" onClick={() => { setLoading(true); void fetchStats() }}>
                    Reintentar
                </Button>
            </div>
        )
    }

    const maxDaily = Math.max(1, ...stats.daily.map(d => d.total))
    const maxQuery = Math.max(1, ...stats.topQueries.map(q => q.count))
    const maxClicks = Math.max(1, ...stats.topBusinesses.map(b => b.clicks))

    const totalCards = [
        { label: "Búsquedas", value: stats.totals.searches, icon: Search },
        { label: "Clicks a vitrinas", value: stats.totals.clicks, icon: MousePointerClick },
        { label: "Solicitudes", value: stats.totals.requests, icon: ClipboardList },
    ]

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Directorio</h2>
                    <p className="text-muted-foreground">
                        Actividad del directorio público /mercado · últimos {stats.windowDays} días
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); void fetchStats() }}>
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                    Actualizar
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                {totalCards.map(({ label, value, icon: Icon }) => (
                    <Card key={label}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {label}
                            </CardTitle>
                            <Icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold tabular-nums">{value.toLocaleString("es-MX")}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="rounded-lg border bg-card p-4 sm:p-6">
                <h3 className="font-semibold mb-1">Eventos por día</h3>
                <p className="text-xs text-muted-foreground mb-4">
                    Búsquedas + clicks + solicitudes diarios
                </p>
                <div className="flex items-end gap-[3px] h-28" role="img"
                    aria-label={`Eventos diarios del directorio en los últimos ${stats.windowDays} días`}>
                    {stats.daily.map(d => (
                        <div
                            key={d.date}
                            className="flex-1 min-w-0 rounded-t bg-primary/70 hover:bg-primary transition-colors"
                            style={{ height: `${Math.max(2, (d.total / maxDaily) * 100)}%` }}
                            title={`${formatDay(`${d.date}T12:00:00`)}: ${d.total} evento${d.total === 1 ? "" : "s"} · ${d.searches} búsqueda${d.searches === 1 ? "" : "s"}, ${d.clicks} click${d.clicks === 1 ? "" : "s"}, ${d.requests} solicitud${d.requests === 1 ? "" : "es"}`}
                        />
                    ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
                    <span>{formatDay(`${stats.daily[0]?.date}T12:00:00`)}</span>
                    <span>{formatDay(`${stats.daily[stats.daily.length - 1]?.date}T12:00:00`)}</span>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-lg border bg-card">
                    <div className="p-4 sm:p-6 pb-3">
                        <h3 className="font-semibold">Qué busca la gente</h3>
                        <p className="text-xs text-muted-foreground">
                            Términos y categorías más buscados
                        </p>
                    </div>
                    {stats.topQueries.length === 0 ? (
                        <p className="px-4 sm:px-6 pb-6 text-sm text-muted-foreground">
                            Todavía no hay búsquedas registradas en el periodo.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Término</TableHead>
                                    <TableHead className="w-40">Frecuencia</TableHead>
                                    <TableHead className="text-right w-20">Veces</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.topQueries.map(q => (
                                    <TableRow key={q.query}>
                                        <TableCell className="font-medium max-w-0 truncate" title={q.query}>
                                            {q.query}
                                        </TableCell>
                                        <TableCell>
                                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-primary/70"
                                                    style={{ width: `${(q.count / maxQuery) * 100}%` }}
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{q.count}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>

                <div className="rounded-lg border bg-card">
                    <div className="p-4 sm:p-6 pb-3">
                        <h3 className="font-semibold">Negocios más visitados</h3>
                        <p className="text-xs text-muted-foreground">
                            Vitrinas con más clicks desde el directorio
                        </p>
                    </div>
                    {stats.topBusinesses.length === 0 ? (
                        <p className="px-4 sm:px-6 pb-6 text-sm text-muted-foreground">
                            Todavía no hay clicks registrados en el periodo.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Negocio</TableHead>
                                    <TableHead className="w-40">Frecuencia</TableHead>
                                    <TableHead className="text-right w-20">Clicks</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.topBusinesses.map(b => (
                                    <TableRow key={b.businessId}>
                                        <TableCell className="max-w-0">
                                            <div className="flex items-center gap-2">
                                                {b.slug ? (
                                                    <Link
                                                        href={`/${b.slug}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="font-medium text-primary hover:underline truncate"
                                                    >
                                                        {b.name}
                                                    </Link>
                                                ) : (
                                                    <span className="font-medium truncate">{b.name}</span>
                                                )}
                                                {!b.slug && <Badge variant="outline">eliminado</Badge>}
                                            </div>
                                            {b.slug && (
                                                <span className="block text-xs text-muted-foreground font-mono truncate">
                                                    /{b.slug}
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className="h-full rounded-full bg-primary/70"
                                                    style={{ width: `${(b.clicks / maxClicks) * 100}%` }}
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums">{b.clicks}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
        </div>
    )
}
