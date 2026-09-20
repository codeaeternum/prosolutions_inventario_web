// Desglose por servicio de la cotización — módulo puro (sin Prisma ni Node
// en runtime): lo usan el loader público (lib/public-quote), la API de
// cotización, la cotización impresa (tickets/[tipo]/[id]) y las pruebas.
//
// La orden NO guarda un precio por servicio: `serviceName` es "A + B + …"
// (recepción une los nombres elegidos del catálogo) y `quoteCents` es UN
// solo importe de mano de obra. Para mostrar "Cambio de pantalla — iPhone
// 12: $800.00" por línea, cada nombre se re-resuelve contra el catálogo con
// el contexto del equipo de la orden (modelo exacto > tipo de equipo >
// priceCents base; null = "se cotiza al recibir") — ver lib/service-pricing.

import { resolveServicePrice, type ServicePriceContext, type ServiceWithPrices } from "@/lib/service-pricing"

/**
 * Servicios de la orden en el orden capturado. Recepción los une con " + "
 * (recibir/page.tsx); se trocea por "+" y se recorta espacio — un servicio
 * cuyo nombre contenga "+" saldría como dos líneas, caso ya ambiguo en la
 * captura misma.
 */
export function orderServiceNames(serviceName: string | null | undefined): string[] {
  return (serviceName ?? "").split("+").map(name => name.trim()).filter(Boolean)
}

/**
 * Línea del desglose: `priceCents` es el precio efectivo para el equipo de
 * la orden; null = "se cotiza al recibir" (sin precio aplicable en catálogo
 * o servicio ya inexistente).
 */
export type QuoteServiceLine = { name: string; priceCents: number | null }

/** Servicio del catálogo con nombre; `isActive` desempata duplicados. */
export type NamedService = ServiceWithPrices & { name: string; isActive?: boolean | null }

/**
 * Precio efectivo por servicio para el equipo de la orden. Cada nombre de
 * serviceName se busca por match EXACTO en el catálogo del negocio (así lo
 * escribió recepción); con nombres duplicados gana el servicio activo y, en
 * última instancia, el primero devuelto por la consulta.
 */
export function resolveQuoteServiceLines(
  serviceName: string | null | undefined,
  catalog: readonly NamedService[],
  ctx: ServicePriceContext,
): QuoteServiceLine[] {
  const names = orderServiceNames(serviceName)
  if (names.length === 0) return []
  const byName = new Map<string, NamedService>()
  for (const service of catalog) {
    const previous = byName.get(service.name)
    if (!previous || (previous.isActive === false && service.isActive !== false)) byName.set(service.name, service)
  }
  return names.map(name => {
    const service = byName.get(name)
    return { name, priceCents: service ? resolveServicePrice(service, ctx) : null }
  })
}

/** Suma de las líneas ya resueltas (una sin precio aporta 0 — no "explica" mano de obra). */
export function serviceLinesTotal(lines: readonly QuoteServiceLine[]): number {
  return lines.reduce((sum, line) => sum + (line.priceCents ?? 0), 0)
}

/**
 * ¿El desglose por servicio explica la mano de obra cotizada? Solo cuando
 * TODAS las líneas resuelven precio y su suma es EXACTAMENTE `laborCents`:
 * el total del documento es la cifra que el cliente autoriza (anti-TOCTOU
 * del POST de decisión), así que un desglose que no cuadra con ella cae a la
 * fila agregada de siempre — el importe que el staff capturó gana sobre el
 * catálogo vigente.
 */
export function serviceLinesMatchLabor(lines: readonly QuoteServiceLine[], laborCents: number | null): boolean {
  return laborCents !== null
    && lines.length > 0
    && lines.every(line => line.priceCents !== null)
    && serviceLinesTotal(lines) === laborCents
}

/**
 * Importe sugerido por catálogo cuando TODOS los servicios de la orden
 * resuelven precio para este equipo — la misma regla con que recepción
 * autollenar el presupuesto (uno sin precio → sin sugerencia, se cotiza al
 * recibir). Lo usa la ficha admin para prellenar la acción QUOTE.
 */
export function suggestedServiceLinesTotal(lines: readonly QuoteServiceLine[]): number | null {
  return lines.length > 0 && lines.every(line => line.priceCents !== null)
    ? serviceLinesTotal(lines)
    : null
}
