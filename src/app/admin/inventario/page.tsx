"use client"

import { Suspense, useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ArrowRightLeft, ClipboardList, History, PackageX, ShoppingCart, Truck, Warehouse } from "lucide-react"
import MovimientosInventario from "./components/movimientos"
import { HistorialMovimientos } from "@/components/admin/inventario/historial-movimientos"
import { MermasPanel } from "@/components/admin/inventario/mermas-panel"
import { ComprasPanel } from "@/components/admin/inventario/compras-panel"
import { EncargosPanel } from "@/components/admin/inventario/encargos-panel"
import { ProveedoresPanel } from "@/components/admin/inventario/proveedores-panel"

const TABS = ["movimiento", "historial", "mermas", "compras", "encargos", "proveedores"] as const
type Tab = (typeof TABS)[number]

function InventarioTabs() {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()
    const param = searchParams.get("tab")
    const tab: Tab = (TABS as readonly string[]).includes(param ?? "") ? (param as Tab) : "movimiento"

    // Compatibilidad con bookmarks: la pestaña "existencias" migró a /admin/productos.
    const isLegacyExistencias = param === "existencias"
    useEffect(() => {
        if (!isLegacyExistencias) return
        const params = new URLSearchParams(searchParams.toString())
        router.replace(`/admin/productos?${params}`, { scroll: false })
    }, [isLegacyExistencias, searchParams, router])

    if (isLegacyExistencias) return null

    const handleTabChange = (value: string) => {
        router.replace(`${pathname}?tab=${value}`, { scroll: false })
    }

    return (
        <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Warehouse className="h-6 w-6" />
                        Almacén
                    </h1>
                    <p className="text-muted-foreground">
                        Operaciones de inventario: movimientos, compras, conteos y proveedores
                    </p>
                </div>
            </div>

            <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
                <div className="overflow-x-auto pb-2">
                    <TabsList className="mb-4 flex-nowrap min-w-max">
                        <TabsTrigger value="movimiento" className="flex items-center gap-2">
                            <ArrowRightLeft className="h-4 w-4" />
                            Registrar movimiento
                        </TabsTrigger>
                        <TabsTrigger value="historial" className="flex items-center gap-2">
                            <History className="h-4 w-4" />
                            Historial
                        </TabsTrigger>
                        <TabsTrigger value="mermas" className="flex items-center gap-2">
                            <PackageX className="h-4 w-4" />
                            Mermas
                        </TabsTrigger>
                        <TabsTrigger value="compras" className="flex items-center gap-2">
                            <ShoppingCart className="h-4 w-4" />
                            Compras
                        </TabsTrigger>
                        <TabsTrigger value="encargos" className="flex items-center gap-2">
                            <ClipboardList className="h-4 w-4" />
                            Encargos
                        </TabsTrigger>
                        <TabsTrigger value="proveedores" className="flex items-center gap-2">
                            <Truck className="h-4 w-4" />
                            Proveedores
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="movimiento" className="mt-0">
                    <MovimientosInventario />
                </TabsContent>

                <TabsContent value="historial" className="mt-0">
                    <HistorialMovimientos />
                </TabsContent>

                <TabsContent value="mermas" className="mt-0">
                    <MermasPanel />
                </TabsContent>

                <TabsContent value="compras" className="mt-0">
                    <ComprasPanel />
                </TabsContent>

                <TabsContent value="encargos" className="mt-0">
                    <EncargosPanel />
                </TabsContent>

                <TabsContent value="proveedores" className="mt-0">
                    <ProveedoresPanel />
                </TabsContent>
            </Tabs>
        </>
    )
}

export default function InventarioPage() {
    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <Suspense fallback={null}>
                <InventarioTabs />
            </Suspense>
        </div>
    )
}
