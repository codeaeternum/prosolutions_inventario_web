"use client"

import { Suspense } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowRightLeft, History, Warehouse } from "lucide-react"
import MovimientosInventario from "./components/movimientos"
import { ExistenciasPanel } from "@/components/admin/inventario/existencias"
import { HistorialMovimientos } from "@/components/admin/inventario/historial-movimientos"

const TABS = ["existencias", "movimiento", "historial"] as const
type Tab = (typeof TABS)[number]

function InventarioTabs() {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()
    const param = searchParams.get("tab")
    const tab: Tab = (TABS as readonly string[]).includes(param ?? "") ? (param as Tab) : "existencias"

    const handleTabChange = (value: string) => {
        router.replace(`${pathname}?tab=${value}`, { scroll: false })
    }

    return (
        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
            <div className="overflow-x-auto pb-2">
                <TabsList className="mb-4 flex-nowrap min-w-max">
                    <TabsTrigger value="existencias" className="flex items-center gap-2">
                        <Warehouse className="h-4 w-4" />
                        Existencias
                    </TabsTrigger>
                    <TabsTrigger value="movimiento" className="flex items-center gap-2">
                        <ArrowRightLeft className="h-4 w-4" />
                        Registrar movimiento
                    </TabsTrigger>
                    <TabsTrigger value="historial" className="flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Historial
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="existencias" className="mt-0">
                <ExistenciasPanel />
            </TabsContent>

            <TabsContent value="movimiento" className="mt-0">
                <MovimientosInventario />
            </TabsContent>

            <TabsContent value="historial" className="mt-0">
                <HistorialMovimientos />
            </TabsContent>
        </Tabs>
    )
}

export default function InventarioPage() {
    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Warehouse className="h-6 w-6" />
                        Inventario
                    </h1>
                    <p className="text-muted-foreground">
                        Existencias por sucursal, entradas, ajustes y traspasos
                    </p>
                </div>
            </div>

            <Suspense fallback={null}>
                <InventarioTabs />
            </Suspense>
        </div>
    )
}
