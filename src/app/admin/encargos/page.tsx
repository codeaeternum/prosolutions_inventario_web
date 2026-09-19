"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { formatDate, formatPrice } from "@/lib/utils"
import { ClipboardList, PackageSearch, PackageX, ShoppingCart, Check, X, Wrench, Loader2 } from "lucide-react"

interface ShortageOrder { orderId: string; number: number; qty: number; folio?: string }
interface ShortageRow {
    productId: string
    name: string
    needed: number
    available: number
    shortage: number
    costPrice: number | null
    orders: ShortageOrder[]
}
interface LowStockRow {
    productId: string
    name: string
    stock: number
    minStock: number
    suggested: number
    costPrice: number | null
}
interface ManualRow {
    id: string
    description: string
    quantity: number
    unitCostCents: number
    notes: string | null
    createdAt: string
    product: { id: string; name: string } | null
    createdBy: { id: string; name: string } | null
    purchase: { id: string; number: number } | null
}
interface Needs {
    partsShortage: ShortageRow[]
    lowStock: LowStockRow[]
    manual: ManualRow[]
}

const orderFolio = (number: number) => `OT-${String(number).padStart(6, "0")}`
const cents = (value: number | null | undefined) => Math.round((value ?? 0) * 100)

export default function EncargosPage() {
    const router = useRouter()
    const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
    const [branchId, setBranchId] = useState("")
    const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
    const [needs, setNeeds] = useState<Needs>({ partsShortage: [], lowStock: [], manual: [] })
    const [loading, setLoading] = useState(true)

    // Selección para la orden de compra
    const [partChecked, setPartChecked] = useState<Record<string, boolean>>({})
    const [lowChecked, setLowChecked] = useState<Record<string, boolean>>({})
    const [manualChecked, setManualChecked] = useState<Record<string, boolean>>({})
    const [supplierId, setSupplierId] = useState("none")
    const [ocNotes, setOcNotes] = useState("")
    const [busy, setBusy] = useState(false)

    // Alta manual
    const [description, setDescription] = useState("")
    const [quantity, setQuantity] = useState("1")
    const [unitCost, setUnitCost] = useState("")
    const [notes, setNotes] = useState("")
    const addKey = useRef<ClientOperationKey | null>(null)
    const ocKey = useRef<ClientOperationKey | null>(null)
    const resolveKeys = useRef<Record<string, ClientOperationKey | null>>({})

    const fetchNeeds = useCallback(async () => {
        try {
            const res = await fetch(`/api/encargos${branchId ? `?branchId=${branchId}` : ""}`)
            const data = await res.json()
            if (res.ok) setNeeds({ partsShortage: data.partsShortage ?? [], lowStock: data.lowStock ?? [], manual: data.manual ?? [] })
        } catch {
            toast.error("Error al cargar la lista de encargos")
        } finally {
            setLoading(false)
        }
    }, [branchId])

    useEffect(() => {
        fetch("/api/branches").then(r => (r.ok ? r.json() : null)).then(d => {
            const list = (d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive)
            setBranches(list)
            if (list.length) setBranchId(prev => prev || list[0].id)
        }).catch(() => {})
        fetch("/api/suppliers").then(r => (r.ok ? r.json() : null)).then(d => {
            setSuppliers((d?.suppliers ?? []).filter((s: { isActive: boolean }) => s.isActive))
        }).catch(() => {})
    }, [])

    useEffect(() => {
        const timer = setTimeout(() => { if (branchId || branches.length === 0) void fetchNeeds() }, 0)
        return () => clearTimeout(timer)
    }, [branchId, branches.length, fetchNeeds])

    // --- Selección → líneas de la OC ---
    const selectedItems = () => {
        const map = new Map<string, { productId: string; quantity: number; unitCostCents: number }>()
        for (const row of needs.partsShortage) {
            if (!partChecked[row.productId]) continue
            map.set(row.productId, { productId: row.productId, quantity: row.shortage, unitCostCents: cents(row.costPrice) })
        }
        for (const row of needs.lowStock) {
            if (!lowChecked[row.productId]) continue
            const prev = map.get(row.productId)
            // Mismo producto en ambas secciones: la mayor cantidad cubre las dos demandas.
            map.set(row.productId, { productId: row.productId, quantity: Math.max(prev?.quantity ?? 0, row.suggested), unitCostCents: prev?.unitCostCents ?? cents(row.costPrice) })
        }
        return [...map.values()]
    }
    const manualIds = needs.manual.filter(item => manualChecked[item.id]).map(item => item.id)
    const selectionCount = selectedItems().length + manualIds.length

    const addManual = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy) return
        const qty = parseInt(quantity, 10)
        if (!description.trim()) return toast.error("Describe qué hay que comprar")
        if (!Number.isInteger(qty) || qty < 1 || qty > 9999) return toast.error("La cantidad debe ser un entero entre 1 y 9,999")
        const cost = unitCost.trim() === "" ? 0 : parseFloat(unitCost)
        if (!Number.isFinite(cost) || cost < 0) return toast.error("El costo estimado no es válido")
        if (Math.abs(cost * 100 - Math.round(cost * 100)) > 0.000001) return toast.error("El costo admite hasta dos decimales")
        setBusy(true)
        try {
            const payload = { description: description.trim(), quantity: qty, unitCostCents: Math.round(cost * 100), notes: notes.trim() || undefined }
            addKey.current = getClientOperationKey(addKey.current, payload)
            const res = await fetch("/api/encargos", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: addKey.current.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo agregar el encargo")
            addKey.current = null
            setDescription(""); setQuantity("1"); setUnitCost(""); setNotes("")
            toast.success("Encargo agregado a la lista")
            await fetchNeeds()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
        }
    }

    const resolveManual = async (item: ManualRow, action: "PURCHASED" | "CANCELLED") => {
        if (busy) return
        setBusy(true)
        try {
            const payload = { action }
            resolveKeys.current[item.id] = getClientOperationKey(resolveKeys.current[item.id] ?? null, payload)
            const res = await fetch(`/api/encargos/${item.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: resolveKeys.current[item.id]!.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo actualizar el encargo")
            resolveKeys.current[item.id] = null
            toast.success(action === "PURCHASED" ? "Encargo marcado como comprado" : "Encargo cancelado")
            await fetchNeeds()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
        }
    }

    const generatePurchase = async () => {
        if (busy) return
        const items = selectedItems()
        if (!items.length && !manualIds.length) return toast.error("Tilda al menos un renglón para la orden de compra")
        if (!items.length) return toast.error("La orden de compra necesita al menos un producto del catálogo; los insumos sin producto se marcan aparte con «Comprado»")
        if (!branchId) return toast.error("Selecciona la sucursal destino de la compra")
        setBusy(true)
        try {
            const payload = { branchId, supplierId: supplierId === "none" ? undefined : supplierId, notes: ocNotes.trim() || undefined, items, manualItemIds: manualIds }
            ocKey.current = getClientOperationKey(ocKey.current, payload)
            const res = await fetch("/api/encargos/orden-compra", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...payload, idempotencyKey: ocKey.current.key }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "No se pudo generar la orden de compra")
            ocKey.current = null
            setPartChecked({}); setLowChecked({}); setManualChecked({}); setOcNotes("")
            toast.success(`Orden de compra ${data.folio} creada en borrador`, {
                description: data.linkedManualItems ? `${data.linkedManualItems} encargo(s) marcados como comprados` : undefined,
                action: { label: "Ver compras", onClick: () => router.push("/admin/inventario?tab=compras") },
            })
            await fetchNeeds()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Error de conexión. Reintenta sin cambiar los datos.")
        } finally {
            setBusy(false)
        }
    }

    const branchSelector = branches.length > 1 ? (
        <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Sucursal" />
            </SelectTrigger>
            <SelectContent>
                {branches.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    ) : null

    if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando lista de encargos…</div>

    return (
        <div className="space-y-6 pb-24 lg:pb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <ClipboardList className="h-6 w-6" /> Lista de encargos
                    </h1>
                    <p className="text-muted-foreground">
                        Refacciones que piden las órdenes abiertas, productos con stock bajo e insumos por comprar.
                    </p>
                </div>
                {branchSelector}
            </div>

            {/* Refacciones faltantes en órdenes abiertas */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Refacciones faltantes en órdenes</CardTitle>
                    <CardDescription>
                        Piezas ligadas a producto pedidas por órdenes de reparación abiertas y que el stock{branchId ? " de esta sucursal" : ""} no alcanza a cubrir.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {needs.partsShortage.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Ninguna orden abierta está esperando refacciones.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10"></TableHead>
                                        <TableHead>Producto</TableHead>
                                        <TableHead className="text-right">Necesario</TableHead>
                                        <TableHead className="text-right">Disponible</TableHead>
                                        <TableHead className="text-right">Falta</TableHead>
                                        <TableHead>Órdenes</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {needs.partsShortage.map(row => (
                                        <TableRow key={row.productId}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={Boolean(partChecked[row.productId])}
                                                    onCheckedChange={value => setPartChecked(prev => ({ ...prev, [row.productId]: value === true }))}
                                                    aria-label={`Agregar ${row.name} a la orden de compra`}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">{row.name}</TableCell>
                                            <TableCell className="text-right">{row.needed}</TableCell>
                                            <TableCell className="text-right">{row.available}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="destructive">{row.shortage}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {row.orders.map(order => (
                                                        <Badge key={order.orderId} variant="outline" className="font-normal">
                                                            {/* La API ya trae el folio con los dígitos del negocio; orderFolio es el respaldo. */}
                                                            {order.folio ?? orderFolio(order.number)} ×{order.qty}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Stock bajo */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><PackageX className="h-5 w-5" /> Stock bajo</CardTitle>
                    <CardDescription>Productos activos en su mínimo o por debajo. Lo sugerido reabastece hasta el doble del mínimo.</CardDescription>
                </CardHeader>
                <CardContent>
                    {needs.lowStock.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">Ningún producto por debajo de su stock mínimo.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-10"></TableHead>
                                        <TableHead>Producto</TableHead>
                                        <TableHead className="text-right">Stock</TableHead>
                                        <TableHead className="text-right">Mínimo</TableHead>
                                        <TableHead className="text-right">Sugerido</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {needs.lowStock.map(row => (
                                        <TableRow key={row.productId}>
                                            <TableCell>
                                                <Checkbox
                                                    checked={Boolean(lowChecked[row.productId])}
                                                    onCheckedChange={value => setLowChecked(prev => ({ ...prev, [row.productId]: value === true }))}
                                                    aria-label={`Agregar ${row.name} a la orden de compra`}
                                                />
                                            </TableCell>
                                            <TableCell className="font-medium">{row.name}</TableCell>
                                            <TableCell className="text-right">{row.stock}</TableCell>
                                            <TableCell className="text-right">{row.minStock}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant="warning">{row.suggested}</Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Insumos y otros */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><PackageSearch className="h-5 w-5" /> Insumos y otros</CardTitle>
                    <CardDescription>Cosas que no salen del catálogo: alcohol, cinta, herramientas, consumibles.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <form onSubmit={e => void addManual(e)} className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem_1fr_auto] sm:items-end">
                        <div className="space-y-2">
                            <Label>Descripción</Label>
                            <Input maxLength={200} placeholder="Ej. Alcohol isopropílico 1L" value={description} onChange={e => setDescription(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Cantidad</Label>
                            <Input type="number" min="1" max="9999" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Costo est.</Label>
                            <Input type="number" min="0" step="0.01" placeholder="0.00" value={unitCost} onChange={e => setUnitCost(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label>Notas</Label>
                            <Input maxLength={500} placeholder="Opcional" value={notes} onChange={e => setNotes(e.target.value)} />
                        </div>
                        <Button type="submit" disabled={busy}>Agregar</Button>
                    </form>

                    {needs.manual.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Sin insumos pendientes de compra.</p>
                    ) : (
                        <div className="space-y-2">
                            {needs.manual.map(item => (
                                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                                    <div className="flex items-start gap-3 min-w-0">
                                        <Checkbox
                                            className="mt-1"
                                            checked={Boolean(manualChecked[item.id])}
                                            onCheckedChange={value => setManualChecked(prev => ({ ...prev, [item.id]: value === true }))}
                                            aria-label={`Ligar ${item.description} a la orden de compra`}
                                        />
                                        <div className="min-w-0">
                                            <p className="font-medium">
                                                {item.quantity} × {item.description}
                                                {item.unitCostCents > 0 && <span className="text-muted-foreground font-normal"> · {formatPrice(item.unitCostCents / 100)} c/u</span>}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {item.createdBy?.name ?? "—"} · {formatDate(item.createdAt)}
                                                {item.product ? ` · catálogo: ${item.product.name}` : ""}
                                                {item.notes ? ` — ${item.notes}` : ""}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={busy} onClick={() => void resolveManual(item, "PURCHASED")}>
                                            <Check className="w-4 h-4 mr-1" /> Comprado
                                        </Button>
                                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void resolveManual(item, "CANCELLED")}>
                                            <X className="w-4 h-4 mr-1" /> Cancelar
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Barra de generación de OC */}
            <div className="sticky bottom-4 z-10">
                <Card className="border-primary/30 shadow-lg">
                    <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
                        <p className="text-sm font-medium flex-1">
                            {selectionCount > 0
                                ? `${selectedItems().length} producto(s) y ${manualIds.length} insumo(s) seleccionados`
                                : "Tilda productos o insumos para armar la orden de compra"}
                        </p>
                        <Select value={supplierId} onValueChange={setSupplierId}>
                            <SelectTrigger className="w-full lg:w-56">
                                <SelectValue placeholder="Proveedor (opcional)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Sin proveedor</SelectItem>
                                {suppliers.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            className="w-full lg:w-64"
                            maxLength={1000}
                            placeholder="Notas para la OC (opcional)"
                            value={ocNotes}
                            onChange={e => setOcNotes(e.target.value)}
                        />
                        <Button onClick={() => void generatePurchase()} disabled={busy || selectionCount === 0}>
                            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
                            Generar orden de compra
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
