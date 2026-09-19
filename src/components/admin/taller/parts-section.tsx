"use client"

import { useEffect, useState } from "react"
import { Check, Package, PackagePlus, Trash2, Warehouse, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type WorkshopPartStatus = "REQUESTED" | "APPROVED" | "REJECTED"

export type WorkshopPart = {
    id: string
    description: string
    qty: number
    unitCostCents: number
    unitPriceCents: number
    status: WorkshopPartStatus
    decisionNote?: string | null
    createdById?: string
    createdAt?: string
    createdBy?: { name: string } | null
    product?: { id: string; name: string; barcode: string | null; retailPrice?: number | null } | null
    /** Sucursal que surte la pieza; null = la sucursal actual de la orden. */
    sourceBranchId?: string | null
    sourceBranch?: { id: string; name: string } | null
}

// Subconjunto del DTO de GET /api/products que usa el buscador de vínculo.
type ProductOption = {
    id: string
    name: string
    barcode: string | null
    /** Precios en MXN (Float); se convierten a centavos al enviar. */
    retailPrice?: number | null
    costPrice?: number | null
}

// Payload que el padre reenvía a POST /api/workshop/{order.id} (agregando idempotencyKey).
export type PartActionPayload =
    | { action: "PART_REQUEST"; expectedVersion: number; partDescription: string; partQty: number; partCostCents: number; partPriceCents: number; partProductId?: string; sourceBranchId?: string }
    | { action: "PART_DECIDE"; expectedVersion: number; partId: string; approve: boolean; detail?: string }
    | { action: "PART_REMOVE"; expectedVersion: number; partId: string }

const statusMeta: Record<WorkshopPartStatus, { label: string; variant: "warning" | "success" | "destructive" }> = {
    REQUESTED: { label: "Solicitada", variant: "warning" },
    APPROVED: { label: "Autorizada", variant: "success" },
    REJECTED: { label: "Rechazada", variant: "destructive" },
}
const money = (cents: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100)
const date = (value: string) => new Date(value).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })
const emptyForm = { description: "", qty: "1", cost: "", price: "" }

