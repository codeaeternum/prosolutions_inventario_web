"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    PagoProveedorDialog,
    SUPPLIER_METHOD_LABELS,
    type PendingPurchase,
} from "@/components/admin/inventario/pago-proveedor-dialog"
import { useCurrency } from "@/components/currency-provider"
import { formatDate, formatDay } from "@/lib/utils"
import { CalendarClock, ExternalLink, Loader2, Truck } from "lucide-react"

/** Shape de GET /api/suppliers/balances (domain/supplier-payments.supplierBalances). */
interface SupplierBalance {
    supplier: { id: string; name: string; isActive: boolean }
    recibidoCents: number
    pagadoCents: number
    saldoCents: number
    proximoVencimiento: string | null
    ocsPendientes: PendingPurchase[]
}

/** Shape de GET /api/suppliers/aging (domain/supplier-payments.supplierAging). */
interface AgingRow {
    supplierId: string
    name: string
    current: number
    d1_15: number
    d16_30: number
    d31_60: number
    d60plus: number
    total: number
}

/** Shape de GET /api/supplier-payments?supplierId=… (domain listSupplierPayments). */
interface PaymentRow {
    id: string
    supplierId: string
    amountCents: number
    method: string
    notes: string | null
    createdAt: string
    purchase: { id: string; number: number } | null
    createdBy: { id: string; name: string } | null
}

interface DebtRow {
    supplierId: string
    name: string
    isActive: boolean
    saldoCents: number
    proximoVencimiento: string | null
    ocsPendientes: PendingPurchase[]
    aging: AgingRow | null
}

/** Una sola petición devuelve los últimos abonos del negocio (antes era un
    fetch por proveedor con saldo — N+1 HTTP). */
const MAX_RECENT_PAYMENTS = 10

/** Celda monetaria de la tabla: guion cuando el bucket está en cero. */
function AgingCell({ value, formatPrice, className }: { value: number; formatPrice: (n: number) => string; className?: string }) {
    return (
        <td className={`px-2 py-1.5 text-right tabular-nums ${className ?? ""}`}>
            {value > 0 ? formatPrice(value / 100) : <span className="text-muted-foreground/40">—</span>}
        </td>
    )
}

/**
 * «Les debo»: resumen de cuentas por pagar a proveedores dentro del centro de
 * dinero (/admin/caja?tab=proveedores). La gestión completa (altas, edición,
 * detalle por OC) vive en /admin/inventario → Entradas → Proveedores.
 */
