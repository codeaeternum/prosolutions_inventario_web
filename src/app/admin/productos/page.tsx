"use client"

import { Suspense } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FolderTree, Package, QrCode, Zap } from "lucide-react"
import { ProductosPanel } from "./panel"
import { CapturaRapidaPanel } from "@/components/admin/productos/captura-rapida"
import { EtiquetasPanel } from "../etiquetas/panel"
import { CategoriesPanel } from "../categorias/panel"
import { BrandsPanel } from "../marcas/panel"
import { ModelsPanel } from "../modelos/panel"

const TABS = ["productos", "captura", "clasificacion", "etiquetas"] as const
type Tab = (typeof TABS)[number]

const SUBTABS = ["categorias", "marcas", "modelos"] as const
type SubTab = (typeof SUBTABS)[number]

const DESCRIPTIONS: Record<Tab, string> = {
  productos: "Gestiona las refacciones del inventario",
  captura: "Alta rápida de productos en serie: escanea el código y captura",
  clasificacion: "Organiza tus productos por tipo de refacción, marca y modelo de equipo",
  etiquetas: "Genera etiquetas con código QR para pegar en los productos",
}

function ProductosTabs() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const param = searchParams.get("tab")
  const tab: Tab = (TABS as readonly string[]).includes(param ?? "") ? (param as Tab) : "productos"
  const subParam = searchParams.get("sub")
  const sub: SubTab = (SUBTABS as readonly string[]).includes(subParam ?? "") ? (subParam as SubTab) : "categorias"

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", value)
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  const handleSubChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "clasificacion")
    params.set("sub", value)
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6" />
            Productos
          </h1>
          <p className="text-muted-foreground">
            {DESCRIPTIONS[tab]}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="overflow-x-auto pb-2">
          <TabsList className="mb-4 flex-nowrap min-w-max">
            <TabsTrigger value="productos" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Productos
            </TabsTrigger>
            <TabsTrigger value="captura" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Captura rápida
            </TabsTrigger>
            <TabsTrigger value="clasificacion" className="flex items-center gap-2">
              <FolderTree className="h-4 w-4" />
              Clasificación
            </TabsTrigger>
            <TabsTrigger value="etiquetas" className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              Etiquetas
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="productos" className="mt-0">
          <ProductosPanel />
        </TabsContent>

        <TabsContent value="captura" className="mt-0">
          <CapturaRapidaPanel />
        </TabsContent>

        <TabsContent value="clasificacion" className="mt-0">
          <Tabs value={sub} onValueChange={handleSubChange} className="w-full">
            <div className="overflow-x-auto pb-2">
              <TabsList className="mb-4 flex-nowrap min-w-max">
                <TabsTrigger value="categorias">Categorías</TabsTrigger>
                <TabsTrigger value="marcas">Marcas</TabsTrigger>
                <TabsTrigger value="modelos">Modelos</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="categorias" className="mt-0">
              <CategoriesPanel embedded />
            </TabsContent>
            <TabsContent value="marcas" className="mt-0">
              <BrandsPanel embedded />
            </TabsContent>
            <TabsContent value="modelos" className="mt-0">
              <ModelsPanel embedded />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="etiquetas" className="mt-0">
          <EtiquetasPanel />
        </TabsContent>
      </Tabs>
    </>
  )
}

export default function ProductosPage() {
  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <Suspense fallback={null}>
        <ProductosTabs />
      </Suspense>
    </div>
  )
}
