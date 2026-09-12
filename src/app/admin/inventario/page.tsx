"use client"

import ProductosPage from "../productos/page"
import CategoriasPage from "../categorias/page"
import MarcasPage from "../marcas/page"
import ModelosPage from "../modelos/page"
import EtiquetasPage from "../etiquetas/page"
import MovimientosInventario from "./components/movimientos"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Layers, Package, QrCode, Tag, Tags, ArrowRightLeft } from "lucide-react"

export default function InventarioPage() {
    return (
        <div className="space-y-6 pb-20 lg:pb-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Package className="h-6 w-6" />
                        Inventario y Catálogo
                    </h1>
                    <p className="text-muted-foreground">
                        Gestiona tus productos, categorías, marcas y códigos QR
                    </p>
                </div>
            </div>

            <Tabs defaultValue="productos" className="w-full">
                <div className="overflow-x-auto pb-2">
                    <TabsList className="mb-4 flex-nowrap min-w-max">
                        <TabsTrigger value="productos" className="flex items-center gap-2">
                            <Package className="h-4 w-4" />
                            Productos
                        </TabsTrigger>
                        <TabsTrigger value="movimientos" className="flex items-center gap-2">
                            <ArrowRightLeft className="h-4 w-4" />
                            Ajustes/Entradas
                        </TabsTrigger>
                        <TabsTrigger value="categorias" className="flex items-center gap-2">
                            <Tags className="h-4 w-4" />
                            Categorías
                        </TabsTrigger>
                        <TabsTrigger value="marcas" className="flex items-center gap-2">
                            <Tag className="h-4 w-4" />
                            Marcas
                        </TabsTrigger>
                        <TabsTrigger value="modelos" className="flex items-center gap-2">
                            <Layers className="h-4 w-4" />
                            Modelos
                        </TabsTrigger>
                        <TabsTrigger value="etiquetas" className="flex items-center gap-2">
                            <QrCode className="h-4 w-4" />
                            Etiquetas QR
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="productos" className="mt-0">
                    <ProductosPage />
                </TabsContent>

                <TabsContent value="movimientos" className="mt-0">
                    <MovimientosInventario />
                </TabsContent>

                <TabsContent value="categorias" className="mt-0">
                    <CategoriasPage />
                </TabsContent>

                <TabsContent value="marcas" className="mt-0">
                    <MarcasPage />
                </TabsContent>

                <TabsContent value="modelos" className="mt-0">
                    <ModelosPage />
                </TabsContent>

                <TabsContent value="etiquetas" className="mt-0">
                    <EtiquetasPage />
                </TabsContent>
            </Tabs>
        </div>
    )
}
