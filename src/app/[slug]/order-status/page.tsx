import type { Metadata } from "next"
import { Suspense } from "react"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { resolvePublicSlug } from "@/lib/public-slug"
import { PublicShell } from "@/components/public/public-shell"
import { TrackOrder } from "@/components/public/track-order"

// El slug vive en BD y el resultado del rastreo es por usuario: dinámico.
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)
  if (!target) {
    return { title: "Rastrea tu reparación", robots: { index: false, follow: false } }
  }
  const title = `Rastrea tu reparación — ${target.name}`
  const description = `Consulta el estado de tu equipo en ${target.name} con el folio de tu ticket — sin cuenta ni llamadas.`
  return {
    title,
    description,
    alternates: { canonical: `/${target.slug}/order-status` },
    // openGraph manual pisa la imagen de la convención opengraph-image del
    // segmento [slug]; hay que referenciarla de forma explícita.
    openGraph: { title, description, images: [`/${target.slug}/opengraph-image`] },
    robots: { index: true, follow: true },
  }
}

// Sirve tanto al negocio como a talleres aliados: las reparaciones de los
// clientes del taller viven en este mismo sistema.
export default async function PublicOrderStatusPage({ params }: PageProps) {
  const { slug } = await params
  const target = await resolvePublicSlug(slug)
  if (!target) notFound()

  return (
    <PublicShell
      brandName={target.name}
      logoUrl={target.logo}
      homeHref={`/${target.slug}`}
      headerRight={
        <Link
          href={`/${target.slug}`}
          aria-label="Volver a la tienda"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Volver</span>
        </Link>
      }
    >
      <Suspense fallback={
        <div className="container mx-auto max-w-2xl px-4 pt-14 pb-20">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
        </div>
      }>
        <TrackOrder brandName={target.name} />
      </Suspense>
    </PublicShell>
  )
}
