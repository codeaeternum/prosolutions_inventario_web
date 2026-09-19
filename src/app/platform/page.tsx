import type { Metadata } from "next"
import { OverviewPanel } from "@/components/platform/overview-panel"
import { BusinessesPanel } from "@/components/platform/businesses-panel"
import { DirectoryPanel } from "@/components/platform/directory-panel"

// Consola viva: siempre datos frescos de la base.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Plataforma",
  description: "Consola de operación de Reficio: empresas, métricas y suspensiones.",
  robots: { index: false, follow: false },
}

export default function PlatformPage() {
  return (
    <div className="space-y-12">
      <OverviewPanel />
      <BusinessesPanel />
      <DirectoryPanel />
    </div>
  )
}
