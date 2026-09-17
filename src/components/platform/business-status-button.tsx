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
import { Ban, CheckCircle2, Loader2 } from "lucide-react"

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
