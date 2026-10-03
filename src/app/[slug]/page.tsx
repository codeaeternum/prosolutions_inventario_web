import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowRight, BadgeCheck, MapPin, PackageSearch, Sparkles, Store, Wrench,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { resolvePublicSlug, type SlugTarget } from "@/lib/public-slug"
import { formatPrice } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PublicShell } from "@/components/public/public-shell"
import { WhatsAppButton } from "@/components/public/whatsapp-button"

// El slug vive en BD (Business/User): nada que cachear estáticamente.
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)
  if (!target) {
    return { title: "Página no encontrada", robots: { index: false, follow: false } }
  }
  // Vitrina pública: indexable para ambos (el taller también quiere que sus
  // clientes lo encuentren por nombre).
  return {
    title: target.name,
    description:
      target.kind === "business"
        ? target.description ?? `Refacciones, accesorios y servicio de reparación en ${target.name}.`
        : `${target.name} — taller aliado. Rastrea tu reparación en línea.`,
    robots: { index: true, follow: true },
  }
}

export default async function PublicSlugPage({ params }: PageProps) {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)
  if (!target) notFound()

  return target.kind === "business"
    ? <BusinessLanding target={target} />
    : <WorkshopLanding target={target} />
}

// ==================== Negocio ====================

type BusinessTarget = Extract<SlugTarget, { kind: "business" }>

