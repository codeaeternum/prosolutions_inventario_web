"use client"

import { Suspense } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Users, CreditCard, Package, Loader2 } from "lucide-react"
import { ClientesPanel } from "@/components/admin/clientes/clientes-panel"
import { CobranzaPanel } from "@/components/admin/clientes/cobranza-panel"
import { PedidosPanel } from "@/components/admin/clientes/pedidos-panel"

const TABS = ["clientes", "cobranza", "pedidos"] as const
type Tab = (typeof TABS)[number]

const DESCRIPTIONS: Record<Tab, string> = {
  clientes: "Directorio de clientes aprobados, su actividad y saldo a crédito",
  cobranza: "Cartera activa, abonos y recuperación",
  pedidos: "Encargos, apartados web y apartados de mostrador",
}

/**
 * /admin/clientes — hub de clientes. Las rutas viejas /admin/credito y
 * /admin/reservas redirigen a las pestañas Cobranza y Pedidos.
 * La pestaña activa viaja en ?tab= (default: clientes).
 */
function ClientesHub() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  const rawTab = searchParams.get("tab")
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "clientes"

  const handleTabChange = (value: string) => {
    // Al cambiar de pestaña se sueltan los filtros de la pestaña anterior.
    router.replace(`${pathname}?tab=${value}`, { scroll: false })
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Clientes</h2>
        <p className="text-muted-foreground">{DESCRIPTIONS[tab]}</p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <div className="overflow-x-auto pb-2">
          <TabsList className="mb-4 flex-nowrap min-w-max">
            <TabsTrigger value="clientes" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Clientes
            </TabsTrigger>
            <TabsTrigger value="cobranza" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Cobranza
            </TabsTrigger>
            <TabsTrigger value="pedidos" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Pedidos
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="clientes" className="mt-0">
          <ClientesPanel />
        </TabsContent>
        <TabsContent value="cobranza" className="mt-0">
          <CobranzaPanel />
        </TabsContent>
        <TabsContent value="pedidos" className="mt-0">
          <PedidosPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function ClientesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <ClientesHub />
    </Suspense>
  )
}
