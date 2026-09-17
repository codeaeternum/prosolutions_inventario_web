"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowRight, Loader2, LocateFixed, MapPin, PackageSearch, Store, Wrench,
} from "lucide-react"
import { toast } from "sonner"
// directory.ts importa prisma: en un Client Component solo se puede consumir
// vía `import type`. Las categorías viven en un módulo sin deps de servidor.
import type { DirectoryBusiness } from "@/lib/directory"
import { directoryCategoryLabel } from "@/lib/directory-categories"
import { trackDirectoryClick } from "@/lib/directory-track"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface Coords {
  lat: number
  lng: number
}

/** Distancia gran-círculo entre dos puntos (km). */
function haversineKm(a: Coords, b: Coords): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/** "a 850 m" / "a 2.4 km" / "a 18 km" — legible sin precisión falsa. */
function distanceLabel(km: number): string {
  if (km < 1) return `a ${Math.max(50, Math.round(km * 100) * 10)} m`
  if (km < 10) return `a ${km.toFixed(1)} km`
  return `a ${Math.round(km)} km`
}

/** Distancia del negocio al usuario, o null si no aplica (sin coords en alguno). */
function businessDistanceKm(
  business: DirectoryBusiness,
  coords: Coords | null,
  nearbyOn: boolean,
): number | null {
  if (!nearbyOn || !coords) return null
  if (business.lat == null || business.lng == null) return null
  return haversineKm(coords, { lat: business.lat, lng: business.lng })
}

/**
 * Grid de negocios del directorio (vista por defecto de /mercado, cuando el
 * buscador no está activo). Cliente porque agrega dos interacciones sobre la
 * lista que llega ya resuelta del servidor:
 * - "Cerca de ti": geolocalización del navegador + orden por distancia.
 * - "Con servicio de taller": chip que filtra a negocios con taller publicado.
 * Ambos se combinan: el filtro reduce la lista y el orden por distancia la ordena.
 */
export function MercadoBusinesses({ businesses }: { businesses: DirectoryBusiness[] }) {
  const [coords, setCoords] = useState<Coords | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)
  // nearbyOn separa "tengo coords" de "estoy ordenando por cercanía": el
  // usuario puede apagar el orden sin volver a pedir permiso al reactivarlo.
  const [nearbyOn, setNearbyOn] = useState(false)
  const [workshopOnly, setWorkshopOnly] = useState(false)

  const workshopCount = useMemo(
    () => businesses.filter(b => b.counts.workshopServices > 0).length,
    [businesses],
  )

  const displayed = useMemo(() => {
    const filtered = workshopOnly
      ? businesses.filter(b => b.counts.workshopServices > 0)
      : businesses
    if (!nearbyOn || !coords) return filtered
    // Sin coords del negocio → distancia infinita → van al final, en su orden
    // original (sort estable de JS conserva los empates).
    return [...filtered].sort((a, b) => {
      const da = a.lat != null && a.lng != null
        ? haversineKm(coords, { lat: a.lat, lng: a.lng })
        : Infinity
      const db = b.lat != null && b.lng != null
        ? haversineKm(coords, { lat: b.lat, lng: b.lng })
        : Infinity
      return da - db
    })
  }, [businesses, workshopOnly, nearbyOn, coords])

  const requestLocation = () => {
    if (nearbyOn) {
      setNearbyOn(false)
      return
    }
    if (coords) {
      setNearbyOn(true)
      return
    }
    if (!("geolocation" in navigator)) {
      toast.info("Tu navegador no puede compartir tu ubicación.")
      return
    }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setNearbyOn(true)
        setGeoLoading(false)
      },
      error => {
        setGeoLoading(false)
        if (error.code === error.PERMISSION_DENIED) {
          toast.info(
            "Activa el permiso de ubicación en tu navegador para ver los negocios más cercanos.",
          )
        } else {
          toast.info("No pudimos obtener tu ubicación. Intenta de nuevo.")
        }
      },
      // Precisión baja basta para ordenar negocios; responde más rápido y
      // maximumAge reutiliza una lectura reciente sin volver a preguntar.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  }

  return (
    <section className="container mx-auto max-w-5xl px-4 pb-16 pt-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Store className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Negocios</h2>
          <p className="text-sm text-muted-foreground">
            {workshopOnly
              ? `${displayed.length} de ${businesses.length} con servicio de taller`
              : businesses.length === 1
                ? "1 negocio con vitrina pública"
                : `${businesses.length} negocios con vitrina pública`}
            {nearbyOn && coords ? " · ordenados por cercanía" : ""}
          </p>
        </div>
      </div>

      {/* Acciones sobre el grid: cercanía (geolocalización) + filtro taller. */}
      {businesses.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={nearbyOn ? "default" : "outline"}
            size="sm"
            onClick={requestLocation}
            disabled={geoLoading}
            aria-pressed={nearbyOn}
            className="gap-1.5 rounded-full"
          >
            {geoLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <LocateFixed className="h-4 w-4" aria-hidden />
            )}
            {geoLoading ? "Ubicando…" : "Cerca de ti"}
          </Button>

          {workshopCount > 0 && (
            <button
              type="button"
              onClick={() => setWorkshopOnly(v => !v)}
              aria-pressed={workshopOnly}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                workshopOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden />
              Con servicio de taller{" "}
              <span className={workshopOnly ? "text-primary-foreground/70" : "text-muted-foreground/70"}>
                ({workshopCount})
              </span>
            </button>
          )}
        </div>
      )}

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
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <Wrench className="h-10 w-10 text-muted-foreground mx-auto" />
          <h3 className="font-semibold text-lg">Sin servicio de taller</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Ningún negocio del directorio publica servicios de taller por ahora.
          </p>
          <Button variant="outline" onClick={() => setWorkshopOnly(false)}>
            Quitar filtro
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayed.map(business => (
            <BusinessCard
              key={business.slug}
              business={business}
              distanceKm={businessDistanceKm(business, coords, nearbyOn)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function BusinessCard({
  business,
  distanceKm,
}: {
  business: DirectoryBusiness
  distanceKm: number | null
}) {
  const initial = business.name.trim().charAt(0).toUpperCase() || "N"
  const { products, workshopServices } = business.counts
  const hasWorkshop = workshopServices > 0

  const countsLabel = [
    products > 0 ? `${products} producto${products === 1 ? "" : "s"}` : null,
    hasWorkshop
      ? `${workshopServices} servicio${workshopServices === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Link
      href={`/${business.slug}`}
      onClick={() => trackDirectoryClick(business.slug)}
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
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug truncate">{business.name}</h3>
          <p className="text-xs text-muted-foreground">{directoryCategoryLabel(business.category)}</p>
        </div>
        {hasWorkshop && (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Wrench className="h-3 w-3" aria-hidden />
            Taller
          </Badge>
        )}
      </div>

      <div className="space-y-1.5 text-sm text-muted-foreground">
        {distanceKm != null && (
          <p className="flex items-center gap-1.5 font-medium text-primary">
            <LocateFixed className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {distanceLabel(distanceKm)}
          </p>
        )}
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
