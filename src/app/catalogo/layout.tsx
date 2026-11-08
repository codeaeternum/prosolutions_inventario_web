import type { Metadata } from "next"

// La página es cliente (no puede exportar metadata). La vitrina pública
// canónica e indexable del catálogo es /<slug>/market — /catalogo es la
// vista de tienda para clientes con cuenta, así que no se indexa.
export const metadata: Metadata = {
  title: "Catálogo",
  description: "Explora refacciones y accesorios, agrega al carrito y reserva en línea.",
  robots: { index: false, follow: false },
}

export default function CatalogoLayout({ children }: { children: React.ReactNode }) {
  return children
}