export function PartsSection(props: {
    order: { id: string; version: number; parts: WorkshopPart[] }
    /** true cuando el actor es ADMIN: puede autorizar/rechazar y eliminar partes decididas. */
    canDecide: boolean
    /** Para mostrar "Retirar" en las REQUESTED propias del empleado. */
    currentUserId?: string | null
    /** Sucursales activas del negocio para el selector "Surtir desde". */
    branches: { id: string; name: string }[]
    /** Sucursal actual de la orden: default del selector "Surtir desde". */
    currentBranchId: string
    /** true cuando la orden está cerrada: oculta el formulario y las acciones. */
    readOnly?: boolean
    busy?: boolean
    onAction: (payload: PartActionPayload) => Promise<void>
}) {
    const [form, setForm] = useState(emptyForm)
    const [rejectingId, setRejectingId] = useState<string | null>(null)
    const [rejectNote, setRejectNote] = useState("")
    const [productQuery, setProductQuery] = useState("")
    const [productOptions, setProductOptions] = useState<ProductOption[]>([])
    const [linkedProduct, setLinkedProduct] = useState<ProductOption | null>(null)
    // "" = default (la sucursal actual de la orden); otro valor = branchId origen.
    const [sourceBranchId, setSourceBranchId] = useState("")
    // Existencias por sucursal del producto vinculado (null = sin cargar / sin vínculo).
    const [stockByBranch, setStockByBranch] = useState<Record<string, number> | null>(null)
    const effectiveSourceBranchId = sourceBranchId || props.currentBranchId
    const parts = props.order.parts ?? []
    const approved = parts.filter(part => (part.status ?? "APPROVED") === "APPROVED")
    const totals = approved.reduce(
        (acc, part) => ({ cost: acc.cost + part.unitCostCents * part.qty, price: acc.price + part.unitPriceCents * part.qty }),
        { cost: 0, price: 0 },
    )

    // Búsqueda con debounce del catálogo para vincular la refacción a inventario.
    useEffect(() => {
        const query = productQuery.trim()
        if (linkedProduct || query.length < 2) return
        const controller = new AbortController()
        const timer = setTimeout(() => {
            void fetch(`/api/products?search=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal })
                .then(res => (res.ok ? res.json() : { products: [] }))
                .then((data: { products?: ProductOption[] }) => setProductOptions(Array.isArray(data.products) ? data.products : []))
                .catch(() => { /* abortada o sin red: se reintenta al seguir escribiendo */ })
        }, 300)
        return () => { controller.abort(); clearTimeout(timer) }
    }, [productQuery, linkedProduct])

    // Existencias por sucursal del producto vinculado: alimenta las cantidades
    // del selector "Surtir desde" y el aviso de sucursal sin stock. El estado
    // se limpia al elegir/quitar el vínculo (pickProduct/unlinkProduct/resetForm).
    useEffect(() => {
        if (!linkedProduct) return
        const controller = new AbortController()
        void fetch(`/api/inventory/stock?productId=${encodeURIComponent(linkedProduct.id)}`, { signal: controller.signal })
            .then(res => (res.ok ? res.json() : { stock: [] }))
            .then((data: { stock?: { branchId: string; quantity: number }[] }) => {
                const rows = Array.isArray(data.stock) ? data.stock : []
                setStockByBranch(Object.fromEntries(rows.map(row => [row.branchId, row.quantity])))
            })
            .catch(() => { /* abortada o sin red: las opciones solo muestran el nombre */ })
        return () => controller.abort()
    }, [linkedProduct])

    function pickProduct(product: ProductOption) {
        setLinkedProduct(product)
        setProductQuery("")
        setProductOptions([])
        // Las existencias llegan con el fetch del efecto; mientras tanto las
        // opciones solo muestran el nombre de la sucursal.
        setStockByBranch(null)
        // Prellena descripción y precios del catálogo; la descripción sigue editable.
        setForm(previous => ({
            ...previous,
            description: product.name,
            cost: product.costPrice != null ? String(product.costPrice) : previous.cost,
            price: product.retailPrice != null ? String(product.retailPrice) : previous.price,
        }))
    }

    function unlinkProduct() {
        setLinkedProduct(null)
        setStockByBranch(null)
    }

    function resetForm() {
        setForm(emptyForm)
        setLinkedProduct(null)
        setProductQuery("")
        setProductOptions([])
        setSourceBranchId("")
        setStockByBranch(null)
    }

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (props.busy) return
        const qty = Number(form.qty)
        const cost = form.cost === "" ? 0 : Number(form.cost)
        const price = form.price === "" ? 0 : Number(form.price)
        if (!form.description.trim()) return
        if (!Number.isInteger(qty) || qty < 1 || qty > 999) return toast.error("La cantidad debe ser un entero entre 1 y 999")
        for (const [label, value] of [["costo", cost], ["precio", price]] as const) {
            if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
                return toast.error(`El ${label} admite hasta dos decimales`)
            }
        }
        try {
            await props.onAction({
                action: "PART_REQUEST",
                expectedVersion: props.order.version,
                partDescription: form.description.trim(),
                partQty: qty,
                partCostCents: Math.round(cost * 100),
                partPriceCents: Math.round(price * 100),
                ...(linkedProduct ? { partProductId: linkedProduct.id } : {}),
                // Se envía la sucursal origen elegida mientras sea una sucursal
                // activa conocida: la intención queda registrada aunque la orden
                // cambie de sucursal antes de autorizarse. Si la sucursal actual
                // ya no está activa no se envía — comportamiento previo (descuenta
                // de donde esté la orden al autorizarse).
                ...(props.branches.some(branch => branch.id === effectiveSourceBranchId) ? { sourceBranchId: effectiveSourceBranchId } : {}),
            })
            resetForm()
        } catch {
            // el padre muestra el error; conserva el borrador para reintentar
        }
    }

    async function decide(part: WorkshopPart, approve: boolean, note?: string) {
        if (props.busy) return
        try {
            await props.onAction({ action: "PART_DECIDE", expectedVersion: props.order.version, partId: part.id, approve, detail: note })
            setRejectingId(null)
            setRejectNote("")
        } catch {
            // el padre muestra el error
        }
    }

    async function remove(part: WorkshopPart) {
        if (props.busy) return
        try {
            await props.onAction({ action: "PART_REMOVE", expectedVersion: props.order.version, partId: part.id })
        } catch {
            // el padre muestra el error
        }
    }

    return (
        <section className="space-y-4 rounded-xl border bg-card p-5">
            <div className="flex justify-between">
                <h2 className="font-semibold">Refacciones</h2>
                <span className="text-sm text-muted-foreground">{parts.length} registradas</span>
            </div>

            {parts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin refacciones registradas.</p>
            ) : (
                <ul className="space-y-2">
                    {parts.map(part => {
                        const status = part.status ?? "APPROVED"
                        const meta = statusMeta[status]
                        // El servidor valida igual: REQUESTED solo la retira quien la pidió;
                        // APPROVED/REJECTED solo el administrador.
                        const canRemove = !props.readOnly && (status === "REQUESTED" ? part.createdById === props.currentUserId : props.canDecide)
                        // Sucursal que surte la pieza: solo se anuncia cuando no es
                        // la sucursal actual de la orden (almacén de refacciones).
                        const sourceBranch = part.sourceBranch ?? props.branches.find(branch => branch.id === part.sourceBranchId) ?? null
                        const showSource = sourceBranch !== null && sourceBranch.id !== props.currentBranchId
                        return (
                            <li key={part.id} className="space-y-2 rounded-lg border p-3 text-sm">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="flex flex-wrap items-center gap-2 font-medium">
                                            {part.qty} × {part.description}
                                            <Badge variant={meta.variant}>{meta.label}</Badge>
                                        </p>
                                        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                                            {part.product && (
                                                <span className="inline-flex items-center gap-1">
                                                    <Package size={12} className="shrink-0" />
                                                    {part.product.name}{part.product.barcode ? ` · ${part.product.barcode}` : ""}
                                                    {part.createdBy?.name || part.createdAt || showSource ? " ·" : ""}
                                                </span>
                                            )}
                                            {showSource && (
                                                <span className="inline-flex items-center gap-1">
                                                    <Warehouse size={12} className="shrink-0" />
                                                    desde {sourceBranch.name}
                                                    {part.createdBy?.name || part.createdAt ? " ·" : ""}
                                                </span>
                                            )}
                                            <span>{part.createdBy?.name ?? ""}{part.createdBy?.name && part.createdAt ? " · " : ""}{part.createdAt ? date(part.createdAt) : ""}</span>
                                        </p>
                                        {status === "REJECTED" && part.decisionNote && (
                                            <p className="mt-1 text-xs text-destructive">Motivo: {part.decisionNote}</p>
                                        )}
                                    </div>
                                    <div className="shrink-0 text-right">
                                        <p>{money(part.unitPriceCents)} c/u{part.qty > 1 ? ` · ${money(part.unitPriceCents * part.qty)}` : ""}</p>
                                        <p className="text-xs text-muted-foreground">Costo {money(part.unitCostCents)}</p>
                                        {canRemove && (
                                            <button
                                                type="button"
                                                disabled={props.busy}
                                                onClick={() => void remove(part)}
                                                className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                                            >
                                                <Trash2 size={12} />{status === "REQUESTED" ? "Retirar" : "Quitar"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {status === "REQUESTED" && props.canDecide && !props.readOnly && (
                                    rejectingId === part.id ? (
                                        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                                            <Input
                                                maxLength={500}
                                                placeholder="Motivo del rechazo (opcional)"
                                                value={rejectNote}
                                                onChange={e => setRejectNote(e.target.value)}
                                                className="h-8 flex-1 text-xs"
                                                autoFocus
                                            />
                                            <Button size="sm" variant="destructive" disabled={props.busy} onClick={() => void decide(part, false, rejectNote.trim() || undefined)}>
                                                Confirmar rechazo
                                            </Button>
                                            <Button size="sm" variant="outline" type="button" disabled={props.busy} onClick={() => { setRejectingId(null); setRejectNote("") }}>
                                                Cancelar
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 border-t pt-2">
                                            <Button size="sm" className="bg-green-600 hover:bg-green-700" disabled={props.busy} onClick={() => void decide(part, true)}>
                                                <Check className="mr-1 h-4 w-4" /> Autorizar
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={props.busy} onClick={() => setRejectingId(part.id)}>
                                                <X className="mr-1 h-4 w-4" /> Rechazar
                                            </Button>
                                        </div>
                                    )
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}

            {approved.length > 0 && (
                <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Costo total</dt><dd className="font-medium">{money(totals.cost)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Precio total</dt><dd className="font-medium">{money(totals.price)}</dd></div>
                    <div>
                        <dt className="text-xs text-muted-foreground">Margen</dt>
                        <dd className={`font-medium ${totals.price - totals.cost > 0 ? "text-emerald-600 dark:text-emerald-400" : totals.price - totals.cost < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{money(totals.price - totals.cost)}</dd>
                    </div>
                </dl>
            )}

            {!props.readOnly && <form onSubmit={e => void submit(e)} className="space-y-3 rounded-lg border border-dashed p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium"><PackagePlus size={14} />Agregar refacción{props.canDecide ? "" : " (queda pendiente de autorización)"}</p>
                <fieldset disabled={props.busy} className="space-y-1">
                    <label className="text-xs" htmlFor="part-product-search">Vincular a inventario (opcional)</label>
                    {linkedProduct ? (
                        <p className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs">
                            <Package size={14} className="shrink-0 text-muted-foreground" />
                            <span className="flex-1 truncate">{linkedProduct.name}{linkedProduct.barcode ? ` · ${linkedProduct.barcode}` : ""}</span>
                            <button type="button" onClick={unlinkProduct} aria-label="Quitar vínculo con el catálogo" className="shrink-0 text-muted-foreground hover:text-destructive">
                                <X size={14} />
                            </button>
                        </p>
                    ) : (
                        <div className="relative">
                            <Input
                                id="part-product-search"
                                maxLength={100}
                                value={productQuery}
                                onChange={e => { setProductQuery(e.target.value); setProductOptions([]) }}
                                placeholder="Buscar producto del catálogo por nombre o código…"
                                autoComplete="off"
                            />
                            {productOptions.length > 0 && (
                                <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-md border bg-popover shadow-md">
                                    {productOptions.map(product => (
                                        <li key={product.id}>
                                            <button
                                                type="button"
                                                onClick={() => pickProduct(product)}
                                                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
                                            >
                                                <span className="truncate">{product.name}{product.barcode ? ` · ${product.barcode}` : ""}</span>
                                                <span className="shrink-0 text-muted-foreground">{product.retailPrice != null ? money(Math.round(product.retailPrice * 100)) : ""}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </fieldset>
                {props.branches.length > 0 && (
                    <fieldset disabled={props.busy} className="space-y-1">
                        <label className="text-xs" htmlFor="part-source-branch">Surtir desde</label>
                        <select
                            id="part-source-branch"
                            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
                            value={effectiveSourceBranchId}
                            onChange={e => setSourceBranchId(e.target.value)}
                        >
                            {props.branches.map(branch => (
                                <option key={branch.id} value={branch.id}>
                                    {branch.name}{linkedProduct && stockByBranch ? ` — ${stockByBranch[branch.id] ?? 0} disp.` : ""}
                                </option>
                            ))}
                        </select>
                        {linkedProduct && stockByBranch !== null && (stockByBranch[effectiveSourceBranchId] ?? 0) === 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">Sin stock en esa sucursal — se solicitará como encargo</p>
                        )}
                    </fieldset>
                )}
                <fieldset disabled={props.busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_0.7fr_1fr_1fr]">
                    <label className="text-xs">Descripción *<Input required maxLength={200} value={form.description} onChange={e => setForm(previous => ({ ...previous, description: e.target.value }))} placeholder="Pantalla, batería, flex…" className="mt-1" /></label>
                    <label className="text-xs">Cantidad<Input type="number" min={1} max={999} step={1} required value={form.qty} onChange={e => setForm(previous => ({ ...previous, qty: e.target.value }))} className="mt-1" /></label>
                    <label className="text-xs">Costo unitario MXN<Input type="number" min={0} step="0.01" value={form.cost} onChange={e => setForm(previous => ({ ...previous, cost: e.target.value }))} placeholder="0.00" className="mt-1" /></label>
                    <label className="text-xs">Precio unitario MXN<Input type="number" min={0} step="0.01" value={form.price} onChange={e => setForm(previous => ({ ...previous, price: e.target.value }))} placeholder="0.00" className="mt-1" /></label>
                </fieldset>
                <Button size="sm" disabled={props.busy || !form.description.trim()}>{props.busy ? "Guardando…" : "Agregar refacción"}</Button>
            </form>}
        </section>
    )
}
