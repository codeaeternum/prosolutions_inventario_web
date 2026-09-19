import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getBusinessSetting } from "@/lib/settings"
import { ORDER_FOLIO_DIGITS_KEY, parseFolioDigits, repairFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

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
    // "Válida por 15 días" se cumple de verdad: quoteExpiresAt se fija al
    // presentar la cotización (QUOTE) y al pedir re-autorización por una
    // refacción nueva. Vencida, el documento ya no se muestra.
    if (order.quoteExpiresAt && order.quoteExpiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Esta cotización venció." },
        { status: 410, headers: NO_STORE },
      )
    }
    // Membrete y largo del folio salen del negocio DUEÑO de la orden.
    const [businessName, folioDigitsRaw] = await Promise.all([
      getBusinessSetting(order.businessId, "ticket_business_name"),
      getBusinessSetting(order.businessId, ORDER_FOLIO_DIGITS_KEY).catch(() => null),
    ])

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
          issuedAt: order.events[0]?.createdAt ?? order.quoteApprovedAt ?? order.createdAt,
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
          quoteExpiresAt: order.quoteExpiresAt,
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
