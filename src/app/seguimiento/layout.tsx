import type { Metadata } from "next"

// El template del root layout agrega "| Reficio" → "Rastrea tu reparación | Reficio".
export const metadata: Metadata = {
  title: "Rastrea tu reparación",
  description: "Consulta el estado de tu equipo en reparación con el folio de tu ticket — sin cuenta ni llamadas.",
  // Consulta por credencial (folio+teléfono o trackingToken): un buscador no
  // debe indexar ni la página ni los links que circulan por WhatsApp.
  robots: { index: false, follow: false },
}

export default function SeguimientoLayout({ children }: { children: React.ReactNode }) {
  return children
}
