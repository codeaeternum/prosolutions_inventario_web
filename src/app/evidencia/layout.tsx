import type { Metadata } from "next"

// Enlace público por QR para subir evidencias sin login (técnico en celular).
export const metadata: Metadata = {
  title: "Subir evidencias",
  description: "Sube fotos del equipo en reparación escaneando el código del ticket — sin cuenta.",
  robots: { index: false, follow: false },
}

export default function EvidenciaLayout({ children }: { children: React.ReactNode }) {
  return children
}
