import { prisma } from "@/lib/prisma"

/**
 * Carga la orden por su `quoteToken` — el token es el secreto que el cliente
 * recibe por WhatsApp. Solo selecciona lo que el documento público muestra:
 * jamás deviceAccessValue, teléfonos completos, location ni datos internos de
 * custodia.
 *
 * Compartido por /cotizacion/[token] (global, fallback cuando no hay slug) y
 * /<slug>/cotizacion/[token] (brandeada bajo la vitrina del negocio).
 */
export function loadQuoteByToken(token: string) {
  return prisma.repairOrder.findUnique({
    where: { quoteToken: token },
    select: {
      number: true,
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
      createdAt: true,
      createdBy: { select: { name: true } },
      parts: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "asc" },
        select: { description: true, qty: true, unitPriceCents: true },
      },
      // Fecha de emisión = último presupuesto registrado (QUOTE), no la recepción.
      events: {
        where: { type: "QUOTE" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  })
}

export type PublicQuote = NonNullable<Awaited<ReturnType<typeof loadQuoteByToken>>>
