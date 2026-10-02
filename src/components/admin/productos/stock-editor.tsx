"use client"

import { useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, Minus, Plus } from "lucide-react"
import { toast } from "sonner"

// Misma llave que usa BranchSwitcher para recordar la sucursal elegida.
export const BRANCH_PREFERENCE_KEY = "reficio-branch"

/**
 * Sucursal elegida en el selector del encabezado: cookie > localStorage.
 * Devuelve null si no hay preferencia (el servidor cae a home/principal).
 */
export function readPreferredBranchId(): string | null {
    if (typeof window === "undefined") return null
    const match = document.cookie.match(new RegExp(`(?:^|; )${BRANCH_PREFERENCE_KEY}=([^;]*)`))
    const fromCookie = match ? decodeURIComponent(match[1]) : null
    return fromCookie || localStorage.getItem(BRANCH_PREFERENCE_KEY) || null
}

/**
 * Ajuste de existencias reutilizable: POST /api/inventory con ADJUSTMENT_IN/OUT
 * según el signo del delta. `operation` conserva la llave entre reintentos del
 * mismo cambio para que un retry tras timeout no aplique el ajuste dos veces.
 */
export async function adjustBranchStock(input: {
    productId: string
    delta: number
    branchId?: string | null
    reason: string
    operation: { current: ClientOperationKey | null }
}): Promise<void> {
    const payload = {
        productId: input.productId,
        type: input.delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: Math.abs(input.delta),
        reason: input.reason,
        ...(input.branchId ? { branchId: input.branchId } : {}),
    }
    input.operation.current = getClientOperationKey(input.operation.current, payload)
    const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: input.operation.current.key }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || "No se pudo ajustar el stock.")
    input.operation.current = null
}

interface StockQtyEditorProps {
    productId: string
    /** Nombre del producto (aria-labels). */
    productName?: string
    /** Existencias actuales en la sucursal objetivo. */
    quantity: number
    /** Sucursal a ajustar; null/undefined = la que resuelva el servidor. */
    branchId?: string | null
    /** stepper: [-] qty [+] · cell: número que se vuelve input al hacer click. */
    variant?: "stepper" | "cell"
    disabled?: boolean
    reason?: string
    /** Se llama con el delta aplicado tras confirmar el ajuste. */
    onAdjusted?: (delta: number) => void
}

const DEFAULT_REASON = "Ajuste rápido de existencias"

export function StockQtyEditor({
    productId,
    productName,
    quantity,
    branchId,
    variant = "stepper",
    disabled,
    reason = DEFAULT_REASON,
    onAdjusted,
}: StockQtyEditorProps) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState("")
    const [pending, setPending] = useState(false)
    // El flag en ref evita doble-submit por clicks rápidos (el estado llega
    // tarde un render); la idempotencyKey ya cubre el caso servidor-side.
    const inFlight = useRef(false)
    const operation = useRef<ClientOperationKey | null>(null)

    const commit = async (target: number) => {
        if (inFlight.current) return
        setEditing(false)
        // NaN (campo vacío al salir) o inválido: cancela sin ruido.
        if (!Number.isInteger(target) || target < 0) return
        const delta = target - quantity
        if (delta === 0) return
        inFlight.current = true
        setPending(true)
        try {
            await adjustBranchStock({ productId, delta, branchId, reason, operation })
            onAdjusted?.(delta)
            // Undo: la reversa queda como movimiento compensatorio en el
            // historial (el ajuste original no se borra — auditoría intacta).
            const undone = { current: null }
            toast.success(`${delta > 0 ? "+" : ""}${delta} · ${productName ?? "producto"}`, {
                description: `Quedan ${target} en existencia`,
                action: {
                    label: "Deshacer",
                    onClick: () => {
                        void (async () => {
                            try {
                                await adjustBranchStock({
                                    productId,
                                    delta: -delta,
                                    branchId,
                                    reason: "Reversa de ajuste rápido",
                                    operation: undone,
                                })
                                onAdjusted?.(-delta)
                            } catch (e) {
                                toast.error(e instanceof Error ? e.message : "No se pudo revertir el ajuste.")
                            }
                        })()
                    },
                },
            })
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "No se pudo ajustar el stock. Reintenta.")
        } finally {
            inFlight.current = false
            setPending(false)
        }
    }

    const startEditing = () => {
        if (disabled || pending) return
        setDraft(String(quantity))
        setEditing(true)
    }

    const editorInput = (
        <Input
            autoFocus
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commit(parseInt(draft, 10))}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault()
                    void commit(parseInt(draft, 10))
                } else if (e.key === "Escape") {
                    setEditing(false)
                }
            }}
            aria-label={`Existencias de ${productName ?? "producto"}`}
            className="h-7 w-16 px-1 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
    )

    if (variant === "cell") {
        if (editing) return editorInput
        return (
            <button
                type="button"
                onClick={startEditing}
                disabled={disabled || pending}
                title="Click para ajustar existencias en esta sucursal"
                className={`inline-flex min-w-8 items-center justify-center rounded px-1 py-0.5 tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${quantity === 0 ? "text-muted-foreground/50" : ""}`}
            >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : quantity}
            </button>
        )
    }

    return (
        <div
            className="inline-flex items-center gap-0.5"
            // La fila de la lista es un Link: evita que el click navegue al detalle.
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
            }}
        >
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled || pending || quantity <= 0}
                onClick={() => void commit(quantity - 1)}
                title={`Quitar 1 a ${productName ?? "producto"}`}
                aria-label={`Quitar 1 a ${productName ?? "producto"}`}
            >
                <Minus className="h-3.5 w-3.5" />
            </Button>
            {editing ? (
                editorInput
            ) : (
                <button
                    type="button"
                    onClick={startEditing}
                    disabled={disabled || pending}
                    title="Click para capturar existencias"
                    className="inline-flex min-w-8 items-center justify-center rounded px-1 py-0.5 text-center font-semibold tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                    {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : quantity}
                </button>
            )}
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled || pending}
                onClick={() => void commit(quantity + 1)}
                title={`Agregar 1 a ${productName ?? "producto"}`}
                aria-label={`Agregar 1 a ${productName ?? "producto"}`}
            >
                <Plus className="h-3.5 w-3.5" />
            </Button>
        </div>
    )
}