export function LesDeboPanel() {
    const { formatPrice } = useCurrency()
    const [balances, setBalances] = useState<SupplierBalance[]>([])
    const [aging, setAging] = useState<Record<string, AgingRow>>({})
    const [payments, setPayments] = useState<PaymentRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [payTarget, setPayTarget] = useState<DebtRow | null>(null)

    const fetchAll = useCallback(async (signal?: AbortSignal) => {
        setError(null)
        try {
            const [balRes, agingRes, payRes] = await Promise.all([
                fetch("/api/suppliers/balances", { signal }),
                fetch("/api/suppliers/aging", { signal }),
                fetch("/api/supplier-payments", { signal }),
            ])
            if (signal?.aborted) return
            if (!balRes.ok && !agingRes.ok) {
                const data = await balRes.json().catch(() => null)
                throw new Error(data?.error || "No se pudieron cargar los saldos de proveedores.")
            }
            const balData = balRes.ok ? await balRes.json().catch(() => null) : null
            const balanceList = (balData?.balances ?? []) as SupplierBalance[]
            setBalances(balanceList)

            const agingData = agingRes.ok ? await agingRes.json().catch(() => null) : null
            const map: Record<string, AgingRow> = {}
            if (agingData && Array.isArray(agingData.suppliers)) {
                for (const row of agingData.suppliers as AgingRow[]) map[row.supplierId] = row
            }
            setAging(map)

            // Pagos recientes: el endpoint ya devuelve los abonos del negocio
            // más recientes primero; su fallo no tumba el panel.
            const payData = payRes.ok ? await payRes.json().catch(() => null) : null
            if (signal?.aborted) return
            setPayments(((payData?.payments ?? []) as PaymentRow[]).slice(0, MAX_RECENT_PAYMENTS))
        } catch (e) {
            if (signal?.aborted) return
            setError(e instanceof Error ? e.message : "Error al cargar los saldos de proveedores.")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchAll(controller.signal))
        return () => controller.abort()
    }, [fetchAll])

    // Unión de saldos derivados (compras recibidas − abonos) y antigüedad
    // (incluye OCs ordenadas aún no recibidas). Ambos montos son del servidor.
    const rows: DebtRow[] = useMemo(() => {
        const byId = new Map(balances.map(b => [b.supplier.id, b]))
        const ids = new Set<string>([
            ...balances.filter(b => b.saldoCents !== 0).map(b => b.supplier.id),
            ...Object.keys(aging),
        ])
        return [...ids].map(id => {
            const bal = byId.get(id)
            const age = aging[id] ?? null
            return {
                supplierId: id,
                name: bal?.supplier.name ?? age?.name ?? "—",
                isActive: bal?.supplier.isActive ?? true,
                saldoCents: bal?.saldoCents ?? 0,
                proximoVencimiento: bal?.proximoVencimiento ?? null,
                ocsPendientes: bal?.ocsPendientes ?? [],
                aging: age,
            }
        }).sort((a, b) => Math.max(b.saldoCents, b.aging?.total ?? 0) - Math.max(a.saldoCents, a.aging?.total ?? 0))
    }, [balances, aging])

    const totals = useMemo(() => rows.reduce(
        (acc, row) => ({
            saldo: acc.saldo + Math.max(0, row.saldoCents),
            current: acc.current + (row.aging?.current ?? 0),
            d1_15: acc.d1_15 + (row.aging?.d1_15 ?? 0),
            d16_30: acc.d16_30 + (row.aging?.d16_30 ?? 0),
            d31_60: acc.d31_60 + (row.aging?.d31_60 ?? 0),
            d60plus: acc.d60plus + (row.aging?.d60plus ?? 0),
        }),
        { saldo: 0, current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 },
    ), [rows])

    const supplierNames = useMemo(() => new Map(balances.map(b => [b.supplier.id, b.supplier.name])), [balances])

    const vencido = (iso: string | null) => iso !== null && new Date(iso) < new Date()

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 space-y-0">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Truck className="h-5 w-5 text-muted-foreground" /> Les debo — proveedores
                        </CardTitle>
                        <CardDescription>
                            Cuentas por pagar del negocio. El saldo considera compras recibidas; la antigüedad incluye órdenes comprometidas.
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0">
                        <Link href="/admin/inventario?tab=proveedores">
                            <ExternalLink className="w-4 h-4 mr-1" /> Gestionar proveedores
                        </Link>
                    </Button>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-sm text-muted-foreground text-center py-8 flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Cargando saldos…
                        </p>
                    ) : error ? (
                        <div role="alert" className="rounded-lg border p-6 space-y-3 text-sm">
                            <p>{error}</p>
                            <Button variant="outline" size="sm" onClick={() => void fetchAll()}>Reintentar</Button>
                        </div>
                    ) : rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8">Sin deuda con proveedores.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-sm">
                                <thead>
                                    <tr className="border-b text-xs text-muted-foreground">
                                        <th className="px-2 py-1.5 text-left font-medium">Proveedor</th>
                                        <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                                        <th className="px-2 py-1.5 text-right font-medium">Al día</th>
                                        <th className="px-2 py-1.5 text-right font-medium">1-15</th>
                                        <th className="px-2 py-1.5 text-right font-medium">16-30</th>
                                        <th className="px-2 py-1.5 text-right font-medium">31-60</th>
                                        <th className="px-2 py-1.5 text-right font-medium">60+</th>
                                        <th className="px-2 py-1.5 text-left font-medium">Vence</th>
                                        <th className="px-2 py-1.5" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => (
                                        <tr key={row.supplierId} className={`border-b last:border-0 ${row.isActive ? "" : "opacity-60"}`}>
                                            <td className="px-2 py-1.5 font-medium max-w-[180px] truncate">{row.name}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                                                {row.saldoCents > 0 ? (
                                                    <span className="text-red-600">{formatPrice(row.saldoCents / 100)}</span>
                                                ) : row.saldoCents < 0 ? (
                                                    // Anticipos sin aplicar: posición a favor del negocio.
                                                    <span className="text-blue-600 font-medium">A favor {formatPrice(-row.saldoCents / 100)}</span>
                                                ) : (
                                                    <span className="text-muted-foreground/40">—</span>
                                                )}
                                            </td>
                                            <AgingCell value={row.aging?.current ?? 0} formatPrice={formatPrice} className="text-green-600" />
                                            <AgingCell value={row.aging?.d1_15 ?? 0} formatPrice={formatPrice} className="text-amber-600" />
                                            <AgingCell value={row.aging?.d16_30 ?? 0} formatPrice={formatPrice} className="text-orange-600" />
                                            <AgingCell value={row.aging?.d31_60 ?? 0} formatPrice={formatPrice} className="text-red-600" />
                                            <AgingCell value={row.aging?.d60plus ?? 0} formatPrice={formatPrice} className="text-red-700 font-semibold" />
                                            <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                                                {row.proximoVencimiento ? (
                                                    <span className={`flex items-center gap-1 ${vencido(row.proximoVencimiento) ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                                        <CalendarClock className="h-3.5 w-3.5" />
                                                        {formatDay(row.proximoVencimiento)}
                                                        {vencido(row.proximoVencimiento) && " · vencida"}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground/40">—</span>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">
                                                <Button size="sm" variant="outline" onClick={() => setPayTarget(row)}>
                                                    Registrar pago
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t text-xs font-semibold">
                                        <td className="px-2 py-1.5">Total</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums text-red-600">{formatPrice(totals.saldo / 100)}</td>
                                        <AgingCell value={totals.current} formatPrice={formatPrice} className="text-green-600" />
                                        <AgingCell value={totals.d1_15} formatPrice={formatPrice} className="text-amber-600" />
                                        <AgingCell value={totals.d16_30} formatPrice={formatPrice} className="text-orange-600" />
                                        <AgingCell value={totals.d31_60} formatPrice={formatPrice} className="text-red-600" />
                                        <AgingCell value={totals.d60plus} formatPrice={formatPrice} className="text-red-700" />
                                        <td colSpan={2} />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {!loading && !error && payments.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Pagos recientes a proveedores</CardTitle>
                        <CardDescription>Últimos abonos registrados (efectivo fuera de caja, tarjeta o transferencia).</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {payments.map(p => (
                                <div key={p.id} className="flex items-center justify-between gap-3 border-b last:border-0 pb-2 text-sm">
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">
                                            {supplierNames.get(p.supplierId) ?? "Proveedor"}
                                            {p.purchase && <span className="text-muted-foreground font-normal"> · OC #{p.purchase.number}</span>}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDate(p.createdAt)}
                                            {p.createdBy ? ` · ${p.createdBy.name}` : ""}
                                            {p.notes ? ` — ${p.notes}` : ""}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge variant="outline" className="text-[10px] font-normal">
                                            {SUPPLIER_METHOD_LABELS[p.method] ?? p.method}
                                        </Badge>
                                        <span className="font-bold tabular-nums">{formatPrice(p.amountCents / 100)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Reutiliza el flujo de POST /api/supplier-payments (abono a OC o a cuenta general). */}
            <PagoProveedorDialog
                open={payTarget !== null}
                onOpenChange={open => { if (!open) setPayTarget(null) }}
                supplier={payTarget ? { id: payTarget.supplierId, name: payTarget.name } : null}
                purchases={payTarget?.ocsPendientes ?? []}
                onSaved={() => void fetchAll()}
            />
        </div>
    )
}
