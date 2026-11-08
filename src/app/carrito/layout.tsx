import type { Metadata } from "next"

// Carrito del cliente: contenido privado por dispositivo — jamás indexable.
export const metadata: Metadata = {
  title: "Carrito",
  description: "Revisa tus productos y confirma tu reserva.",
  robots: { index: false, follow: false },
}

export default function CarritoLayout({ children }: { children: React.ReactNode }) {
  return children
}
