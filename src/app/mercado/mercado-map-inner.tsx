"use client"

import { useEffect, useMemo } from "react"
import Link from "next/link"
import L from "leaflet"
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
// directory.ts importa prisma (pg): en un Client Component solo se puede
// consumir vía `import type`. El helper de categorías vive en un módulo
// sin dependencias de servidor.
import type { DirectoryBusiness } from "@/lib/directory"
import { directoryCategoryLabel } from "@/lib/directory-categories"

// Tiles gratuitos de OpenStreetMap — attribution obligatoria por su política.
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

const MAP_HEIGHT = "h-[400px]"

/**
 * Marcador con la inicial del negocio. Los PNGs por defecto de Leaflet se
 * rompen con bundlers (las URLs se resuelven mal), así que usamos divIcon:
 * un círculo primario estilizado con clases de Tailwind — mismas utilidades
 * globales, sin assets.
 */
function businessIcon(name: string): L.DivIcon {
  const initial = (name.trim().charAt(0) || "N").toUpperCase()
  // El html va como string: escapamos el carácter por defensiva.
  const safe = initial.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
  return L.divIcon({
    // Clase propia: reemplaza leaflet-div-icon (fondo blanco/borde default).
    className: "mercado-pin",
    html: `<div class="flex h-full w-full items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold shadow-md ring-2 ring-background">${safe}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  })
}

/** Encuadra todos los marcadores; con uno solo centra a zoom de colonia. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 15)
      return
    }
    map.fitBounds(L.latLngBounds(points), { padding: [48, 48] })
  }, [map, points])
  return null
}

function productsLabel(count: number): string {
  if (count <= 0) return "Sin productos publicados"
  return `${count} producto${count === 1 ? "" : "s"}`
}

export default function MercadoMapInner({
  businesses,
}: {
  businesses: DirectoryBusiness[]
}) {
  // Defensivo: la página ya filtra, pero el mapa solo dibuja coords válidas.
  const mapped = useMemo(
    () =>
      businesses.filter(
        (b): b is DirectoryBusiness & { lat: number; lng: number } =>
          typeof b.lat === "number" && typeof b.lng === "number"
      ),
    [businesses]
  )
  const points = useMemo(
    () => mapped.map(b => [b.lat, b.lng] as [number, number]),
    [mapped]
  )
  const icons = useMemo(
    () => new Map(mapped.map(b => [b.slug, businessIcon(b.name)])),
    [mapped]
  )

  if (mapped.length === 0) return null

  return (
    // relative + z-0 crean stacking context: los panes de Leaflet usan
    // z-index altos que, sin aislar, taparían el header sticky al hacer scroll.
    <div className={`relative z-0 w-full overflow-hidden rounded-xl border bg-muted ${MAP_HEIGHT}`}>
      <MapContainer
        center={points[0]}
        zoom={13}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer url={OSM_TILES} attribution={OSM_ATTRIBUTION} />
        <FitBounds points={points} />
        {mapped.map(b => (
          <Marker key={b.slug} position={[b.lat, b.lng]} icon={icons.get(b.slug)}>
            <Popup>
              <div className="min-w-40 space-y-1.5">
                <div className="space-y-0.5">
                  <p className="font-semibold leading-tight">{b.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {directoryCategoryLabel(b.category)} · {productsLabel(b.counts.products)}
                  </p>
                </div>
                <Link
                  href={`/${b.slug}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Ver vitrina →
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
