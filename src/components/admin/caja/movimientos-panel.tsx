"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { csvCell } from "@/lib/csv"
import { formatDate, formatPrice } from "@/lib/utils"
import {
    ArrowLeftRight,
    Download,
    ExternalLink,
    Loader2,
    RefreshCw,
} from "lucide-react"

/**
 * «Movimientos»: rastro unificado del dinero para auditoría dentro del centro
 * de dinero (/admin/caja?tab=movimientos). Consume GET /api/caja/movements,
 * que normaliza CashMovement + Payment + CreditMovement + SupplierPayment en
 * una sola lista con monto en centavos y signo (+ entra / − sale).
 *
 * Los chips filtran por familia sobre lo YA cargado (el servidor no recorta
 * por tipo); sucursal y rango de días sí reconsultan la API.
 */

type MovementKind =
    | "CASH_IN" | "CASH_OUT"
    | "PAYMENT" | "PAYMENT_REFUND" | "PAYMENT_VOID"
    | "CREDIT_DEBT" | "CREDIT_PAYMENT" | "CREDIT_REVERSAL"
    | "SUPPLIER_PAYMENT"

interface MoneyMovement {
    id: string
    kind: MovementKind
    occurredAt: string
    branchId: string | null
    branchName: string | null
    userId: string | null
    actorName: string
    amountCents: number
    method: string | null
    reference: string | null
    description: string
    href: string | null
    /** El mismo dinero también tiene asiento de caja en la lista (no sumar 2×). */
    duplicatesCash: boolean
}

type Family = "all" | "caja" | "cobros" | "credito" | "proveedores"

const FAMILY_KINDS: Record<Exclude<Family, "all">, readonly MovementKind[]> = {
    caja: ["CASH_IN", "CASH_OUT"],
    cobros: ["PAYMENT", "PAYMENT_REFUND", "PAYMENT_VOID"],
    credito: ["CREDIT_DEBT", "CREDIT_PAYMENT", "CREDIT_REVERSAL"],
    proveedores: ["SUPPLIER_PAYMENT"],
}

const FAMILY_FILTERS: { value: Family; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "caja", label: "Caja" },
    { value: "cobros", label: "Cobros" },
    { value: "credito", label: "Crédito" },
    { value: "proveedores", label: "Proveedores" },
]

