"use client"

import { useCallback, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
    ArrowRightLeft,
    ClipboardList,
    History,
    Package,
    PackagePlus,
    ShoppingCart,
    Truck,
} from "lucide-react"
import { StockPanel } from "@/components/admin/inventario/stock-panel"
import { ComprasPanel } from "@/components/admin/inventario/compras-panel"
import { ProveedoresPanel } from "@/components/admin/inventario/proveedores-panel"
import { EncargosPanel } from "@/components/admin/inventario/encargos-panel"
import { HistorialMovimientos } from "@/components/admin/inventario/historial-movimientos"
import { EntradaRapidaDialog } from "@/components/admin/inventario/entrada-rapida-dialog"
import MovimientosInventario from "@/app/admin/inventario/components/movimientos"

const TABS = ["stock", "entradas", "encargos", "historial"] as const
type Tab = (typeof TABS)[number]

// Nombres viejos de pestaña (hub "Almacén") → su lugar en el Inventario nuevo.
const LEGACY_TABS: Record<string, { tab: Tab; sub?: string }> = {
    existencias: { tab: "stock" },
    movimiento: { tab: "entradas", sub: "lote" },
    compras: { tab: "entradas" },
    proveedores: { tab: "entradas", sub: "proveedores" },
    mermas: { tab: "historial" },
}

const ENTRADAS_SUBTABS = ["compras", "lote", "proveedores"] as const
type EntradasSubTab = (typeof ENTRADAS_SUBTABS)[number]

const DESCRIPTIONS: Record<Tab, string> = {
    stock: "Lo que tengo y cuánto: catálogo, existencias por sucursal y precios",
    entradas: "Órdenes de compra, recepción de mercancía, entradas directas y proveedores",
    encargos: "Piezas por conseguir: faltantes de órdenes, stock bajo y encargos manuales",
    historial: "Entradas, salidas, mermas, traspasos, conteos y devoluciones",
}

export interface InventarioViewer {
    role: string
    homeBranchId: string | null
}

interface InventarioPanelProps {
    viewer: InventarioViewer
    branches: { id: string; name: string }[]
}

/**
 * Inventario = LA pantalla de productos/stock. Las rutas viejas
 * (/admin/productos, /admin/movimientos, /admin/encargos…) redirigen aquí.
 */