async function BusinessLanding({ target }: { target: BusinessTarget }) {
  const services = await prisma.workshopService.findMany({
    where: { businessId: target.businessId, isActive: true },
    orderBy: { name: "asc" },
    take: 8,
    select: { id: true, name: true, description: true, priceCents: true, equipmentType: true },
  })

  const mapsUrl = target.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target.address)}`
    : null

  // Datos estructurados (schema.org): RepairShop es subtipo de LocalBusiness.
  // Solo campos ya públicos en la vitrina — misma regla que el directorio.
  const siteUrl = (process.env.NEXTAUTH_URL || "https://reficio.app").replace(/\/+$/, "")
  const pageUrl = `${siteUrl}/${target.slug}`
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RepairShop",
    "@id": pageUrl,
    name: target.name,
    url: pageUrl,
    description:
      target.description ??
      `Refacciones, accesorios y servicio de reparación en ${target.name}.`,
    ...(target.address
      ? { address: { "@type": "PostalAddress", streetAddress: target.address } }
      : {}),
    ...(target.phone ? { telephone: target.phone } : {}),
    ...(target.lat != null && target.lng != null
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: target.lat,
            longitude: target.lng,
          },
        }
      : {}),
    ...(target.logo ? { image: `${siteUrl}${target.logo}` } : {}),
  }

  const cards = [
    {
      href: `/${target.slug}/market`,
      icon: Store,
      title: "Mercado de refacciones",
      desc: "Pantallas, baterías, flexores y más — precio al público.",
    },
    {
      href: `/${target.slug}/order-status`,
      icon: PackageSearch,
      title: "Rastrea tu reparación",
      desc: "Consulta el estado de tu equipo con el folio de tu ticket.",
    },
    {
      href: `/${target.slug}/servicios`,
      icon: Wrench,
      title: "Servicios",
      desc: "Cambio de pantalla, batería, software y diagnóstico profesional.",
    },
  ]

  return (
    <PublicShell
      brandName={target.name}
      homeHref={`/${target.slug}`}
      logoUrl={target.logo}
      headerRight={
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${target.slug}/order-status`}>Rastrea tu reparación</Link>
        </Button>
      }
    >
      {/* JSON-LD LocalBusiness: escapamos "<" por defensiva (datos de BD). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      {/* Hero */}
      <section className="container mx-auto max-w-4xl px-4 pt-14 pb-12 text-center">
        <div className="space-y-6">
          {target.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- logo subido por el negocio, path dinámico
            <img
              src={target.logo}
              alt={`Logo de ${target.name}`}
              className="mx-auto h-20 w-auto max-w-64 rounded-xl object-contain"
            />
          )}

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Refacciones y servicio técnico
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tighter leading-[1.05]">
            <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">
              {target.name}
            </span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            {target.description ?? "Refacciones, accesorios y reparación profesional de tus dispositivos."}
          </p>

          {/* Contacto */}
          <div id="contacto" className="flex flex-wrap justify-center items-center gap-3 pt-2 scroll-mt-24">
            <WhatsAppButton phone={target.phone} size="lg" className="gap-2">
              WhatsApp
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
        </div>
      </section>

      {/* Accesos principales */}
      <section className="container mx-auto max-w-4xl px-4 pb-12">
        <div className="grid sm:grid-cols-3 gap-4">
          {cards.map(card => (
            <Link
              key={card.title}
              href={card.href}
              className="group flex flex-col gap-3 rounded-xl border bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
              <h2 className="font-semibold text-lg leading-snug">{card.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{card.desc}</p>
              <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
                Entrar
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Servicios del taller */}
      {services.length > 0 && (
        <section id="servicios" className="border-t bg-muted/30 scroll-mt-20">
          <div className="container mx-auto max-w-4xl px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight">Servicios</h2>
            <p className="text-muted-foreground mt-1 mb-6">
              Lo que hacemos por tu equipo. El precio final se confirma al recibirlo.
            </p>
            <ul className="rounded-xl border bg-card divide-y overflow-hidden">
              {services.map(service => (
                <li key={service.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">{service.name}</p>
                    {service.equipmentType && (
                      <p className="text-xs text-muted-foreground mt-0.5">{service.equipmentType}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-primary">
                    {service.priceCents != null ? formatPrice(service.priceCents / 100) : "A cotizar"}
                  </span>
                </li>
              ))}
            </ul>
            <Button variant="link" asChild className="mt-4 px-0">
              <Link href={`/${target.slug}/servicios`}>
                Ver todos los servicios y cotizar por WhatsApp →
              </Link>
            </Button>
          </div>
        </section>
      )}
    </PublicShell>
  )
}

// ==================== Taller aliado ====================

type WorkshopTarget = Extract<SlugTarget, { kind: "workshop" }>

function WorkshopLanding({ target }: { target: WorkshopTarget }) {
  // Nombre del negocio del taller (Business del user), para "Taller aliado de X".
  const businessName = target.businessName

  return (
    <PublicShell
      brandName={target.name}
      homeHref={`/${target.slug}`}
      logoUrl={target.logo}
      headerRight={
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/${target.slug}/order-status`}>Rastrear</Link>
        </Button>
      }
    >
      <section className="container mx-auto max-w-2xl px-4 pt-14 pb-16 text-center">
        <div className="space-y-6">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-sm">
            <BadgeCheck className="h-4 w-4 text-primary" />
            Taller aliado de {businessName}
          </Badge>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tighter leading-[1.05]">
            <span className="bg-gradient-to-r from-primary via-violet-400 to-indigo-500 bg-clip-text text-transparent">
              {target.name}
            </span>
          </h1>

          <p className="text-muted-foreground max-w-md mx-auto">
            Servicio de reparación con respaldo de {businessName}: refacciones originales y rastreo en línea de tu equipo.
          </p>

          {target.phone && (
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <WhatsAppButton phone={target.phone} size="lg" className="gap-2">
                WhatsApp
              </WhatsAppButton>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-12 text-left">
          <Link
            href={`/${target.slug}/order-status`}
            className="group flex flex-col gap-3 rounded-xl border bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <PackageSearch className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-semibold text-lg">Rastrea tu reparación</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Consulta el estado de tu equipo con el folio de tu ticket.
            </p>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              Consultar
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            href={`/login?callbackUrl=${encodeURIComponent("/admin/mercado")}`}
            className="group flex flex-col gap-3 rounded-xl border bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <h2 className="font-semibold text-lg">¿Necesitas refacciones?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Solicita a nuestro proveedor: precio de taller para talleres aliados.
            </p>
            <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
              Ir al mercado
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </section>
    </PublicShell>
  )
}
