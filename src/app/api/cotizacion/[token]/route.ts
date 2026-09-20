import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getBusinessSetting } from "@/lib/settings"
import { ORDER_FOLIO_DIGITS_KEY, parseFolioDigits, repairFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { DEFAULT_QUOTE_TERMS, isQuoteExpiredAt, parseQuoteValidityDays, quoteExpiryDate } from "@/app/api/cotizacion/quote-config"

// Consulta pública de la cotización por su quoteToken (el token es el secreto;
// el cliente lo recibe por WhatsApp). Respuesta limitada a lo que el documento
// muestra — nunca deviceAccessValue, teléfonos, locación ni datos internos.
// 404 genérico si el token no existe: no revelar si es válido o no.
const NO_STORE = { "Cache-Control": "no-store" } as const
const NOT_FOUND = { error: "Cotización no encontrada." }
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 30

// Misma limpieza de reportedIssue que el documento impreso
// (admin/tickets/[tipo]/[id]/quote-ticket-view.tsx).
function parseIssue(raw: string): { service?: string; issue: string } {
  const withoutBudget = raw
    .replace(/presupuesto\s+estimado\s*:?\s*\$?\s*[\d.,]+/gi, "")
    .replace(/\s{2,}/g, " ")

  const legacy = withoutBudget.match(/servicio\s*:\s*(.+?)\s*[—–-]\s*falla\s*:\s*(.+)/i)
  if (legacy) {
    return { service: legacy[1].trim() || undefined, issue: legacy[2].trim() }
  }

  const segments = withoutBudget
    .split("·")
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length >= 2) {
    return { service: segments[0], issue: segments.slice(1).join(" · ") }
  }
  return { service: undefined, issue: segments[0] ?? raw.trim() }
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!checkAndRecord("cotizacion", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Intenta de nuevo en un minuto." },
        { status: 429, headers: NO_STORE },
      )
    }

    const { token } = await params
    const order = await prisma.repairOrder.findUnique({
        where: { quoteToken: token },
        select: {
          number: true,
          businessId: true,
          // Tenant suspendido: el enlace muere igual que un token inválido.
          business: { select: { isActive: true } },
          status: true,
          customerName: true,
          equipmentType: true,
          brand: true,
          model: true,
          equipmentColor: true,
          reportedIssue: true,
          diagnosis: true,
          quoteCents: true,
          approvedQuoteCents: true,
          quoteApprovedAt: true,
          quoteExpiresAt: true,
          createdAt: true,
          parts: {
            where: { status: "APPROVED" },
            orderBy: { createdAt: "asc" },
            select: { description: true, qty: true, unitPriceCents: true },
          },
          events: {
            where: { type: "QUOTE" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      })

    if (!order || !order.business.isActive) return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    // Vigencia real: el documento dice "Válida por 15 días" y la cotización
    // muere con la orden — entregada o cancelada ya no es visible aunque el
    // token siga circulando en un WhatsApp viejo.
    if (order.status === "DELIVERED" || order.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Esta cotización ya no está vigente." },
        { status: 410, headers: NO_STORE },
      )
    }
    // Membrete, largo del folio, vigencia y términos salen del negocio
    // DUEÑO de la orden (quote_validity_days / quote_terms configurables).
    const [businessName, folioDigitsRaw, validityDaysRaw, termsRaw] = await Promise.all([
      getBusinessSetting(order.businessId, "ticket_business_name"),
      getBusinessSetting(order.businessId, ORDER_FOLIO_DIGITS_KEY).catch(() => null),
      getBusinessSetting(order.businessId, "quote_validity_days").catch(() => null),
      getBusinessSetting(order.businessId, "quote_terms").catch(() => null),
    ])
    const validityDays = parseQuoteValidityDays(validityDaysRaw)
    const terms = termsRaw?.trim() || DEFAULT_QUOTE_TERMS
    // Emisión = último QUOTE (o aprobación/creación como respaldo).
    const issuedAt = order.events[0]?.createdAt ?? order.quoteApprovedAt ?? order.createdAt
    // "Válida por N días" se cumple de verdad: la vigencia efectiva es la
    // presentación + los días configurados (quoteExpiresAt guardado recuerda
    // la fecha de presentación, incluidas las renovaciones por re-autorización).
    const expiresAt = quoteExpiryDate(order.quoteExpiresAt, issuedAt, validityDays)
    if (isQuoteExpiredAt(order.quoteExpiresAt, issuedAt, validityDays)) {
      return NextResponse.json(
        { error: "Esta cotización venció." },
        { status: 410, headers: NO_STORE },
      )
    }

    const { service, issue } = parseIssue(order.reportedIssue)
    const laborCents = order.approvedQuoteCents ?? order.quoteCents
    const parts = order.parts.map(part => ({
      description: part.description,
      qty: part.qty,
      unitPriceCents: part.unitPriceCents,
      subtotalCents: part.qty * part.unitPriceCents,
    }))
    // Total de refacciones autorizadas desglosado: es el expectedPartsCents
    // que el cliente debe devolver al POST /approve (anti-TOCTOU).
    const partsCents = parts.reduce((sum, part) => sum + part.subtotalCents, 0)
    const totalCents = (laborCents ?? 0) + partsCents

    return NextResponse.json(
      {
        quote: {
          folio: repairFolio(order.number, parseFolioDigits(folioDigitsRaw)),
          businessName: businessName || "PROSOLUTIONS",
          issuedAt,
          customerName: order.customerName,
          equipment: {
            type: order.equipmentType,
            brand: order.brand,
            model: order.model,
            color: order.equipmentColor,
          },
          service: service ?? null,
          issue,
          diagnosis: order.diagnosis,
          laborCents,
          parts,
          partsCents,
          totalCents,
          status: order.status,
          statusLabel: repairLabels[order.status as RepairStage] ?? order.status,
          quoteApprovedAt: order.quoteApprovedAt,
          // Vigencia efectiva ya calculada con quote_validity_days del
          // negocio, más los términos que el documento imprime al pie.
          quoteExpiresAt: expiresAt,
          validityDays,
          terms,
        },
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error("[cotizacion] Error al consultar la cotización:", error)
    return NextResponse.json(
      { error: "No pudimos consultar la cotización. Intenta más tarde." },
      { status: 500, headers: NO_STORE },
    )
  }
}