export function InventarioPanel({ viewer, branches }: InventarioPanelProps) {
    const searchParams = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()

    const rawTab = searchParams.get("tab")
    const legacy = rawTab ? LEGACY_TABS[rawTab] : undefined
    const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "")
        ? (rawTab as Tab)
        : legacy?.tab ?? "stock"

    const subParam = searchParams.get("sub")
    const legacySub = legacy?.sub
    const entradasSub: EntradasSubTab =
        (ENTRADAS_SUBTABS as readonly string[]).includes(subParam ?? "")
            ? (subParam as EntradasSubTab)
            : (ENTRADAS_SUBTABS as readonly string[]).includes(legacySub ?? "")
                ? (legacySub as EntradasSubTab)
                : "compras"

    // Entrada rápida disponible desde Stock y desde Entradas (?entrada=1).
    const entradaOpen = searchParams.get("entrada") === "1"
    // Filtro de historial por producto (?producto=<id>&pnombre=<name>).
    const historialProductId = searchParams.get("producto")
    const historialProductName = searchParams.get("pnombre")

    const [refreshKey, setRefreshKey] = useState(0)
    // Remonta EncargosPanel (lista de compras del almacén) cuando la tarjeta
    // "Sugerencias de compra" agrega pendientes desde Entradas → Compras.
    const [needsKey, setNeedsKey] = useState(0)
    const isEmployee = viewer.role !== "ADMIN"
    const lockedBranchId = isEmployee ? viewer.homeBranchId : null

    const setParams = useCallback((patch: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString())
        for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") params.delete(key)
            else params.set(key, value)
        }
        router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, [pathname, router, searchParams])

    const handleTabChange = (value: string) => {
        // Al cambiar de pestaña se sueltan los params de acción/filtro viejos.
        router.replace(`${pathname}?tab=${value}`, { scroll: false })
    }

    const handleEntradasSubChange = (value: string) => {
        setParams({ tab: "entradas", sub: value === "compras" ? null : value })
    }

    return (
        <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Package className="h-6 w-6" />
                        Inventario
                    </h1>
                    <p className="text-muted-foreground">{DESCRIPTIONS[tab]}</p>
                </div>
            </div>

            <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
                <div className="overflow-x-auto pb-2">
                    {/* Móvil: grid de 4 columnas para que las 4 pestañas quepan
                        sin scroll; sm+: ancho natural con scroll como fallback. */}
                    <TabsList className="mb-4 grid w-full min-w-0 grid-cols-4 sm:inline-flex sm:w-auto sm:min-w-max sm:flex-nowrap">
                        <TabsTrigger value="stock" className="flex items-center gap-2">
                            <Package className="hidden h-4 w-4 shrink-0 sm:block" />
                            <span className="truncate">Stock</span>
                        </TabsTrigger>
                        <TabsTrigger value="entradas" className="flex items-center gap-2">
                            <ShoppingCart className="hidden h-4 w-4 shrink-0 sm:block" />
                            <span className="truncate">Entradas</span>
                        </TabsTrigger>
                        <TabsTrigger value="encargos" className="flex items-center gap-2">
                            <ClipboardList className="hidden h-4 w-4 shrink-0 sm:block" />
                            <span className="truncate">Encargos</span>
                        </TabsTrigger>
                        <TabsTrigger value="historial" className="flex items-center gap-2">
                            <History className="hidden h-4 w-4 shrink-0 sm:block" />
                            <span className="truncate">Historial</span>
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="stock" className="mt-0">
                    <StockPanel viewer={viewer} branches={branches} refreshKey={refreshKey} />
                </TabsContent>

                <TabsContent value="entradas" className="mt-0">
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button onClick={() => setParams({ entrada: "1" })}>
                                <PackagePlus className="mr-2 h-4 w-4" />
                                Entrada rápida
                            </Button>
                            <p className="text-sm text-muted-foreground">
                                Suma existencias sin orden de compra; para una entrada formal crea una OC.
                            </p>
                        </div>

                        <Tabs value={entradasSub} onValueChange={handleEntradasSubChange} className="w-full">
                            <div className="overflow-x-auto pb-2">
                                <TabsList className="mb-4 flex-nowrap min-w-max">
                                    <TabsTrigger value="compras" className="flex items-center gap-2">
                                        <ShoppingCart className="h-4 w-4" />
                                        Órdenes de compra
                                    </TabsTrigger>
                                    <TabsTrigger value="lote" className="flex items-center gap-2">
                                        <ArrowRightLeft className="h-4 w-4" />
                                        Entrada directa (lote)
                                    </TabsTrigger>
                                    <TabsTrigger value="proveedores" className="flex items-center gap-2">
                                        <Truck className="h-4 w-4" />
                                        Proveedores
                                    </TabsTrigger>
                                </TabsList>
                            </div>
                            <TabsContent value="compras" className="mt-0">
                                <ComprasPanel onNeedsChanged={() => setNeedsKey(k => k + 1)} />
                            </TabsContent>
                            <TabsContent value="lote" className="mt-0">
                                <MovimientosInventario lockedBranchId={lockedBranchId} />
                            </TabsContent>
                            <TabsContent value="proveedores" className="mt-0">
                                <ProveedoresPanel />
                            </TabsContent>
                        </Tabs>
                    </div>
                </TabsContent>

                <TabsContent value="encargos" className="mt-0">
                    <EncargosPanel key={needsKey} />
                </TabsContent>

                <TabsContent value="historial" className="mt-0">
                    <HistorialMovimientos
                        productId={historialProductId}
                        productName={historialProductName}
                        onClearProduct={() => setParams({ producto: null, pnombre: null })}
                    />
                </TabsContent>
            </Tabs>

            {/* Entrada rápida compartida: la abre Stock (?entrada=1) y Entradas. */}
            <EntradaRapidaDialog
                branches={branches}
                lockedBranchId={lockedBranchId}
                open={entradaOpen}
                onOpenChange={(o) => { if (!o) setParams({ entrada: null }) }}
                onSaved={() => setRefreshKey((k) => k + 1)}
            />
        </>
    )
}
