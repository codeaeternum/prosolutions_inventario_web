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
import { Ban, Loader2, Mail, Pencil, Phone, Plus, Truck } from "lucide-react"
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

const EMPTY_FORM = { name: "", phone: "", email: "", notes: "" }

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

    const fetchSuppliers = useCallback(async () => {
        setError(null)
        try {
            const res = await fetch("/api/suppliers")
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "Error al cargar proveedores")
            setSuppliers(data?.suppliers ?? [])
        } catch (e) {
            setError(e instanceof Error ? e.message : "Error al cargar proveedores")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void Promise.resolve().then(fetchSuppliers)
    }, [fetchSuppliers])

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

            {!error && suppliers.length === 0 ? (
                <EmptyState
                    icon={Truck}
                    title="No hay proveedores"
                    description="Registra a tus proveedores de refacciones para asociarlos a las órdenes de compra."
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {suppliers.map(s => (
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
                            <CardContent className="space-y-2">
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
                            </CardContent>
                        </Card>
                    ))}
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
        </div>
    )
}
