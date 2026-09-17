"use client"

import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
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
import { EmptyState } from "@/components/admin/empty-state"
import { PagoProveedorDialog, SUPPLIER_METHOD_LABELS, type PendingPurchase } from "@/components/admin/inventario/pago-proveedor-dialog"
import { Ban, Banknote, CalendarClock, ChevronDown, ChevronUp, History, Loader2, Mail, Pencil, Phone, Plus, Truck, X } from "lucide-react"
import { formatDate, formatDay, formatPrice } from "@/lib/utils"
import { toast } from "sonner"

interface Supplier {
    id: string
    name: string
    phone: string | null
    email: string | null
    notes: string | null
    isActive: boolean
    _count: { purchases: number }
}

interface SupplierBalance {
    supplier: Supplier
    recibidoCents: number
    pagadoCents: number
    saldoCents: number
    proximoVencimiento: string | null
    ocsPendientes: PendingPurchase[]
}

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

interface SupplierAging {
    suppliers: AgingRow[]
    totals: Omit<AgingRow, "supplierId" | "name">
}

interface SupplierPaymentRow {
    id: string
    amountCents: number
    method: string
    notes: string | null
    createdAt: string
    purchase: { id: string; number: number } | null
    createdBy: { id: string; name: string } | null
}

const EMPTY_FORM = { name: "", phone: "", email: "", notes: "" }

/** Celda monetaria de la tabla de antigüedad: guion cuando el bucket está en cero. */
function AgingCell({ value, className }: { value: number; className?: string }) {
    return (
        <td className={`px-2 py-1.5 text-right tabular-nums ${className ?? ""}`}>
            {value > 0 ? formatPrice(value / 100) : <span className="text-muted-foreground/40">—</span>}
        </td>
    )
}

