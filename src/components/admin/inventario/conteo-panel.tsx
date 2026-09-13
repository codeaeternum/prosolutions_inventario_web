"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CheckCircle2, ClipboardList, History, Loader2, Save, Search, XCircle } from "lucide-react"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"

type CountStatus = "OPEN" | "APPLIED" | "CANCELLED"

interface CountSummary {
    id: string
    folio: string
    status: CountStatus
    notes: string | null
    branch: { id: string; name: string }
    createdBy: { id: string; name: string } | null
    appliedAt: string | null
    createdAt: string
    itemCount: number
    diffCount: number
}

interface CountDetail extends Omit<CountSummary, "itemCount"> {
    items: {
        id: string
        productId: string
        expectedQty: number
        countedQty: number
        product: { id: string; name: string; barcode: string | null }
    }[]
}

interface EditableRow {
    productId: string
    name: string
    barcode: string | null
    expected: number
    counted: string
    dirty: boolean
}

interface SearchProduct {
    id: string
    name: string
    barcode: string | null
    stock: number
}

const STATUS_CONFIG: Record<CountStatus, { label: string; className: string }> = {
    OPEN: { label: "Abierto", className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300" },
    APPLIED: { label: "Aplicado", className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300" },
    CANCELLED: { label: "Cancelado", className: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300" },
}

function diffOf(row: EditableRow): number | null {
    const counted = parseInt(row.counted)
    if (!Number.isInteger(counted) || counted < 0) return null
    return counted - row.expected
}

interface ConteoPanelProps {
    /** Conteo recién creado: se selecciona al refrescar la lista. */
    focusCountId?: string | null
    /** Al cambiar, recarga la lista de conteos. */
    refreshKey?: number
    /** Se llama tras aplicar un conteo (las existencias cambiaron). */
    onChanged?: () => void
}

export function ConteoPanel({ focusCountId, refreshKey = 0, onChanged }: ConteoPanelProps) {
    const [counts, setCounts] = useState<CountSummary[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [activeId, setActiveId] = useState<string | null>(null)
    const [detailData, setDetailData] = useState<CountDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [rows, setRows] = useState<EditableRow[]>([])

    const [search, setSearch] = useState("")
    const [results, setResults] = useState<SearchProduct[]>([])
    const [searching, setSearching] = useState(false)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [saving, setSaving] = useState(false)
    const [acting, setActing] = useState(false)
    const [confirmApply, setConfirmApply] = useState(false)
    const [confirmCancel, setConfirmCancel] = useState(false)
    const saveOp = useRef<ClientOperationKey | null>(null)
    const actOp = useRef<ClientOperationKey | null>(null)

    const fetchCounts = useCallback(async (signal?: AbortSignal) => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/inventory/counts", { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar conteos")
            if (!signal?.aborted) setCounts(data?.counts ?? [])
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar conteos")
        } finally {
            if (!signal?.aborted) setLoading(false)
        }
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        // Diferido a un callback: setState sincrónico en el cuerpo del efecto está prohibido.
        void Promise.resolve().then(() => fetchCounts(controller.signal))
        return () => controller.abort()
    }, [fetchCounts, refreshKey])

    const openCounts = useMemo(() => counts.filter(c => c.status === "OPEN"), [counts])
    const history = useMemo(() => counts.filter(c => c.status !== "OPEN"), [counts])

    // Selección derivada (sin efecto): la elección manual tiene prioridad,
    // luego el conteo recién creado y al final el primero disponible.
    const selectedId = useMemo(() => {
        if (activeId && openCounts.some(c => c.id === activeId)) return activeId
        if (focusCountId && openCounts.some(c => c.id === focusCountId)) return focusCountId
        return openCounts[0]?.id ?? null
    }, [activeId, openCounts, focusCountId])

    const fetchDetail = useCallback(async (id: string, signal?: AbortSignal) => {
        setDetailLoading(true)
        try {
            const res = await fetch(`/api/inventory/counts/${id}`, { signal })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar el conteo")
            if (signal?.aborted) return
            const count = data?.count as CountDetail
            setDetailData(count)
            setRows(count.items.map(i => ({
                productId: i.productId,
                name: i.product.name,
                barcode: i.product.barcode,
                expected: i.expectedQty,
                counted: String(i.countedQty),
                dirty: false,
            })))
        } catch (e) {
            if (!signal?.aborted) {
                toast.error(e instanceof Error ? e.message : "Error al cargar el conteo")
            }
        } finally {
            if (!signal?.aborted) setDetailLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!selectedId) return
        const controller = new AbortController()
        void Promise.resolve().then(() => fetchDetail(selectedId, controller.signal))
        return () => controller.abort()
    }, [selectedId, fetchDetail])

    // Solo se usa el detalle que corresponde a la selección; el estado anterior
    // queda oculto mientras llega el fetch del nuevo conteo.
    const detail = selectedId && detailData?.id === selectedId ? detailData : null

    // Búsqueda de productos para agregar al conteo (stock por sucursal del conteo).
    const searchProducts = useCallback(async (query: string, branchId: string) => {
        if (query.trim().length < 2) {
            setResults([])
            return
        }
        setSearching(true)
        try {
            const res = await fetch(`/api/search/pos?q=${encodeURIComponent(query.trim())}&branchId=${branchId}`)
            const data = await res.json().catch(() => null)
            setResults(res.ok ? (data?.products ?? []) : [])
        } catch {
            setResults([])
        } finally {
            setSearching(false)
        }
    }, [])

    useEffect(() => {
        const branchId = detail?.branch.id
        debounceRef.current = setTimeout(() => {
            if (branchId) void searchProducts(search, branchId)
            else setResults([])
        }, 300)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [search, detail?.branch.id, searchProducts])

    const addProduct = (product: SearchProduct) => {
        setRows(prev => {
            if (prev.some(r => r.productId === product.id)) {
                toast.info(`${product.name} ya está en el conteo.`)
                return prev
            }
            return [...prev, {
                productId: product.id,
                name: product.name,
                barcode: product.barcode,
                expected: product.stock,
                counted: String(product.stock),
                dirty: true,
            }]
        })
        setSearch("")
        setResults([])
    }

    const updateCounted = (productId: string, value: string) => {
        setRows(prev => prev.map(r => r.productId === productId ? { ...r, counted: value, dirty: true } : r))
    }

    const hasDirty = rows.some(r => r.dirty)
    const allValid = rows.every(r => diffOf(r) !== null)
    const diffRows = rows.filter(r => (diffOf(r) ?? 0) !== 0)
    // Para el resumen del confirm se usan los items persistidos (lo que aplicará el servidor).
    const savedDiffs = detail?.items.filter(i => i.countedQty !== i.expectedQty) ?? []
    const savedPositive = savedDiffs.reduce((sum, i) => sum + Math.max(0, i.countedQty - i.expectedQty), 0)
    const savedNegative = savedDiffs.reduce((sum, i) => sum + Math.max(0, i.expectedQty - i.countedQty), 0)

    const saveRows = useCallback(async (): Promise<boolean> => {
        if (!detail || saving) return false
        const items = rows.map(r => ({ productId: r.productId, countedQty: parseInt(r.counted) }))
        saveOp.current = getClientOperationKey(saveOp.current, { countId: detail.id, items })
        setSaving(true)
        try {
            const res = await fetch(`/api/inventory/counts/${detail.id}/items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items, idempotencyKey: saveOp.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo guardar la captura.")
            saveOp.current = null
            await fetchDetail(detail.id)
            return true
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta guardar la captura.")
            return false
        } finally {
            setSaving(false)
        }
    }, [detail, rows, saving, fetchDetail])

    const handleSave = async () => {
        if (!allValid) return toast.error("Revisa las cantidades: deben ser enteros de 0 o más.")
        if (await saveRows()) toast.success("Captura guardada")
    }

    /** Aplicar con cambios sin guardar primero los persiste (el servidor solo ve items guardados). */
    const handleApplyClick = async () => {
        if (!detail) return
        if (hasDirty) {
            if (!allValid) return toast.error("Revisa las cantidades: deben ser enteros de 0 o más.")
            if (!(await saveRows())) return
        }
        setConfirmApply(true)
    }

    const confirmAction = async (action: "apply" | "cancel") => {
        if (!detail || acting) return
        const payload = { action }
        actOp.current = getClientOperationKey(actOp.current, payload)
        setActing(true)
        try {
            const res = await fetch(`/api/inventory/counts/${detail.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: actOp.current.key }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo completar la acción.")
            actOp.current = null
            if (action === "apply") {
                toast.success(`Conteo ${detail.folio} aplicado`, {
                    description: `${data?.adjustments ?? 0} ajuste(s) de inventario en ${detail.branch.name}`,
                })
                onChanged?.()
            } else {
                toast.success(`Conteo ${detail.folio} cancelado`, { description: "No se modificó el inventario." })
            }
            setConfirmApply(false)
            setConfirmCancel(false)
            setActiveId(null)
            void fetchCounts()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Error de conexión. Reintenta la misma acción.")
        } finally {
            setActing(false)
        }
    }

    // Nada que mostrar: sin conteo abierto ni historial.
    if (!loading && !error && counts.length === 0) return null

    return (
        <div className="space-y-4">
            {error && (
                <div role="alert" className="rounded-lg border p-4 flex items-center justify-between gap-3">
                    <p className="text-sm">{error}</p>
                    <Button variant="outline" size="sm" onClick={() => void fetchCounts()}>Reintentar</Button>
                </div>
            )}

            {openCounts.length > 0 && (
                <Card className="border-blue-200 dark:border-blue-900">
                    <CardHeader className="pb-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <ClipboardList className="h-5 w-5 text-blue-600" />
                                    Conteo abierto — {detail?.branch.name ?? openCounts[0].branch.name}
                                </CardTitle>
                                <CardDescription>
                                    {detail
                                        ? `${detail.folio} · ${rows.length} producto${rows.length === 1 ? "" : "s"} capturado${rows.length === 1 ? "" : "s"}, ${diffRows.length} con diferencia`
                                        : "Cargando captura…"}
                                    {detail?.createdBy && ` · por ${detail.createdBy.name}`}
                                    {detail && ` · ${formatDate(detail.createdAt)}`}
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2">
                                {hasDirty && (
                                    <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300">
                                        Sin guardar
                                    </Badge>
                                )}
                                {openCounts.length > 1 && (
                                    <Select value={selectedId ?? ""} onValueChange={setActiveId}>
                                        <SelectTrigger className="w-56">
                                            <SelectValue placeholder="Conteo por sucursal" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {openCounts.map(c => (
                                                <SelectItem key={c.id} value={c.id}>
                                                    {c.branch.name} — {c.folio}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {detailLoading && !detail ? (
                            <div className="flex items-center justify-center h-32">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : detail ? (
                            <>
                                {/* Agregar productos al conteo */}
                                <div className="space-y-2 relative">
                                    <div className="relative sm:max-w-sm">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            placeholder="Agregar producto por nombre o código..."
                                            aria-label="Buscar producto para agregar al conteo"
                                            className="pl-9"
                                        />
                                    </div>
                                    {(results.length > 0 || searching) && (
                                        <div className="absolute z-10 w-full sm:max-w-md border rounded-lg shadow-lg bg-background max-h-56 overflow-y-auto">
                                            {searching && results.length === 0 ? (
                                                <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
                                                </div>
                                            ) : results.map(p => (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    className="w-full text-left p-3 hover:bg-muted border-b last:border-0 flex justify-between items-center gap-2"
                                                    onClick={() => addProduct(p)}
                                                >
                                                    <div className="min-w-0">
                                                        <p className="font-medium truncate">{p.name}</p>
                                                        <p className="text-xs text-muted-foreground">{p.barcode || "Sin código"}</p>
                                                    </div>
                                                    <span className="text-xs bg-muted px-2 py-1 rounded shrink-0">
                                                        En {detail.branch.name}: {p.stock}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {rows.length === 0 ? (
                                    <div className="text-center py-8 border rounded-xl bg-muted/20 border-dashed">
                                        <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                                        <p className="text-muted-foreground text-sm">
                                            Busca productos para capturar lo que hay físicamente en {detail.branch.name}.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="rounded-md border overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="min-w-[200px]">Producto</TableHead>
                                                    <TableHead className="text-center">Sistema</TableHead>
                                                    <TableHead className="text-center w-32">Contado</TableHead>
                                                    <TableHead className="text-center">Diferencia</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {rows.map(row => {
                                                    const diff = diffOf(row)
                                                    return (
                                                        <TableRow key={row.productId} className={row.dirty ? "bg-yellow-50/50 dark:bg-yellow-900/10" : ""}>
                                                            <TableCell>
                                                                <p className="font-medium leading-tight">{row.name}</p>
                                                                <p className="text-xs text-muted-foreground">{row.barcode || "Sin código"}</p>
                                                            </TableCell>
                                                            <TableCell className="text-center tabular-nums text-muted-foreground">
                                                                {row.expected}
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    value={row.counted}
                                                                    onChange={(e) => updateCounted(row.productId, e.target.value)}
                                                                    className="h-9 w-24 mx-auto text-center tabular-nums"
                                                                    aria-label={`Cantidad contada de ${row.name}`}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                {diff === null ? (
                                                                    <Badge variant="outline" className="text-muted-foreground">—</Badge>
                                                                ) : diff === 0 ? (
                                                                    <Badge variant="outline" className="text-muted-foreground">0</Badge>
                                                                ) : diff > 0 ? (
                                                                    <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300">
                                                                        +{diff}
                                                                    </Badge>
                                                                ) : (
                                                                    <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300">
                                                                        {diff}
                                                                    </Badge>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}

                                <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                                    <Button
                                        variant="outline"
                                        onClick={() => setConfirmCancel(true)}
                                        disabled={saving || acting}
                                        className="text-red-600"
                                    >
                                        <XCircle className="mr-2 h-4 w-4" />
                                        Cancelar conteo
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={handleSave}
                                        disabled={saving || acting || !hasDirty || !allValid}
                                    >
                                        {saving
                                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            : <Save className="mr-2 h-4 w-4" />}
                                        Guardar captura
                                    </Button>
                                    <Button
                                        onClick={() => void handleApplyClick()}
                                        disabled={saving || acting || rows.length === 0 || !allValid}
                                    >
                                        {acting
                                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                        Aplicar ajustes
                                    </Button>
                                </div>
                            </>
                        ) : null}
                    </CardContent>
                </Card>
            )}

            {history.length > 0 && (
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <History className="h-5 w-5 text-muted-foreground" />
                            Conteos anteriores
                        </CardTitle>
                        <CardDescription>
                            Sesiones de conteo físico aplicadas o canceladas
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Folio</TableHead>
                                        <TableHead>Sucursal</TableHead>
                                        <TableHead className="text-center">Productos</TableHead>
                                        <TableHead className="text-center">Diferencias</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="hidden sm:table-cell">Capturado por</TableHead>
                                        <TableHead className="hidden md:table-cell">Fecha</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {history.map(c => {
                                        const config = STATUS_CONFIG[c.status]
                                        return (
                                            <TableRow key={c.id}>
                                                <TableCell className="font-medium whitespace-nowrap">{c.folio}</TableCell>
                                                <TableCell>{c.branch.name}</TableCell>
                                                <TableCell className="text-center tabular-nums">{c.itemCount}</TableCell>
                                                <TableCell className="text-center tabular-nums">
                                                    {c.status === "APPLIED" ? c.diffCount : "—"}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={config.className}>
                                                        {config.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                                                    {c.createdBy?.name ?? "—"}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground whitespace-nowrap">
                                                    {formatDate(c.appliedAt ?? c.createdAt)}
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Confirmación: aplicar ajustes */}
            <AlertDialog open={confirmApply} onOpenChange={setConfirmApply}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Aplicar los ajustes del conteo {detail?.folio}?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div className="space-y-2">
                                <p>
                                    El stock de {detail?.branch.name} quedará en lo contado físicamente
                                    y cada diferencia quedará registrada como ajuste auditado.
                                </p>
                                {savedDiffs.length === 0 ? (
                                    <p>No hay diferencias: el inventario ya coincide con el conteo.</p>
                                ) : (
                                    <ul className="list-disc pl-5 space-y-1">
                                        <li>{savedDiffs.length} producto{savedDiffs.length === 1 ? "" : "s"} con diferencia</li>
                                        {savedPositive > 0 && <li>+{savedPositive} unidad{savedPositive === 1 ? "" : "es"} entran</li>}
                                        {savedNegative > 0 && <li>-{savedNegative} unidad{savedNegative === 1 ? "" : "es"} salen</li>}
                                    </ul>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={acting}>Volver</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void confirmAction("apply")} disabled={acting}>
                            {acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Aplicar ajustes
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Confirmación: cancelar conteo */}
            <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Cancelar el conteo {detail?.folio}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            La captura se descarta y no se modifica el inventario. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={acting}>Volver</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void confirmAction("cancel")} disabled={acting}>
                            {acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Cancelar conteo
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
