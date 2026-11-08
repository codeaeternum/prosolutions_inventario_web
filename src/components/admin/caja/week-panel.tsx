"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { formatPrice, formatDay } from "@/lib/utils"
import { CalendarDays, ExternalLink } from "lucide-react"

interface WeekRegister {
    id: string
    branch: { id: string; name: string } | null
    openedAt: string
    closedAt: string
    openedBy: { name: string }
    closedBy: { name: string } | null
    initialAmount: number
    finalAmount: number | null
    expectedCash: number
    difference: number | null
    notes: string | null
}

/** Cortes cerrados de los últimos 7 días (GET /api/caja?view=week). */
export function WeekPanel(props: { branchId: string; refreshKey: number }) {
    const [registers, setRegisters] = useState<WeekRegister[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/caja?view=week${props.branchId ? `&branchId=${props.branchId}` : ""}`)
            .then(res => (res.ok ? res.json() : null))
            .then(data => { if (!cancelled) setRegisters(data?.registers ?? []) })
            .catch(() => { if (!cancelled) toast.error("Error al cargar la semana") })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [props.branchId, props.refreshKey])

    if (loading) return <p className="text-sm text-muted-foreground text-center py-8">Cargando cortes…</p>
    if (registers.length === 0) return <p className="text-sm text-muted-foreground text-center py-8">Sin cortes en los últimos 7 días.</p>

    return (
        <div className="space-y-3">
            {registers.map(reg => (
                <div key={reg.id} className="rounded-lg border p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="font-medium flex items-center gap-2">
                                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                                {formatDay(reg.closedAt)} · {reg.branch?.name ?? "Sin sucursal"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Abrió {reg.openedBy.name} · cerró {reg.closedBy?.name ?? "—"}
                            </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => window.open(`/admin/tickets/corte/${reg.id}`, "_blank")}>
                            <ExternalLink className="w-4 h-4 mr-1" /> Ver corte
                        </Button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                            <p className="text-xs text-muted-foreground">Fondo inicial</p>
                            <p className="font-semibold">{formatPrice(reg.initialAmount)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Contado</p>
                            <p className="font-semibold">{reg.finalAmount == null ? "—" : formatPrice(reg.finalAmount)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Esperado</p>
                            <p className="font-semibold">{formatPrice(reg.expectedCash)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground">Diferencia</p>
                            <p className={`font-semibold ${reg.difference == null ? "" : reg.difference > 0 ? "text-green-600 dark:text-green-400" : reg.difference < 0 ? "text-destructive" : ""}`}>
                                {reg.difference == null ? "—" : reg.difference === 0 ? "Cuadrada" : `${reg.difference > 0 ? "+" : ""}${formatPrice(reg.difference)}`}
                            </p>
                        </div>
                    </div>
                    {reg.notes && <p className="text-xs text-muted-foreground border-t pt-2">Notas: {reg.notes}</p>}
                </div>
            ))}
        </div>
    )
}
