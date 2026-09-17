import type { Metadata } from "next"
import Link from "next/link"
import { MapPin, Sparkles } from "lucide-react"
import { listDirectoryBusinesses } from "@/lib/directory"
import { PublicShell } from "@/components/public/public-shell"
import { Button } from "@/components/ui/button"
import { MercadoSearch } from "./mercado-search"
import { MercadoMap } from "./mercado-map"
import { MercadoBusinesses } from "./mercado-businesses"

// Directorio vivo (altas de negocios y catálogos cambian): siempre dinámico.
// La API detrás tiene su propio s-maxage para el CDN.
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Mercado",
  description:
    "Encuentra talleres y refacciones: busca productos entre todos los negocios que publican su vitrina en Reficio.",
  alternates: { canonical: "/mercado" },
  robots: { index: true, follow: true },
}

export default async function MercadoPage() {
  const businesses = await listDirectoryBusinesses()
  // Solo negocios con ambas coordenadas salen en el mapa.
  const mapped = businesses.filter(b => b.lat != null && b.lng != null)

  return (
    <PublicShell
      brandName="Reficio"
      homeHref="/"
      headerRight={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login">Acceso interno</Link>
        </Button>
      }
    >
      {/* Hero */}
      <section className="container mx-auto max-w-4xl px-4 pt-14 pb-10 text-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Directorio de negocios en reficio.app
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tighter leading-[1.05]">
            <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">
              Encuentra talleres y refacciones
            </span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Busca entre los negocios que publican su vitrina en Reficio:
            refacciones, accesorios y servicio de reparación cerca de ti.
          </p>
        </div>
      </section>

      {/* Buscador + resultados (o mapa + grid de negocios) */}
      <MercadoSearch>
        {mapped.length > 0 && (
          <section className="container mx-auto max-w-5xl px-4 pt-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <MapPin className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">En el mapa</h2>
                <p className="text-sm text-muted-foreground">
                  {mapped.length === 1
                    ? "1 negocio con ubicación"
                    : `${mapped.length} negocios con ubicación`}
                </p>
              </div>
            </div>
            <MercadoMap businesses={mapped} />
          </section>
        )}

        {/* Grid + acciones de cercanía/taller: cliente porque usa
            geolocalización del navegador (DirectoryBusiness es serializable). */}
        <MercadoBusinesses businesses={businesses} />
      </MercadoSearch>
    </PublicShell>
  )
}