export function ProveedoresPanel() {
    const [suppliers, setSuppliers] = useState<Supplier[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [formOpen, setFormOpen] = useState(false)
    const [editing, setEditing] = useState<Supplier | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    const [deactivateTarget, setDeactivateTarget] = useState<Supplier | null>(null)
    const [deactivating, setDeactivating] = useState(false)

    // Cuentas por pagar: saldos por proveedor + pago/historial.
    const [balances, setBalances] = useState<Record<string, SupplierBalance>>({})
    const [payTarget, setPayTarget] = useState<Supplier | null>(null)
    const [historySupplier, setHistorySupplier] = useState<Supplier | null>(null)
    const [payments, setPayments] = useState<SupplierPaymentRow[] | null>(null)

    // Antigüedad de saldos (aging de cuentas por pagar).
    const [aging, setAging] = useState<SupplierAging | null>(null)
    const [agingOpen, setAgingOpen] = useState<boolean | null>(null) // null = auto (abierto si hay pocos)
    const [focusSupplierId, setFocusSupplierId] = useState<string | null>(null)

    const fetchSuppliers = useCallback(async () => {
        setError(null)
        try {
            const [supRes, balRes, agingRes] = await Promise.all([
                fetch("/api/suppliers"),
                fetch("/api/suppliers/balances"),
                fetch("/api/suppliers/aging"),
            ])
            const data = await supRes.json().catch(() => null)
            if (!supRes.ok) throw new Error(data?.error || "Error al cargar proveedores")
            setSuppliers(data?.suppliers ?? [])
            // Los saldos son complementarios: si fallan, las tarjetas igual se muestran.
            const balData = balRes.ok ? await balRes.json().catch(() => null) : null
            const map: Record<string, SupplierBalance> = {}
            for (const b of (balData?.balances ?? []) as SupplierBalance[]) map[b.supplier.id] = b
            setBalances(map)
            // La antigüedad también es complementaria.
            const agingData = agingRes.ok ? await agingRes.json().catch(() => null) : null
            setAging(agingData && Array.isArray(agingData.suppliers) ? (agingData as SupplierAging) : null)
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error al cargar proveedores")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void Promise.resolve().then(fetchSuppliers)
    }, [fetchSuppliers])

    const openHistory = (s: Supplier) => {
        setPayments(null)
        setHistorySupplier(s)
    }

    // Carga el historial de pagos al abrir el diálogo correspondiente.
    useEffect(() => {
        if (!historySupplier) return
        let cancelled = false
        fetch(`/api/supplier-payments?supplierId=${encodeURIComponent(historySupplier.id)}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error("Error al cargar pagos"))))
            .then(d => { if (!cancelled) setPayments(d?.payments ?? []) })
            .catch(() => { if (!cancelled) setPayments([]) })
        return () => { cancelled = true }
    }, [historySupplier])

    const openCreate = () => {
        setEditing(null)
        setForm(EMPTY_FORM)
        setFormOpen(true)
    }
    const openEdit = (s: Supplier) => {
        setEditing(s)
        setForm({ name: s.name, phone: s.phone ?? "", email: s.email ?? "", notes: s.notes ?? "" })
        setFormOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (saving) return
        if (!form.name.trim()) return toast.error("El nombre es requerido.")

        setSaving(true)
        try {
            const payload = {
                name: form.name.trim(),
                phone: form.phone.trim() || null,
                email: form.email.trim() || null,
                notes: form.notes.trim() || null,
            }
            const res = await fetch(editing ? `/api/suppliers/${editing.id}` : "/api/suppliers", {
                method: editing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo guardar el proveedor.")
            toast.success(editing ? "Proveedor actualizado" : "Proveedor creado")
            setFormOpen(false)
            setEditing(null)
            setForm(EMPTY_FORM)
            void fetchSuppliers()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error al guardar")
        } finally {
            setSaving(false)
        }
    }

    const handleDeactivate = async () => {
        if (!deactivateTarget || deactivating) return
        setDeactivating(true)
        try {
            const res = await fetch(`/api/suppliers/${deactivateTarget.id}`, { method: "DELETE" })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo desactivar.")
            toast.success(data?.deleted ? "Proveedor eliminado" : "Proveedor desactivado", {
                description: data?.deactivated ? "Tiene compras registradas; se conserva en el historial." : undefined,
            })
            setDeactivateTarget(null)
            void fetchSuppliers()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error al desactivar")
        } finally {
            setDeactivating(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Click en una fila de antigüedad enfoca la tarjeta de ese proveedor.
    const focusedSupplier = focusSupplierId ? suppliers.find(s => s.id === focusSupplierId) ?? null : null
    const visibleSuppliers = focusedSupplier ? [focusedSupplier] : suppliers
    const agingExpanded = agingOpen ?? ((aging?.suppliers.length ?? 0) <= 6)

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    {suppliers.length} proveedor{suppliers.length === 1 ? "" : "es"} registrado{suppliers.length === 1 ? "" : "s"}
                </p>
                <Button onClick={openCreate}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nuevo proveedor
                </Button>
            </div>

            {error && (
                <div role="alert" className="rounded-lg border p-6 space-y-3">
                    <p>{error}</p>
                    <Button variant="outline" onClick={() => void fetchSuppliers()}>Reintentar</Button>
                </div>
            )}

            {aging && aging.suppliers.length > 0 && (
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 py-3">
                        <button
                            type="button"
                            onClick={() => setAgingOpen(!agingExpanded)}
                            className="flex items-center gap-2 text-left"
                            aria-expanded={agingExpanded}
                        >
                            <CardTitle className="text-base flex items-center gap-2">
                                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                                Antigüedad de saldos
                            </CardTitle>
                            {agingExpanded
                                ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </button>
                        <span className="text-sm font-semibold text-red-600 tabular-nums">
                            Debes {formatPrice(aging.totals.total / 100)}
                        </span>
                    </CardHeader>
                    {agingExpanded && (
                        <CardContent className="pt-0">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[560px] text-sm">
                                    <thead>
                                        <tr className="border-b text-xs text-muted-foreground">
                                            <th className="px-2 py-1.5 text-left font-medium">Proveedor</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Al día</th>
                                            <th className="px-2 py-1.5 text-right font-medium">1-15</th>
                                            <th className="px-2 py-1.5 text-right font-medium">16-30</th>
                                            <th className="px-2 py-1.5 text-right font-medium">31-60</th>
                                            <th className="px-2 py-1.5 text-right font-medium">60+</th>
                                            <th className="px-2 py-1.5 text-right font-medium">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {aging.suppliers.map(row => (
                                            <tr
                                                key={row.supplierId}
                                                onClick={() => setFocusSupplierId(cur => (cur === row.supplierId ? null : row.supplierId))}
                                                className={`border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/50 ${focusSupplierId === row.supplierId ? "bg-muted/60" : ""}`}
                                                title="Ver detalle del proveedor"
                                            >
                                                <td className="px-2 py-1.5 font-medium max-w-[180px] truncate">{row.name}</td>
                                                <AgingCell value={row.current} className="text-green-600" />
                                                <AgingCell value={row.d1_15} className="text-amber-600" />
                                                <AgingCell value={row.d16_30} className="text-orange-600" />
                                                <AgingCell value={row.d31_60} className="text-red-600" />
                                                <AgingCell value={row.d60plus} className="text-red-700 font-semibold" />
                                                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                                                    {formatPrice(row.total / 100)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t text-xs font-semibold">
                                            <td className="px-2 py-1.5">Totales</td>
                                            <AgingCell value={aging.totals.current} className="text-green-600" />
                                            <AgingCell value={aging.totals.d1_15} className="text-amber-600" />
                                            <AgingCell value={aging.totals.d16_30} className="text-orange-600" />
                                            <AgingCell value={aging.totals.d31_60} className="text-red-600" />
                                            <AgingCell value={aging.totals.d60plus} className="text-red-700" />
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                                {formatPrice(aging.totals.total / 100)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </CardContent>
                    )}
                </Card>
            )}

            {focusedSupplier && (
                <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1.5">
                        Mostrando: {focusedSupplier.name}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => setFocusSupplierId(null)}>
                        <X className="mr-1 h-3.5 w-3.5" />
                        Ver todos
                    </Button>
                </div>
            )}

            {!error && suppliers.length === 0 ? (
                <EmptyState
                    icon={Truck}
                    title="No hay proveedores"
                    description="Registra a tus proveedores de refacciones para asociarlos a las órdenes de compra."
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {visibleSuppliers.map(s => {
                        const bal = balances[s.id]
                        return (
                            <Card key={s.id} className={s.isActive ? "" : "opacity-60"}>
                                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                    <CardTitle className="text-lg flex items-center gap-2 min-w-0">
                                        <Truck className="h-5 w-5 text-muted-foreground shrink-0" />
                                        <span className="truncate">{s.name}</span>
                                    </CardTitle>
                                    <div className="flex gap-1 shrink-0">
                                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)} aria-label={`Editar ${s.name}`}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        {s.isActive && (
                                            <Button variant="ghost" size="icon" onClick={() => setDeactivateTarget(s)} aria-label={`Desactivar ${s.name}`}>
                                                <Ban className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    {!s.isActive && <Badge variant="secondary">Inactivo</Badge>}
                                    <div className="space-y-1 text-sm text-muted-foreground">
                                        {s.phone && (
                                            <p className="flex items-center gap-2">
                                                <Phone className="h-3.5 w-3.5" /> {s.phone}
                                            </p>
                                        )}
                                        {s.email && (
                                            <p className="flex items-center gap-2 truncate">
                                                <Mail className="h-3.5 w-3.5 shrink-0" /> {s.email}
                                            </p>
                                        )}
                                        {!s.phone && !s.email && <p className="text-xs">Sin datos de contacto</p>}
                                    </div>
                                    <Badge variant="secondary">
                                        {s._count.purchases} compra{s._count.purchases === 1 ? "" : "s"}
                                    </Badge>

                                    {bal && (
                                        <div className="rounded-lg border p-3 space-y-1.5 text-sm">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-muted-foreground">Saldo</span>
                                                {bal.saldoCents > 0 ? (
                                                    <span className="font-semibold text-red-600 tabular-nums">
                                                        Debes {formatPrice(bal.saldoCents / 100)}
                                                    </span>
                                                ) : (
                                                    <span className="font-medium text-green-600">Liquidado</span>
                                                )}
                                            </div>
                                            {bal.saldoCents > 0 && (
                                                <p className="text-xs text-muted-foreground tabular-nums">
                                                    Recibido {formatPrice(bal.recibidoCents / 100)} · Pagado {formatPrice(bal.pagadoCents / 100)}
                                                </p>
                                            )}
                                            {bal.proximoVencimiento && bal.saldoCents > 0 && (
                                                <p className={`flex items-center gap-1.5 text-xs ${new Date(bal.proximoVencimiento) < new Date() ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                                                    <CalendarClock className="h-3.5 w-3.5" />
                                                    Vence {formatDay(bal.proximoVencimiento)}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex gap-2 pt-1">
                                        <Button variant="outline" size="sm" onClick={() => setPayTarget(s)}>
                                            <Banknote className="mr-1.5 h-4 w-4" />
                                            Registrar pago
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => openHistory(s)}>
                                            <History className="mr-1.5 h-4 w-4" />
                                            Historial
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Crear / editar */}
            <Dialog open={formOpen} onOpenChange={(open) => { if (!saving) setFormOpen(open) }}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Truck className="h-5 w-5 text-muted-foreground" />
                                {editing ? "Editar proveedor" : "Nuevo proveedor"}
                            </DialogTitle>
                            <DialogDescription>
                                Datos de contacto del proveedor de refacciones.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="supplier-name">Nombre</Label>
                                <Input
                                    id="supplier-name"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    placeholder="Ej: Refaccionaria del Centro"
                                    maxLength={200}
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="supplier-phone">Teléfono</Label>
                                    <Input
                                        id="supplier-phone"
                                        value={form.phone}
                                        onChange={e => setForm({ ...form, phone: e.target.value })}
                                        placeholder="555-123-4567"
                                        maxLength={40}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="supplier-email">Correo</Label>
                                    <Input
                                        id="supplier-email"
                                        type="email"
                                        value={form.email}
                                        onChange={e => setForm({ ...form, email: e.target.value })}
                                        placeholder="ventas@proveedor.com"
                                        maxLength={200}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="supplier-notes">Notas</Label>
                                <Textarea
                                    id="supplier-notes"
                                    value={form.notes}
                                    onChange={e => setForm({ ...form, notes: e.target.value })}
                                    placeholder="Condiciones de pago, días de entrega…"
                                    maxLength={1000}
                                    className="resize-none h-20"
                                />
                            </div>
                        </div>
                        <DialogFooter className="gap-2">
                            <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={saving || !form.name.trim()}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {editing ? "Guardar cambios" : "Crear proveedor"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Confirmación de desactivar */}
            <AlertDialog open={deactivateTarget !== null} onOpenChange={(open) => { if (!open && !deactivating) setDeactivateTarget(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Desactivar a {deactivateTarget?.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deactivateTarget && deactivateTarget._count.purchases > 0
                                ? `Tiene ${deactivateTarget._count.purchases} compra(s) registrada(s): quedará inactivo y no se podrá elegir en nuevas órdenes, pero se conserva en el historial.`
                                : "No tiene compras registradas; se eliminará definitivamente."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deactivating}>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={(e) => { e.preventDefault(); void handleDeactivate() }}
                            disabled={deactivating}
                        >
                            {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {deactivateTarget && deactivateTarget._count.purchases > 0 ? "Desactivar" : "Eliminar"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Registrar abono al proveedor */}
            <PagoProveedorDialog
                open={payTarget !== null}
                onOpenChange={(open) => { if (!open) setPayTarget(null) }}
                supplier={payTarget}
                purchases={payTarget ? (balances[payTarget.id]?.ocsPendientes ?? []) : []}
                onSaved={() => void fetchSuppliers()}
            />

            {/* Historial de pagos del proveedor */}
            <Dialog open={historySupplier !== null} onOpenChange={(open) => { if (!open) setHistorySupplier(null) }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <History className="h-5 w-5 text-muted-foreground" />
                            Pagos a {historySupplier?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Abonos registrados, más recientes primero.
                        </DialogDescription>
                    </DialogHeader>
                    {payments === null ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : payments.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            Sin pagos registrados a este proveedor.
                        </p>
                    ) : (
                        <div className="rounded-md border divide-y max-h-80 overflow-y-auto">
                            {payments.map(p => (
                                <div key={p.id} className="p-3 flex justify-between items-start gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium">
                                            {SUPPLIER_METHOD_LABELS[p.method] ?? p.method}
                                            {p.purchase
                                                ? ` · OC-${String(p.purchase.number).padStart(6, "0")}`
                                                : " · Cuenta general"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDate(p.createdAt)}
                                            {p.createdBy ? ` · ${p.createdBy.name}` : ""}
                                        </p>
                                        {p.notes && <p className="text-xs text-muted-foreground mt-0.5">{p.notes}</p>}
                                    </div>
                                    <span className="font-semibold text-sm tabular-nums shrink-0">
                                        {formatPrice(p.amountCents / 100)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
