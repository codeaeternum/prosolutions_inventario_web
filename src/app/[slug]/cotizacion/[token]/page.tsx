import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getBusinessSettingsMap, getOrderFolioDigits } from "@/lib/settings"
import { parseQuoteValidityDays } from "@/app/api/cotizacion/quote-config"
import { repairFolio } from "@/lib/workshop-labels"
import { isValidSlug, normalizeSlug, resolvePublicSlug } from "@/lib/public-slug"
import { loadQuoteByToken } from "@/lib/public-quote"
import { Button } from "@/components/ui/button"
import { PublicShell } from "@/components/public/public-shell"
import { isQuoteExpired, QuoteDocument, QuoteExpired, QuoteNotFound } from "@/components/public/quote-view"

// Cotización brandeada bajo la vitrina del negocio (/<slug>/cotizacion/<token>).
// Mismo documento que /cotizacion/[token], pero dentro del PublicShell del
// negocio — es el link que comparte el staff cuando el negocio tiene slug.
// Enlace privado por WhatsApp: siempre dinámico y jamás indexable.
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ slug: string; token: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, token } = await params
  const [target, order] = await Promise.all([
    resolvePublicSlug(slug),
    prisma.repairOrder.findUnique({ where: { quoteToken: token }, select: { number: true, businessId: true } }),
  ])
  const title = order ? `Cotización ${repairFolio(order.number, await getOrderFolioDigits(order.businessId))}` : "Cotización"
  return {
    title: target?.kind === "business" ? `${title} — ${target.name}` : title,
    description: "Consulta y autoriza la cotización de tu reparación.",
    robots: { index: false, follow: false },
  }
}

/** Slug público del negocio indicado (vacío si no está activo/configurado). */
async function getBusinessSlug(businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true, isActive: true },
  })
  const slug = normalizeSlug(business?.slug ?? "")
  return business?.isActive && isValidSlug(slug) ? slug : ""
}

export default async function SlugCotizacionPage({ params }: PageProps) {
  const { slug, token } = await params
  const target = await resolvePublicSlug(slug)
  if (!target) notFound()

  // Las cotizaciones las emite el negocio: un taller aliado no tiene documento
  // propio. Se reenvía a la ruta brandeada de SU negocio (o a la global si el
  // negocio aún no tiene slug).
  if (target.kind === "workshop") {
    const businessSlug = await getBusinessSlug(target.businessId)
    const safeToken = encodeURIComponent(token)
    redirect(businessSlug ? `/${businessSlug}/cotizacion/${safeToken}` : `/cotizacion/${safeToken}`)
  }

  const order = await loadQuoteByToken(token, target.businessId)
  // Folio, vigencia y términos del negocio dueño de la orden
  // (order_folio_digits, quote_validity_days, quote_terms).
  const [folioDigits, quoteSettings] = order
    ? await Promise.all([
        getOrderFolioDigits(order.businessId),
        getBusinessSettingsMap(order.businessId, ["quote_validity_days", "quote_terms"]),
      ])
    : [undefined, undefined]
  const validityDays = parseQuoteValidityDays(quoteSettings?.get("quote_validity_days"))
  const terms = quoteSettings?.get("quote_terms") || undefined

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
      {order && order.status !== "DELIVERED" && order.status !== "CANCELLED" ? (
        isQuoteExpired(order, validityDays) ? (
          // Vigencia terminada ("Válida por N días"): se muestra el estado
          // vencido en vez del desglose, igual que el 410 de la API pública.
          <QuoteExpired trackingHref={`/${target.slug}/order-status`} />
        ) : (
          <QuoteDocument order={order} businessName={target.name} token={token} folioDigits={folioDigits} validityDays={validityDays} terms={terms} />
        )
      ) : (
        <QuoteNotFound trackingHref={`/${target.slug}/order-status`} />
      )}
    </PublicShell>
  )
}
