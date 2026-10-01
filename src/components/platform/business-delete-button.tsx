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
import { Loader2, Trash2 } from "lucide-react"

interface BusinessDeleteButtonProps {
    business: { id: string; name: string }
}

/**
 * Elimina una empresa sin datos operativos (altas de prueba/broma). El
 * servidor rechaza con 409 si tiene actividad real — ahí solo queda
 * suspender. Tras borrar, vuelve al listado de empresas.
 */
export function BusinessDeleteButton({ business }: BusinessDeleteButtonProps) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [working, setWorking] = useState(false)

    const handleConfirm = async () => {
        if (working) return
        setWorking(true)
        try {
            const res = await fetch(`/api/platform/businesses/${business.id}`, { method: "DELETE" })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || "No se pudo eliminar la empresa.")
            toast.success("Empresa eliminada", {
                description: `${business.name} y sus datos semilla fueron borrados.`,
            })
            setOpen(false)
            router.push("/platform")
            router.refresh()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error al eliminar")
            setOpen(false)
        } finally {
            setWorking(false)
        }
    }

    return (
        <>
            <Button
                variant="destructive"
                size="sm"
                onClick={() => setOpen(true)}
                aria-label={`Eliminar ${business.name}`}
            >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Eliminar empresa
            </Button>
            <AlertDialog open={open} onOpenChange={setOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar {business.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Borra la empresa y sus datos semilla (usuarios, sucursales,
                            servicios sugeridos). Solo procede si no tiene operación real:
                            con productos, ventas u órdenes el servidor la rechaza y la
                            opción correcta es suspenderla. Esta acción no se puede
                            deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirm}
                            disabled={working}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {working && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                            Eliminar definitivamente
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
