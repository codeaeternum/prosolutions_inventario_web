import { Suspense } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { EquipoPanel } from "@/components/admin/equipo/equipo-panel"

/**
 * /admin/equipo — hub del equipo: registro de actividad + cuentas y permisos
 * (antes /admin/actividad y /admin/usuarios). Vista exclusiva de ADMIN: el
 * check a nivel página cubre lo que el middleware hacía en las rutas viejas.
 */
export default async function EquipoPage() {
    const session = await auth()
    if (!session?.user?.id) redirect("/login")
    if (session.user.role !== "ADMIN") redirect("/admin")

    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <Suspense fallback={null}>
                <EquipoPanel />
            </Suspense>
        </div>
    )
}