const KIND_META: Record<MovementKind, { label: string; badgeClass: string }> = {
    CASH_IN: { label: "Entrada caja", badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
    CASH_OUT: { label: "Salida caja", badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
    PAYMENT: { label: "Cobro", badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
    PAYMENT_REFUND: { label: "Reembolso", badgeClass: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30" },
    PAYMENT_VOID: { label: "Cobro anulado", badgeClass: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/30" },
    CREDIT_DEBT: { label: "Cargo a crédito", badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
    CREDIT_PAYMENT: { label: "Abono crédito", badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
    CREDIT_REVERSAL: { label: "Reversión", badgeClass: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30" },
    SUPPLIER_PAYMENT: { label: "Pago proveedor", badgeClass: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30" },
}

const METHOD_LABELS: Record<string, string> = {
    CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito",
}

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const

const TAKE = 500 // tope del servidor: los chips filtran sobre todo lo cargado

const kindLabel = (kind: MovementKind) => KIND_META[kind]?.label ?? kind

/** Monto con signo en pesos; los cobros anulados quedan neutros (su par
 *  reembolso ya trae el −). */
function SignedAmount({ movement }: { movement: MoneyMovement }) {
    const pesos = movement.amountCents / 100
    if (movement.kind === "PAYMENT_VOID") {
        return <span className="tabular-nums text-muted-foreground">{formatPrice(pesos)}</span>
    }
    const positive = movement.amountCents >= 0
    return (
        <span className={`tabular-nums font-semibold ${positive ? "text-green-600" : "text-destructive"}`}>
            {positive ? "+" : "−"}{formatPrice(Math.abs(pesos))}
        </span>
    )
}

export function MovimientosPanel({ branches }: { branches: { id: string; name: string }[] }) {
    const [movements, setMovements] = useState<MoneyMovement[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [family, setFamily] = useState<Family>("all")
    const [branch, setBranch] = useState("all")
    const [days, setDays] = useState<number>(7)
    const requestVersion = useRef(0)

    const load = useCallback(async (signal?: AbortSignal) => {
        const version = ++requestVersion.current
        setError(null)
        setLoading(true)
        try {
            const params = new URLSearchParams({ days: String(days), take: String(TAKE) })
            if (branch !== "all") params.set("branchId", branch)
            const res = await fetch(`/api/caja/movements?${params}`, { signal })
            const data = await res.json().catch(() => null)
            if (signal?.aborted || version !== requestVersion.current) return
            if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los movimientos.")
            setMovements((data?.movements ?? []) as MoneyMovement[])
        } catch (e) {
            if (signal?.aborted || version !== requestVersion.current) return
            setMovements([])
            setError(e instanceof Error ? e.message : "Error al cargar los movimientos.")
        } finally {
            if (!signal?.aborted && version === requestVersion.current) setLoading(false)
        }
    }, [days, branch])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => load(controller.signal))
        return () => controller.abort()
    }, [load])

    const filtered = useMemo(() => {
        if (family === "all") return movements
        const kinds = FAMILY_KINDS[family]
        return movements.filter(m => kinds.includes(m.kind))
    }, [movements, family])

    // Exporta lo visible en pantalla (filtros aplicados): BOM UTF-8 para
    // Excel, \r\n por fila y csvCell anti CSV-injection, como los demás
    // paneles del centro de dinero.
    const handleExportCsv = () => {
        if (filtered.length === 0) return
        const headers = ["Fecha", "Tipo", "Descripción", "Sucursal", "Actor", "Monto", "Método", "Referencia"]
        const rows = filtered.map(m => [
            new Date(m.occurredAt).toLocaleString("es-MX"),
            kindLabel(m.kind),
            m.description,
            m.branchName ?? "",
            m.actorName,
            (m.amountCents / 100).toFixed(2),
            m.method ? (METHOD_LABELS[m.method] ?? m.method) : "",
            m.reference ?? "",
        ])
        const lines = [headers.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))]
        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `movimientos-dinero-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
    }

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 space-y-0">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <ArrowLeftRight className="h-5 w-5 text-muted-foreground" /> Movimientos de dinero
                    </CardTitle>
                    <CardDescription>
                        Rastro unificado para auditoría: caja, cobros documentados, crédito y pagos a proveedores. Montos con signo (+ entra / − sale).
                    </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading || filtered.length === 0}
                        aria-label="Exportar los movimientos filtrados a CSV"
                        onClick={handleExportCsv}
                    >
                        <Download className="w-4 h-4 mr-1" /> Exportar CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Filtros: familia (chips, instantáneo) + sucursal y días (API). */}
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                        <Label className="text-xs">Tipo</Label>
                        <div className="flex gap-1.5 flex-wrap">
                            {FAMILY_FILTERS.map(f => (
                                <Button
                                    key={f.value}
                                    type="button"
                                    variant={family === f.value ? "default" : "outline"}
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => setFamily(f.value)}
                                >
                                    {f.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                    {branches.length > 1 && (
                        <div className="w-full sm:w-44 space-y-1">
                            <Label className="text-xs">Sucursal</Label>
                            <Select value={branch} onValueChange={setBranch}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Todas" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas</SelectItem>
                                    {branches.map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <div className="w-full sm:w-36 space-y-1">
                        <Label className="text-xs">Periodo</Label>
                        <Select value={String(days)} onValueChange={v => setDays(parseInt(v, 10))}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {DAY_OPTIONS.map(d => (
                                    <SelectItem key={d} value={String(d)}>Últimos {d} días</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {loading ? (
                    <p className="text-sm text-muted-foreground text-center py-8 flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Cargando movimientos…
                    </p>
                ) : error ? (
                    <div role="alert" className="rounded-lg border p-6 space-y-3 text-sm">
                        <p>{error}</p>
                        <Button variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button>
                    </div>
                ) : movements.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        Sin movimientos de dinero en los últimos {days} días.
                    </p>
                ) : filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        Sin movimientos que coincidan con el filtro seleccionado.
                    </p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] text-sm">
                            <thead>
                                <tr className="border-b text-xs text-muted-foreground">
                                    <th className="px-2 py-1.5 text-left font-medium">Fecha</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Tipo</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Descripción</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Sucursal</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Actor</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Monto</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Método</th>
                                    <th className="px-2 py-1.5 text-left font-medium">Referencia</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(m => {
                                    const meta = KIND_META[m.kind]
                                    return (
                                        <tr key={m.id} className="border-b last:border-0">
                                            <td className="px-2 py-1.5 whitespace-nowrap text-xs text-muted-foreground">
                                                {formatDate(m.occurredAt)}
                                            </td>
                                            <td className="px-2 py-1.5 whitespace-nowrap">
                                                <Badge className={meta?.badgeClass}>{meta?.label ?? m.kind}</Badge>
                                                {m.duplicatesCash && (
                                                    <Badge variant="outline" className="ml-1 text-[10px] font-normal" title="Este dinero también asienta su propia fila de caja — no sumar dos veces">
                                                        también en caja
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 max-w-[280px] truncate" title={m.description}>{m.description}</td>
                                            <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                                                {m.branchName ?? <span className="text-muted-foreground/60">—</span>}
                                            </td>
                                            <td className="px-2 py-1.5 text-xs whitespace-nowrap max-w-[140px] truncate">{m.actorName}</td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                                <SignedAmount movement={m} />
                                            </td>
                                            <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                                                {m.method ? (METHOD_LABELS[m.method] ?? m.method) : <span className="text-muted-foreground/60">—</span>}
                                            </td>
                                            <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                                                {m.href ? (
                                                    <Link href={m.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                                        {m.reference ?? "Ver"} <ExternalLink className="h-3 w-3" />
                                                    </Link>
                                                ) : (
                                                    m.reference ?? <span className="text-muted-foreground/60">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
