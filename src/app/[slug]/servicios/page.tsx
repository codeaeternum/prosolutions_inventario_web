import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  ArrowLeft, ArrowRight, Gamepad2, Laptop, MapPin, MessageCircle, Monitor,
  Package, PackageSearch, Printer, Smartphone, Store, Tablet, Watch, Wrench,
  type LucideIcon,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { resolvePublicSlug } from "@/lib/public-slug"
import { formatPrice } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { PublicShell } from "@/components/public/public-shell"
import { WhatsAppButton, waMeHref } from "@/components/public/whatsapp-button"

// Catálogo público de servicios del negocio (/<slug>/servicios). El catálogo
// vive en BD y cambia seguido: siempre dinámico.
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)
  if (!target || target.kind !== "business") {
    return { title: "Servicios", robots: { index: false, follow: false } }
  }
  return {
    title: `Servicios — ${target.name}`,
    description: `Servicios de reparación de ${target.name}: cotiza por WhatsApp y rastrea tu equipo en línea.`,
    robots: { index: true, follow: true },
  }
}

const GENERAL_GROUP = "General"

type Service = {
  id: string
  name: string
  description: string | null
  priceCents: number | null
  equipmentType: string | null
}

// Icono por tipo de equipo (mismo criterio que el catálogo interno del taller,
// con Package como genérico para "General" y tipos sin equivalente).
function serviceIcon(type: string | null): LucideIcon {
  const value = (type ?? "").toLowerCase()
  if (value.includes("celular") || value.includes("smartphone") || value.includes("fono")) return Smartphone
  if (value.includes("tablet")) return Tablet
  if (value.includes("laptop") || value.includes("notebook") || value.includes("macbook")) return Laptop
  if (value.includes("computadora") || value.includes("pc") || value.includes("escritorio")) return Monitor
  if (value.includes("pantalla") || value.includes("monitor") || value.includes("tv")) return Monitor
  if (value.includes("consola") || value.includes("game") || value.includes("xbox") || value.includes("playstation")) return Gamepad2
  if (value.includes("watch") || value.includes("reloj")) return Watch
  if (value.includes("impresora") || value.includes("printer")) return Printer
  return Package
}

// Mensaje precargado del CTA: "Hola, quiero cotizar <servicio> para mi <equipo>".
function serviceMessage(service: Service): string {
  const equipo = service.equipmentType?.trim().toLowerCase() || "equipo"
  return `Hola, quiero cotizar ${service.name} para mi ${equipo}`
}

export default async function PublicServicesPage({ params }: PageProps) {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)
  if (!target) notFound()
  // El catálogo de servicios es vitrina del negocio; un taller aliado muestra
  // su propio perfil, así que se regresa a su portada.
  if (target.kind !== "business") redirect(`/${target.slug}`)

  const services = await prisma.workshopService.findMany({
    where: { businessId: target.businessId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, priceCents: true, equipmentType: true },
  })

  // Agrupar por tipo de equipo: "General" (sin tipo) primero porque aplica a
  // cualquier dispositivo; el resto en orden alfabético.
  const groups = new Map<string, Service[]>()
  for (const service of services) {
    const key = service.equipmentType?.trim() || GENERAL_GROUP
    const list = groups.get(key) ?? []
    list.push(service)
    groups.set(key, list)
  }
  const orderedGroups = [...groups.entries()].sort(([a], [b]) => {
    if (a === GENERAL_GROUP) return -1
    if (b === GENERAL_GROUP) return 1
    return a.localeCompare(b, "es")
  })

  const mapsUrl = target.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target.address)}`
    : null

  return (
    <PublicShell
      brandName={target.name}
      logoUrl={target.logo}
      homeHref={`/${target.slug}`}
      headerRight={
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${target.slug}/order-status`}>Rastrea tu reparación</Link>
        </Button>
      }
    >
      <section className="container mx-auto max-w-4xl px-4 pt-10 pb-16">
        {/* Encabezado */}
        <div className="space-y-4 mb-10">
          <Link
            href={`/${target.slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {target.name}
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Wrench className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Servicios</h1>
              <p className="text-sm text-muted-foreground">
                {target.description ?? `Reparación y mantenimiento profesional en ${target.name}.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <WhatsAppButton
              phone={target.phone}
              message="Hola, quiero cotizar un servicio para mi equipo"
              size="lg"
              className="gap-2"
            >
              Cotizar por WhatsApp
            </WhatsAppButton>
            {mapsUrl && (
              <Button variant="outline" size="lg" className="gap-2" asChild>
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                  <MapPin className="h-4 w-4" />
                  <span className="max-w-56 truncate">{target.address}</span>
                </a>
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Precios sugeridos: el costo final se confirma al recibir y diagnosticar tu equipo.
          </p>
        </div>

        {/* Catálogo agrupado por tipo de equipo */}
        {orderedGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
            <Wrench className="h-10 w-10 text-muted-foreground mx-auto" />
            <h2 className="font-semibold text-lg">Catálogo en preparación</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Aún no publicamos la lista de servicios. Escríbenos por WhatsApp y te cotizamos al momento.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {orderedGroups.map(([groupName, groupServices]) => {
              const GroupIcon = serviceIcon(groupName === GENERAL_GROUP ? null : groupName)
              return (
                <section key={groupName} aria-label={groupName}>
                  <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
                    <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <GroupIcon className="h-4 w-4 text-primary" />
                    </span>
                    {groupName === GENERAL_GROUP ? "Para cualquier equipo" : groupName}
                  </h2>
                  <ul className="mt-4 rounded-xl border bg-card divide-y overflow-hidden">
                    {groupServices.map(service => {
                      const waHref = waMeHref(target.phone, serviceMessage(service))
                      const price = service.priceCents != null ? formatPrice(service.priceCents / 100) : "Cotizar"
                      const row = (
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-snug">{service.name}</p>
                            {service.description && (
                              <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{service.description}</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-primary whitespace-nowrap">{price}</p>
                            {waHref && (
                              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-primary">
                                <MessageCircle className="h-3 w-3" />
                                Cotizar
                              </p>
                            )}
                          </div>
                        </>
                      )
                      return (
                        <li key={service.id}>
                          {waHref ? (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/50"
                              aria-label={`Cotizar ${service.name} por WhatsApp`}
                            >
                              {row}
                            </a>
                          ) : (
                            <div className="flex items-center gap-4 px-5 py-4">{row}</div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        {/* Sin teléfono público: hint de contacto en lugar de CTAs de WhatsApp */}
        {!target.phone && (
          <p className="mt-8 rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            Para cotizar un servicio, visítanos{target.address ? <> en <span className="font-medium text-foreground">{target.address}</span></> : ""} o contáctanos por nuestros canales habituales.
          </p>
        )}

        {/* Accesos relacionados */}
        <div className="grid sm:grid-cols-2 gap-4 mt-12">
          <Link
            href={`/${target.slug}/order-status`}
            className="group flex flex-col gap-3 rounded-xl border bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <PackageSearch className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-semibold text-lg">¿Dejaste un equipo?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Rastrea el estado de tu reparación con el folio de tu ticket — sin llamadas ni cuentas.
            </p>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              Rastrear
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            href={`/${target.slug}/market`}
            className="group flex flex-col gap-3 rounded-xl border bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-semibold text-lg">Mercado de refacciones</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Pantallas, baterías, flexores y accesorios — precio de menudeo al público.
            </p>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              Ver catálogo
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </section>
    </PublicShell>
  )
}
