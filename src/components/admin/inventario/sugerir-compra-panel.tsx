"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Check, ClipboardList, Handshake, Loader2, PackageCheck, PackageSearch, Plus, Store } from "lucide-react"
import { formatPrice } from "@/lib/utils"
import { toast } from "sonner"

/** Oferta de un aliado del mercado B2B (GET /api/inventory/sugerencias-compra). */
interface AllyInfo {
    businessId: string
    businessName: string
    /**
     * Id del producto EN EL CATÁLOGO DEL ALIADO (distinto del `productId`
     * propio de la sugerencia): es el que va en el POST de la solicitud.
     */
    productId: string
    stock: number
    /** Precio aliado = wholesalePrice ?? retailPrice del producto del aliado. */
    price: number
}

interface Suggestion {
    productId: string
    name: string
    stock: number
    minStock: number
    encargosPendientes: number
    /** Piezas vendidas (netas de devoluciones) en los últimos 30 días. */
    ventas30d: number
    suggestedQty: number
    retailPrice: number
    alreadyInList: boolean
    /** Aliados con la pieza en existencia (vacío si ninguno la publica). */
    aliados?: AllyInfo[]
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
 * Bajo el nombre, chips de aliados muestran qué negocio del mercado B2B la
 * tiene en existencia y a qué precio aliado — cada chip es un botón "Pedir"
 * que manda la solicitud directo a ese aliado (POST /api/marketplace/requests,
 * mismo contrato que el "Pedirla" de encargos) con la cantidad capturada en
 * la fila — así el dueño decide entre "pedir a proveedor" y "pedir al aliado".
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
    // "Pedir al aliado": chip `${productId}:${businessId}` en vuelo / ya pedido.
    const [requesting, setRequesting] = useState<string | null>(null)
    const [requested, setRequested] = useState<Record<string, boolean>>({})
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

    /**
     * "Pedir" a un aliado desde la sugerencia: POST /api/marketplace/requests
     * con el productId DEL CATÁLOGO ALIADO (no el nuestro) y la cantidad
     * capturada en la fila. Mismo contrato que el "Pedirla" de encargos:
     * sin tallerName — en pedidos a OTRO negocio el servidor lo deriva del
     * nombre de nuestro negocio — y nota con contexto de dónde sale el pedido.
     * El endpoint no admite llave idempotente: el guardrail es el estado
     * `requesting` (un envío a la vez) + `requested` (el chip queda apagado).
     */
    const requestFromAlly = async (s: Suggestion, a: AllyInfo) => {
        const chipKey = `${s.productId}:${a.businessId}`
        if (busy || requesting || requested[chipKey]) return
        const quantity = parseInt(qty[s.productId] ?? "", 10)
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
            toast.error(`Cantidad inválida para pedir ${s.name}: captura un entero entre 1 y 9,999`)
            return
        }
        setRequesting(chipKey)
        try {
            const res = await fetch("/api/marketplace/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId: a.productId,
                    qty: quantity,
                    note: `Sugerencia de compra: ${s.name} (tienes ${s.stock} / mínimo ${s.minStock})`,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.error || `El aliado no recibió la solicitud`)
            setRequested(prev => ({ ...prev, [chipKey]: true }))
            toast.success(`Solicitud enviada a ${a.businessName}`, {
                description: `${quantity} × ${s.name} — la verás en Mercado → Pedidos que hago.`,
            })
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setRequesting(null)
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
                    Qué conviene pedir según el stock mínimo, los encargos que esperan pieza y la rotación del mes
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
                            const aliados = s.aliados ?? []
                            return (
                                <div
                                    key={s.productId}
                                    className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-md border px-3 py-2"
                                >
                                    <div className="min-w-0 flex-1 basis-48">
                                        <p className="truncate text-sm font-medium">{s.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            tienes {s.stock} / mínimo {s.minStock} · {formatPrice(s.retailPrice)}
                                            {s.ventas30d > 0 && <> · vende {s.ventas30d}/mes</>}
                                        </p>
                                        {/* Chips accionables: qué aliado la tiene y a qué precio —
                                            cada uno pide la pieza directo a ese negocio con la
                                            cantidad de la fila (queda "Pedida" al confirmarse). */}
                                        {aliados.length > 0 && (
                                            <div className="mt-1 flex flex-wrap items-center gap-1">
                                                <Store className="h-3 w-3 shrink-0 text-muted-foreground" />
                                                <span className="mr-0.5 text-[11px] text-muted-foreground">
                                                    la tiene:
                                                </span>
                                                {aliados.map(a => {
                                                    const chipKey = `${s.productId}:${a.businessId}`
                                                    const done = Boolean(requested[chipKey])
                                                    const sendingThis = requesting === chipKey
                                                    return (
                                                        <Button
                                                            key={a.businessId}
                                                            type="button"
                                                            size="xs"
                                                            variant={done ? "ghost" : "secondary"}
                                                            disabled={busy || requesting !== null || done}
                                                            onClick={() => void requestFromAlly(s, a)}
                                                            title={done
                                                                ? `Solicitud enviada a ${a.businessName}`
                                                                : `Pedir a ${a.businessName} — ${a.stock} en existencia · ${formatPrice(a.price)} precio aliado`}
                                                            className="max-w-64 font-normal"
                                                        >
                                                            {sendingThis ? (
                                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                            ) : done ? (
                                                                <Check className="h-3 w-3" />
                                                            ) : (
                                                                <Handshake className="h-3 w-3" />
                                                            )}
                                                            <span className="truncate">{a.businessName}</span>
                                                            <span aria-hidden>·</span>
                                                            {formatPrice(a.price)}
                                                            <span aria-hidden>·</span>
                                                            {done ? "Pedida" : "Pedir"}
                                                        </Button>
                                                    )
                                                })}
                                            </div>
                                        )}
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
