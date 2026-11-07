import type { Metadata } from "next"
import { getBusinessSetting, getBusinessSettingsMap, getOrderFolioDigits } from "@/lib/settings"
import { parseQuoteValidityDays } from "@/app/api/cotizacion/quote-config"
import { loadQuoteByToken } from "@/lib/public-quote"
import { DocumentShell } from "@/components/public/document-shell"
import { isQuoteExpired, QuoteDocument, QuoteExpired, QuoteNotFound } from "@/components/public/quote-view"

export const dynamic = "force-dynamic"

// Página global de cotización: fallback sin marca cuando el negocio no tiene
// slug público o el enlace se compartió como /cotizacion/<token>. La variante
// brandeada vive en /<slug>/cotizacion/[token] y reutiliza QuoteDocument.

// Título genérico a propósito: el link llega por WhatsApp y un
// "Cotización OT-000123" en el <title> filtraba el folio de la orden a
// cualquiera que capturara el documento (pestaña, historial, previews).
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Cotización",
    description: "Consulta y autoriza la cotización de tu reparación.",
    // Enlace privado por WhatsApp: nunca indexable.
    robots: { index: false, follow: false },
  }
}

export default async function CotizacionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await loadQuoteByToken(token)

  // Igual que la API pública: una vez entregada o cancelada la cotización ya
  // no es un documento vigente — no debe seguir mostrando montos ni datos.
  if (!order || order.status === "DELIVERED" || order.status === "CANCELLED") {
    return (
      <DocumentShell>
        <QuoteNotFound trackingHref="/seguimiento" />
      </DocumentShell>
    )
  }

  // El branding, largo del folio, vigencia y términos salen del negocio
  // DUEÑO de la orden, no del negocio por defecto.
  const [businessName, folioDigits, quoteSettings] = await Promise.all([
    getBusinessSetting(order.businessId, "ticket_business_name"),
    getOrderFolioDigits(order.businessId),
    getBusinessSettingsMap(order.businessId, ["quote_validity_days", "quote_terms"]),
  ])
  const validityDays = parseQuoteValidityDays(quoteSettings.get("quote_validity_days"))
  const terms = quoteSettings.get("quote_terms") || undefined

  // "Válida por N días": vencida sin decisión se muestra el estado de
  // vigencia terminada en vez del desglose (mismo 410 que la API pública).
  if (isQuoteExpired(order, validityDays)) {
    return (
      <DocumentShell>
        <QuoteExpired trackingHref="/seguimiento" />
      </DocumentShell>
    )
  }

  return (
    <DocumentShell>
      <QuoteDocument
        order={order}
        businessName={businessName || "Reficio"}
        token={token}
        folioDigits={folioDigits}
        validityDays={validityDays}
        terms={terms}
      />
    </DocumentShell>
  )
}
