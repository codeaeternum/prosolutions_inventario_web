import type { Metadata } from "next"

// Reservas del cliente autenticado: contenido privado — jamás indexable.
export const metadata: Metadata = {
  title: "Mis reservas",
  description: "Consulta el estado, el QR y la vigencia de tus reservas.",
  robots: { index: false, follow: false },
}

export default function MisReservasLayout({ children }: { children: React.ReactNode }) {
  return children
}
