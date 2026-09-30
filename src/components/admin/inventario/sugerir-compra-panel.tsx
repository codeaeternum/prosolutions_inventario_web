"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Check, ClipboardList, Loader2, PackageCheck, PackageSearch, Plus } from "lucide-react"
import { formatPrice } from "@/lib/utils"
import { toast } from "sonner"

interface Suggestion {
    productId: string
    name: string
    stock: number
    minStock: number
    encargosPendientes: number
    suggestedQty: number
    retailPrice: number
    alreadyInList: boolean
}

interface SugerirCompraPanelProps {
    /**
     * Se dispara después de agregar insumos para que el padre refresque la
     * lista de compras del almacén (pestaña Encargos).
     */
    onChanged?: () => void
}

/**
 * Tarjeta "qué conviene pedir": lee /api/inventory/sugerencias-compra y manda
 * cada pieza a la lista de compras (POST /api/encargos/compras → alta manual
 * ligada al producto). La cantidad sugerida se puede editar antes de agregar.
 */
export function SugerirCompraPanel({ onChanged }: SugerirCompraPanelProps) {
    const [suggestions, setSuggestions] = useState<Suggestion[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Captura editable por producto (string para no pelear con el tipeo).
    const [qty, setQty] = useState<Record<string, string>>({})
    // productId → true cuando YA quedó en la lista (en esta sesión o antes).
    const [added, setAdded] = useState<Record<string, boolean>>({})
    const [adding, setAdding] = useState<string | null>(null)
    const [addingAll, setAddingAll] = useState(false)
    // Llave idempotente por producto: si el POST falla por red, reintentar la
    // misma fila reutiliza la llave y el servidor devuelve el recibo guardado.
    const addKeys = useRef<Record<string, ClientOperationKey | null>>({})

    const fetchSuggestions = useCallback(async (signal?: AbortSignal) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/inventory/sugerencias-compra", { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar sugerencias")
            if (signal?.aborted) return
            const rows = (data?.suggestions ?? []) as Suggestion[]
            setSuggestions(rows)
            setQty(Object.fromEntries(rows.map(r => [r.productId, String(r.suggestedQty)])))
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar sugerencias")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchSuggestions(controller.signal))
        return () => controller.abort()
    }, [fetchSuggestions])

    const isInList = (s: Suggestion) => s.alreadyInList || Boolean(added[s.productId])

    /**
     * POST /api/encargos/compras — mismo contrato que el alta manual de la
     * lista (addShoppingItem): description puede ir vacía y el servidor copia
     * el nombre del producto; se manda explícita para que la fila quede clara.
     */
    const addOne = async (s: Suggestion): Promise<boolean> => {
        const quantity = parseInt(qty[s.productId] ?? "", 10)
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
            toast.error(`Cantidad inválida para ${s.name}: captura un entero entre 1 y 9,999`)
            return false
        }
        const payload = { description: s.name, productId: s.productId, quantity, unitCostCents: 0 }
        addKeys.current[s.productId] = getClientOperationKey(addKeys.current[s.productId] ?? null, payload)
        const res = await fetch("/api/encargos/compras", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, idempotencyKey: addKeys.current[s.productId]!.key }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(data?.error || `No se pudo agregar ${s.name}`)
        addKeys.current[s.productId] = null
        setAdded(prev => ({ ...prev, [s.productId]: true }))
        return true
    }

    const addSingle = async (s: Suggestion) => {
        if (adding || addingAll || isInList(s)) return
        setAdding(s.productId)
        try {
            if (await addOne(s)) {
                toast.success(`${s.name} agregado a la lista de compras`)
                onChanged?.()
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setAdding(null)
        }
    }

    /** Alta en serie (una por una, cada una con su propia llave idempotente). */
    const addAll = async () => {
        if (adding || addingAll) return
        const pending = suggestions.filter(s => !isInList(s))
        if (!pending.length) return
        setAddingAll(true)
        let ok = 0
        try {
            for (const s of pending) {
                if (await addOne(s)) ok++
            }
            if (ok > 0) {
                toast.success(ok === pending.length
                    ? `${ok} sugerencias agregadas a la lista de compras`
                    : `${ok} de ${pending.length} sugerencias agregadas`)
                onChanged?.()
            }
        } catch (e) {
            if (ok > 0) {
                toast.success(`${ok} sugerencias agregadas antes del error`)
                onChanged?.()
            }
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setAddingAll(false)
        }
    }

    const pendingCount = suggestions.filter(s => !isInList(s)).length
    const busy = adding !== null || addingAll

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <PackageSearch className="h-5 w-5 text-muted-foreground" />
                    Sugerencias de compra
                </CardTitle>
                <CardDescription>
                    Qué conviene pedir según el stock mínimo y los encargos que esperan pieza
                </CardDescription>
            </CardHeader>
            <CardContent>
                {error ? (
                    <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm">{error}</p>
                        <Button variant="outline" size="sm" onClick={() => void fetchSuggestions()}>Reintentar</Button>
                    </div>
                ) : loading ? (
                    <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                ) : suggestions.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <PackageCheck className="h-4 w-4" />
                        Sin sugerencias — stock saludable
                    </p>
                ) : (
                    <div className="space-y-2">
                        {suggestions.map(s => {
                            const inList = isInList(s)
                            return (
                                <div
                                    key={s.productId}
                                    className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-md border px-3 py-2"
                                >
                                    <div className="min-w-0 flex-1 basis-48">
                                        <p className="truncate text-sm font-medium">{s.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            tienes {s.stock} / mínimo {s.minStock} · {formatPrice(s.retailPrice)}
                                        </p>
                                    </div>
                                    {s.encargosPendientes > 0 && (
                                        <Badge variant="warning">
                                            {s.encargosPendientes} pza{s.encargosPendientes === 1 ? "" : "s"} en encargos
                                        </Badge>
                                    )}
                                    <Input
                                        type="number"
                                        min={1}
                                        max={9999}
                                        step={1}
                                        className="h-8 w-20 text-right"
                                        value={qty[s.productId] ?? ""}
                                        onChange={e => setQty(prev => ({ ...prev, [s.productId]: e.target.value }))}
                                        disabled={busy || inList}
                                        aria-label={`Cantidad a pedir de ${s.name}`}
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={inList ? "ghost" : "outline"}
                                        disabled={busy || inList}
                                        onClick={() => void addSingle(s)}
                                    >
                                        {adding === s.productId ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : inList ? (
                                            <><Check className="mr-1 h-4 w-4" /> En la lista</>
                                        ) : (
                                            <><Plus className="mr-1 h-4 w-4" /> Agregar a la lista</>
                                        )}
                                    </Button>
                                </div>
                            )
                        })}
                        {pendingCount > 0 && (
                            <div className="flex justify-end pt-1">
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => void addAll()}
                                    disabled={busy}
                                >
                                    {addingAll ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <ClipboardList className="mr-2 h-4 w-4" />
                                    )}
                                    Agregar todas ({pendingCount})
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
