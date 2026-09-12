import type { Metadata } from "next"

// El template del root layout agrega "| Reficio" → "Rastrea tu reparación | Reficio".
export const metadata: Metadata = {
  title: "Rastrea tu reparación",
  description: "Consulta el estado de tu equipo en reparación con el folio de tu ticket — sin cuenta ni llamadas.",
}

export default function SeguimientoLayout({ children }: { children: React.ReactNode }) {
  return children
}
