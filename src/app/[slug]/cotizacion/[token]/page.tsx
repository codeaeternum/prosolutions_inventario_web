import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { repairFolio } from "@/lib/workshop-labels"
import { isValidSlug, normalizeSlug, resolveSlug } from "@/lib/public-slug"
import { loadQuoteByToken } from "@/lib/public-quote"
import { Button } from "@/components/ui/button"
import { PublicShell } from "@/components/public/public-shell"
import { QuoteDocument, QuoteNotFound } from "@/components/public/quote-view"

// Cotización brandeada bajo la vitrina del negocio (/<slug>/cotizacion/<token>).
// Mismo documento que /cotizacion/[token], pero dentro del PublicShell del
// negocio — es el link que comparte el staff cuando hay business_slug.
// Enlace privado por WhatsApp: siempre dinámico y jamás indexable.
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string; token: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, token } = await params
  const [target, order] = await Promise.all([
    resolveSlug(slug),
    prisma.repairOrder.findUnique({ where: { quoteToken: token }, select: { number: true } }),
  ])
  const title = order ? `Cotización ${repairFolio(order.number)}` : "Cotización"
  return {
    title: target?.kind === "business" ? `${title} — ${target.name}` : title,
    description: "Consulta y autoriza la cotización de tu reparación.",
    robots: { index: false, follow: false },
  }
}

/** business_slug del negocio (vacío si no está configurado). */
async function getBusinessSlug(): Promise<string> {
  const row = await prisma.systemSettings.findUnique({
    where: { key: "business_slug" },
    select: { value: true },
  })
  const slug = normalizeSlug(row?.value ?? "")
  return isValidSlug(slug) ? slug : ""
}

export default async function SlugCotizacionPage({ params }: PageProps) {
  const { slug, token } = await params
  const target = await resolveSlug(slug)
  if (!target) notFound()

  // Las cotizaciones las emite el negocio: un taller aliado no tiene documento
  // propio. Se reenvía a la ruta brandeada del negocio (o a la global si el
  // negocio aún no tiene slug).
  if (target.kind === "workshop") {
    const businessSlug = await getBusinessSlug()
    const safeToken = encodeURIComponent(token)
    redirect(businessSlug ? `/${businessSlug}/cotizacion/${safeToken}` : `/cotizacion/${safeToken}`)
  }

  const order = await loadQuoteByToken(token)

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
      {order ? (
        <QuoteDocument order={order} businessName={target.name} token={token} />
      ) : (
        <QuoteNotFound trackingHref={`/${target.slug}/order-status`} />
      )}
    </PublicShell>
  )
}
