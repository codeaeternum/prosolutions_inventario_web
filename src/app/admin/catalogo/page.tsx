"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CategoriesPanel } from "../categorias/page"
import { BrandsPanel } from "../marcas/page"
import { ModelsPanel } from "../modelos/page"

const TABS = ["categorias", "marcas", "modelos"] as const
type Tab = (typeof TABS)[number]

function CatalogoTabs() {
  const searchParams = useSearchParams()
  const param = searchParams.get("tab")
  const initial: Tab = (TABS as readonly string[]).includes(param ?? "") ? (param as Tab) : "categorias"

  return (
    <Tabs defaultValue={initial} className="space-y-6">
      <TabsList>
        <TabsTrigger value="categorias">Categorías</TabsTrigger>
        <TabsTrigger value="marcas">Marcas</TabsTrigger>
        <TabsTrigger value="modelos">Modelos</TabsTrigger>
      </TabsList>
      <TabsContent value="categorias"><CategoriesPanel embedded /></TabsContent>
      <TabsContent value="marcas"><BrandsPanel embedded /></TabsContent>
      <TabsContent value="modelos"><ModelsPanel embedded /></TabsContent>
    </Tabs>
  )
}

export default function CatalogoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Clasificación del catálogo</h2>
        <p className="text-muted-foreground">
          Organiza tus productos por tipo de refacción, marca y modelo de equipo
        </p>
      </div>
      <Suspense fallback={null}>
        <CatalogoTabs />
      </Suspense>
    </div>
  )
}
