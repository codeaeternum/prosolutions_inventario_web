"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Clock, History, TrendingUp, Users } from "lucide-react"
import { ActividadPanel } from "@/components/admin/equipo/actividad-panel"
import { UsuariosPanel } from "@/components/admin/equipo/usuarios-panel"
import { TurnosPanel } from "@/components/admin/equipo/turnos-panel"
import { DesempenoPanel } from "@/components/admin/equipo/desempeno-panel"

const TABS = ["actividad", "usuarios", "turnos", "desempeno"] as const
type Tab = (typeof TABS)[number]

/**
 * Hub "Equipo": junta en una pantalla el registro de actividad, la gestión
 * de usuarios/permisos y los turnos derivados de la actividad real (antes
 * /admin/actividad y /admin/usuarios, que hoy redirigen aquí).
 * ?tab=actividad|usuarios|turnos|desempeno; ?actor=<id>&anombre=<nombre>
 * pre-filtra el feed a una persona (enlace "Ver actividad" del tab Usuarios).
 */
export function EquipoPanel() {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()

    const rawTab = searchParams.get("tab")
    const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "")
        ? (rawTab as Tab)
        : "actividad"

    const actorParam = searchParams.get("actor")
    const actorName = searchParams.get("anombre")

    const handleTabChange = (value: string) => {
        // Al cambiar de pestaña se sueltan los params de filtro de la otra vista
        // (actor, page, filter…), mismo criterio que el hub de Inventario.
        router.replace(`${pathname}?tab=${value}`, { scroll: false })
    }

    return (
        <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Users className="h-7 w-7" />
                        Equipo
                    </h1>
                    <p className="text-muted-foreground">Actividad y permisos de tu equipo</p>
                </div>
            </div>

            <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
                <div className="overflow-x-auto pb-2">
                    <TabsList className="mb-4 flex-nowrap min-w-max">
                        <TabsTrigger value="actividad" className="flex items-center gap-2">
                            <History className="h-4 w-4" />
                            Actividad
                        </TabsTrigger>
                        <TabsTrigger value="usuarios" className="flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Usuarios
                        </TabsTrigger>
                        <TabsTrigger value="turnos" className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Turnos
                        </TabsTrigger>
                        <TabsTrigger value="desempeno" className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            Desempeño
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="actividad" className="mt-0">
                    {/* key = actor: cambiar la persona (o quitar el filtro) remonta
                        el feed limpio, sin arrastrar paginación ni búsquedas. */}
                    <ActividadPanel
                        key={actorParam ?? "todos"}
                        initialActorId={actorParam}
                        initialActorName={actorName}
                    />
                </TabsContent>

                <TabsContent value="usuarios" className="mt-0">
                    <UsuariosPanel />
                </TabsContent>

                <TabsContent value="turnos" className="mt-0">
                    <TurnosPanel />
                </TabsContent>

                {/* Solo ADMIN llega aquí: la página /admin/equipo ya redirige a
                    cualquier otro rol, igual que con el tab de Actividad. */}
                <TabsContent value="desempeno" className="mt-0">
                    <DesempenoPanel />
                </TabsContent>
            </Tabs>
        </>
    )
}
