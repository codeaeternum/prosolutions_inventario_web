"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Ban, CheckCircle2, Loader2, Pencil } from "lucide-react"

interface BusinessStatusButtonProps {
    business: { id: string; name: string; isActive: boolean }
    variant?: "default" | "outline" | "ghost" | "destructive"
    size?: "default" | "sm" | "icon"
    className?: string
    /** Actualización local inmediata (p. ej. la tabla); siempre hace router.refresh(). */
    onChanged?: (isActive: boolean) => void
}

/**
 * Suspende/reactiva una empresa desde la consola de plataforma, con
 * confirmación. Suspender no borra datos: apaga la vitrina pública del slug
 * y bloquea el login de sus usuarios.
 */
export function BusinessStatusButton({ business, variant = "outline", size = "sm", className, onChanged }: BusinessStatusButtonProps) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [working, setWorking] = useState(false)

    const suspending = business.isActive

    const handleConfirm = async () => {
        if (working) return
        setWorking(true)
        try {
            const res = await fetch(`/api/platform/businesses/${business.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: !business.isActive }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo actualizar la empresa.")
            toast.success(suspending ? "Empresa suspendida" : "Empresa reactivada", {
                description: suspending
                    ? `${business.name}: vitrina pública y acceso de usuarios desactivados.`
                    : `${business.name} vuelve a operar con normalidad.`,
            })
            setOpen(false)
            onChanged?.(!business.isActive)
            router.refresh()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error al actualizar")
        } finally {
            setWorking(false)
        }
    }

    return (
        <>
            <Button
                variant={variant}
                size={size}
                className={className}
                onClick={() => setOpen(true)}
                aria-label={`${suspending ? "Suspender" : "Reactivar"} ${business.name}`}
            >
                {suspending ? (
                    <><Ban className="mr-1.5 h-4 w-4" />Suspender</>
                ) : (
                    <><CheckCircle2 className="mr-1.5 h-4 w-4" />Reactivar</>
                )}
            </Button>

            <AlertDialog open={open} onOpenChange={(next) => { if (!working) setOpen(next) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {suspending ? `¿Suspender ${business.name}?` : `¿Reactivar ${business.name}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {suspending
                                ? "Su vitrina pública dejará de responder y sus usuarios no podrán iniciar sesión. Los datos se conservan y puedes reactivarla en cualquier momento."
                                : "La empresa recupera su vitrina pública y sus usuarios podrán iniciar sesión de nuevo."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={working}>Volver</AlertDialogCancel>
                        <AlertDialogAction
                            variant={suspending ? "destructive" : "default"}
                            onClick={(e) => { e.preventDefault(); void handleConfirm() }}
                            disabled={working}
                        >
                            {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {suspending ? "Suspender" : "Reactivar"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

interface BusinessEditDialogProps {
    business: {
        id: string
        name: string
        slug: string
        category: string
        businessKind?: string
        phone: string | null
        address: string | null
        showInDirectory?: boolean
    }
}

export function BusinessEditDialog({ business }: BusinessEditDialogProps) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [working, setWorking] = useState(false)
    const [name, setName] = useState(business.name)
    const [slug, setSlug] = useState(business.slug)
    const [businessKind, setBusinessKind] = useState(business.businessKind ?? "FULL")
    const [category, setCategory] = useState(business.category)
    const [phone, setPhone] = useState(business.phone ?? "")
    const [address, setAddress] = useState(business.address ?? "")
    const [showInDirectory, setShowInDirectory] = useState(business.showInDirectory ?? true)

    const handleOpenChange = (nextOpen: boolean) => {
        if (working) return
        if (nextOpen) {
            setName(business.name)
            setSlug(business.slug)
            setBusinessKind(business.businessKind ?? "FULL")
            setCategory(business.category)
            setPhone(business.phone ?? "")
            setAddress(business.address ?? "")
            setShowInDirectory(business.showInDirectory ?? true)
        }
        setOpen(nextOpen)
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (working) return
        if (!name.trim() || !slug.trim()) {
            toast.error("El nombre y el slug son obligatorios")
            return
        }
        setWorking(true)
        try {
            const res = await fetch(`/api/platform/businesses/${business.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    slug: slug.trim(),
                    businessKind,
                    category: category.trim() || "Taller y Refacciones",
                    phone: phone.trim() || null,
                    address: address.trim() || null,
                    showInDirectory,
                }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo actualizar la empresa.")
            toast.success("Datos del negocio actualizados")
            setOpen(false)
            router.refresh()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error al actualizar")
        } finally {
            setWorking(false)
        }
    }

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenChange(true)}
                aria-label={`Editar datos de ${business.name}`}
            >
                <Pencil className="mr-1.5 h-4 w-4" />
                Editar datos
            </Button>

            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Editar datos del negocio</DialogTitle>
                        <DialogDescription>
                            Modifica los datos públicos y de operación de {business.name}.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label htmlFor={`edit-business-name-${business.id}`}>Nombre comercial</Label>
                            <Input
                                id={`edit-business-name-${business.id}`}
                                value={name}
                                disabled={working}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor={`edit-business-slug-${business.id}`}>Slug público</Label>
                                <Input
                                    id={`edit-business-slug-${business.id}`}
                                    value={slug}
                                    disabled={working}
                                    onChange={(e) => setSlug(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={`edit-business-kind-${business.id}`}>Giro</Label>
                                <Select value={businessKind} onValueChange={setBusinessKind}>
                                    <SelectTrigger id={`edit-business-kind-${business.id}`} disabled={working}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="FULL">Taller + Refacciones</SelectItem>
                                        <SelectItem value="REPAIR">Solo Taller</SelectItem>
                                        <SelectItem value="PARTS">Solo Refacciones</SelectItem>
                                        <SelectItem value="PARTNER">Captador Aliado</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor={`edit-business-category-${business.id}`}>Categoría de directorio</Label>
                                <Input
                                    id={`edit-business-category-${business.id}`}
                                    value={category}
                                    disabled={working}
                                    onChange={(e) => setCategory(e.target.value)}
                                    placeholder="Taller y Refacciones"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor={`edit-business-phone-${business.id}`}>Teléfono público</Label>
                                <Input
                                    id={`edit-business-phone-${business.id}`}
                                    value={phone}
                                    disabled={working}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="33 1234 5678"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`edit-business-address-${business.id}`}>Dirección</Label>
                            <Input
                                id={`edit-business-address-${business.id}`}
                                value={address}
                                disabled={working}
                                onChange={(e) => setAddress(e.target.value)}
                                placeholder="Calle, número, colonia, ciudad"
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                            <div className="space-y-0.5">
                                <Label htmlFor={`edit-business-directory-${business.id}`}>
                                    Mostrar en el directorio /mercado
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    Lista este negocio y sus productos públicos en el directorio global.
                                </p>
                            </div>
                            <Switch
                                id={`edit-business-directory-${business.id}`}
                                checked={showInDirectory}
                                disabled={working}
                                onCheckedChange={(checked) => setShowInDirectory(checked === true)}
                            />
                        </div>
                        <DialogFooter className="pt-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleOpenChange(false)}
                                disabled={working}
                            >
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={working}>
                                {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                                Guardar cambios
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
