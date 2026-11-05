"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export interface StockHealthDriftItem {
    productId: string
    name: string
    cachedStock: number
    branchesStock: number
    diff: number
}

export interface StockHealthResponse {
    ok: boolean
    totalChecked: number
    driftedCount: number
    drifted: StockHealthDriftItem[]
}

interface StockHealthBannerProps {
    onReconciled: () => void
}

export function StockHealthBanner({ onReconciled }: StockHealthBannerProps) {
    const [health, setHealth] = useState<StockHealthResponse | null>(null)
    const [reconciling, setReconciling] = useState(false)

    useEffect(() => {
        const controller = new AbortController()
        fetch("/api/inventory/health", { signal: controller.signal })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: StockHealthResponse | null) => {
                if (controller.signal.aborted || !data) return
                if (typeof data.driftedCount === "number" && Array.isArray(data.drifted)) {
                    setHealth(data)
                }
            })
            .catch(() => {})
        return () => controller.abort()
    }, [])

    if (!health || health.driftedCount <= 0) {
        return null
    }

    const previewItems = health.drifted.slice(0, 5)
    const remainingCount = Math.max(0, health.driftedCount - previewItems.length)

    const handleReconcile = async () => {
        setReconciling(true)
        try {
            const res = await fetch("/api/inventory/health", { method: "POST" })
            const data = await res.json().catch(() => null)
            if (!res.ok) {
                throw new Error(data?.error || "No se pudieron sincronizar las existencias")
            }
            toast.success("Existencias sincronizadas con la suma por sucursal")
            setHealth(null)
            onReconciled()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error al sincronizar existencias")
        } finally {
            setReconciling(false)
        }
    }

    return (
        <div
            role="alert"
            className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
        >
            <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1 text-sm">
                    <p className="font-medium text-amber-950 dark:text-amber-200">
                        {health.driftedCount === 1
                            ? "1 producto tiene diferencia entre su existencia total cacheada y la suma de sus sucursales."
                            : `${health.driftedCount} productos tienen diferencia entre su existencia total cacheada y la suma de sus sucursales.`}
                    </p>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                        {previewItems.map((item) => (
                            <li key={item.productId}>
                                {item.name}: total={item.cachedStock} vs sucursales={item.branchesStock}
                            </li>
                        ))}
                        {remainingCount > 0 && (
                            <li>y {remainingCount} más…</li>
                        )}
                    </ul>
                </div>
            </div>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReconcile}
                disabled={reconciling}
                className="shrink-0 border-amber-500/40 bg-background/80 hover:bg-amber-500/20"
            >
                {reconciling ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sincronizar existencias ahora
            </Button>
        </div>
    )
}
