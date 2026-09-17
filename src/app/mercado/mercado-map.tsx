"use client"

import dynamic from "next/dynamic"
import type { DirectoryBusiness } from "@/lib/directory"

// Leaflet toca `window` al importarse: el mapa real vive en mercado-map-inner
// y solo se carga en el cliente (ssr:false no es válido en Server Components,
// por eso este wrapper es "use client").
const MercadoMapInner = dynamic(() => import("./mercado-map-inner"), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden
      className="h-[400px] w-full animate-pulse rounded-xl border bg-muted"
    />
  ),
})

/** Mapa del directorio: un marcador por negocio con lat/lng. */
export function MercadoMap({ businesses }: { businesses: DirectoryBusiness[] }) {
  return <MercadoMapInner businesses={businesses} />
}
