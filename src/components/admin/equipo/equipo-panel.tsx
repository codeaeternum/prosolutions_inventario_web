"use client"

import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Clock, History, LogIn, TrendingUp, Users, Wallet } from "lucide-react"

/** Mientras baja el chunk del tab: esqueleto genérico de panel (el tab no queda en blanco). */
function PanelLoading() {
    return (
        <div className="space-y-4" role="status" aria-label="Cargando panel">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-28" />
                ))}
            </div>
        </div>
    )
}

const ActividadPanel = dynamic(
    () => import("@/components/admin/equipo/actividad-panel").then((m) => m.ActividadPanel),
    { ssr: false, loading: () => <PanelLoading /> }
)
const UsuariosPanel = dynamic(
    () => import("@/components/admin/equipo/usuarios-panel").then((m) => m.UsuariosPanel),
    { ssr: false, loading: () => <PanelLoading /> }
)
const AsistenciaPanel = dynamic(
    () => import("@/components/admin/equipo/asistencia-panel").then((m) => m.AsistenciaPanel),
    { ssr: false, loading: () => <PanelLoading /> }
)
const TurnosPanel = dynamic(
    () => import("@/components/admin/equipo/turnos-panel").then((m) => m.TurnosPanel),
    { ssr: false, loading: () => <PanelLoading /> }
)
const DesempenoPanel = dynamic(
    () => import("@/components/admin/equipo/desempeno-panel").then((m) => m.DesempenoPanel),
    { ssr: false, loading: () => <PanelLoading /> }
)
const NominaPanel = dynamic(
    () => import("@/components/admin/equipo/nomina-panel").then((m) => m.NominaPanel),
    { ssr: false, loading: () => <PanelLoading /> }
)

const TABS = ["actividad", "usuarios", "asistencia", "turnos", "desempeno", "nomina"] as const
type Tab = (typeof TABS)[number]

const DESCRIPTIONS: Record<Tab, string> = {
    actividad: "Bitácora de auditoría y acciones recientes de todo el personal",
    usuarios: "Cuentas de empleados, clientes, roles, sucursales y permisos por módulo",
    asistencia: "Entradas y salidas que cada integrante marca con el reloj de asistencia",
    turnos: "Asistencia y sesiones operativas derivadas de la actividad real",
    desempeno: "Métricas de productividad, ventas y órdenes atendidas por integrante",
    nomina: "Sueldo estimado por integrante según su esquema de pago y actividad",
}

/**
 * Hub "Equipo": junta en una pantalla el registro de actividad, la gestión
 * de usuarios/permisos y los turnos derivados de la actividad real (antes
 * /admin/actividad y /admin/usuarios, que hoy redirigen aquí).
 * ?tab=actividad|usuarios|asistencia|turnos|desempeno|nomina; ?actor=<id>&anombre=<nombre>
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
                    <p className="text-muted-foreground">{DESCRIPTIONS[tab]}</p>
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
                        <TabsTrigger value="asistencia" className="flex items-center gap-2">
                            <LogIn className="h-4 w-4" />
                            Asistencia
                        </TabsTrigger>
                        <TabsTrigger value="turnos" className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Turnos
                        </TabsTrigger>
                        <TabsTrigger value="desempeno" className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            Desempeño
                        </TabsTrigger>
                        <TabsTrigger value="nomina" className="flex items-center gap-2">
                            <Wallet className="h-4 w-4" />
                            Nómina
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

                <TabsContent value="asistencia" className="mt-0">
                    <AsistenciaPanel />
                </TabsContent>

                <TabsContent value="turnos" className="mt-0">
                    <TurnosPanel />
                </TabsContent>

                {/* Solo ADMIN llega aquí: la página /admin/equipo ya redirige a
                    cualquier otro rol, igual que con el tab de Actividad. */}
                <TabsContent value="desempeno" className="mt-0">
                    <DesempenoPanel />
                </TabsContent>
                <TabsContent value="nomina" className="mt-0">
                    <NominaPanel />
                </TabsContent>
            </Tabs>
        </>
    )
}
