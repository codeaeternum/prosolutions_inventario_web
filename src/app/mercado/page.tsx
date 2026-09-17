import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, MapPin, PackageSearch, Sparkles, Store, Wrench } from "lucide-react"
import { listDirectoryBusinesses, type DirectoryBusiness } from "@/lib/directory"
import { directoryCategoryLabel } from "@/lib/directory-categories"
import { PublicShell } from "@/components/public/public-shell"
import { Button } from "@/components/ui/button"
import { MercadoSearch } from "./mercado-search"
import { MercadoMap } from "./mercado-map"

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

        <section className="container mx-auto max-w-5xl px-4 pb-16 pt-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Negocios</h2>
              <p className="text-sm text-muted-foreground">
                {businesses.length === 1
                  ? "1 negocio con vitrina pública"
                  : `${businesses.length} negocios con vitrina pública`}
              </p>
            </div>
          </div>

          {businesses.length === 0 ? (
            <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
              <PackageSearch className="h-10 w-10 text-muted-foreground mx-auto" />
              <h3 className="font-semibold text-lg">Aún no hay negocios</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Cuando los negocios activen su vitrina pública aparecerán aquí.
              </p>
              <Button variant="outline" asChild>
                <Link href="/registro">Registra tu negocio</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {businesses.map(business => (
                <BusinessCard key={business.slug} business={business} />
              ))}
            </div>
          )}
        </section>
      </MercadoSearch>
    </PublicShell>
  )
}

function BusinessCard({ business }: { business: DirectoryBusiness }) {
  const initial = business.name.trim().charAt(0).toUpperCase() || "N"
  const { products, workshopServices } = business.counts

  const countsLabel = [
    products > 0 ? `${products} producto${products === 1 ? "" : "s"}` : null,
    workshopServices > 0
      ? `${workshopServices} servicio${workshopServices === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Link
      href={`/${business.slug}`}
      className="group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
    >
      <div className="flex items-center gap-3">
        {business.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo subido por el negocio, path dinámico
          <img
            src={business.logoUrl}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl object-contain bg-primary/5"
          />
        ) : (
          <div
            aria-hidden
            className="h-12 w-12 shrink-0 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg"
          >
            {initial}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug truncate">{business.name}</h3>
          <p className="text-xs text-muted-foreground">{directoryCategoryLabel(business.category)}</p>
        </div>
      </div>

      <div className="space-y-1.5 text-sm text-muted-foreground">
        {countsLabel && (
          <p className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {countsLabel}
          </p>
        )}
        {business.address && (
          <p className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{business.address.split("\n")[0]}</span>
          </p>
        )}
      </div>

      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
        Ver vitrina
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
