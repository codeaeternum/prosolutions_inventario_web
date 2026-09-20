import { prisma } from "@/lib/prisma"
import { orderServiceNames, resolveQuoteServiceLines, type QuoteServiceLine } from "@/lib/quote-services"

/**
 * Desglose por servicio de la orden contra el catálogo del negocio dueño.
 * La orden no guarda snapshot por servicio (serviceName es texto y
 * quoteCents un importe único de mano de obra): cada nombre se re-resuelve
 * al mostrar con el contexto del equipo — deviceModelId recuperado por
 * brand+model del catálogo de modelos > equipmentType > precio base.
 */
export async function loadQuoteServiceLines(order: {
  businessId: string
  serviceName: string | null
  equipmentType: string
  brand: string | null
  model: string | null
}): Promise<QuoteServiceLine[]> {
  const names = orderServiceNames(order.serviceName)
  if (names.length === 0) return []
  const brand = order.brand?.trim()
  const model = order.model?.trim()
  const [services, models] = await Promise.all([
    // Se incluyen servicios inactivos: la cotización describe lo elegido al
    // recibir aunque el servicio se haya desactivado después; el desempate
    // por nombre duplicado está en resolveQuoteServiceLines.
    prisma.workshopService.findMany({
      where: { businessId: order.businessId, name: { in: names } },
      select: {
        name: true,
        isActive: true,
        priceCents: true,
        prices: { select: { deviceModelId: true, equipmentType: true, priceCents: true } },
      },
    }),
    // El equipo quedó ligado al catálogo por texto (brand + model, escritos
    // desde la fila elegida en recepción): con ambos se recupera el
    // deviceModelId para el alcance de modelo exacto. Misma regla que
    // /api/device-models — visible = global (null) + privado del tenant, y
    // si marca+modelo existe en ambos scopes gana la fila del tenant.
    brand && model
      ? prisma.deviceModel.findMany({
          where: { brand, model, OR: [{ businessId: null }, { businessId: order.businessId }] },
          select: { id: true, businessId: true },
          take: 4,
        })
      : Promise.resolve([]),
  ])
  const deviceModelId = (models.find(row => row.businessId === order.businessId) ?? models[0])?.id ?? null
  return resolveQuoteServiceLines(order.serviceName, services, { deviceModelId, equipmentType: order.equipmentType })
}

/**
 * Carga la orden por su `quoteToken` — el token es el secreto que el cliente
 * recibe por WhatsApp. Solo selecciona lo que el documento público muestra:
 * jamás deviceAccessValue, teléfonos completos, location ni datos internos de
 * custodia.
 *
 * Compartido por /cotizacion/[token] (global, fallback cuando no hay slug) y
 * /<slug>/cotizacion/[token] (brandeada bajo la vitrina del negocio).
 */
export async function loadQuoteByToken(token: string, businessId?: string) {
  const order = await prisma.repairOrder.findUnique({
    // Con businessId la página brandeada nunca muestra una cotización de otro
    // negocio: un token ajeno bajo /<slug>/ responde como no encontrada.
    where: { quoteToken: token, ...(businessId ? { businessId } : {}) },
    select: {
      businessId: true,
      number: true,
      status: true,
      customerName: true,
      equipmentType: true,
      brand: true,
      model: true,
      equipmentColor: true,
      reportedIssue: true,
      // Servicios del catálogo elegidos en recepción ("A + B"): base del
      // desglose por servicio con precio del equipo (ver serviceLines).
      serviceName: true,
      diagnosis: true,
      quoteCents: true,
      approvedQuoteCents: true,
      quoteApprovedAt: true,
      // Vigencia del documento ("Válida por 15 días"): la página brandeada y
      // la global muestran estado vencido en vez del desglose cuando pasó.
      quoteExpiresAt: true,
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
  if (!order) return null
  // Un fallo del lookup de catálogo no debe tumbar el documento: sin líneas
  // el desglose muestra la fila agregada de mano de obra como siempre.
  const serviceLines = await loadQuoteServiceLines(order).catch(() => [])
  return { ...order, serviceLines }
}

export type PublicQuote = NonNullable<Awaited<ReturnType<typeof loadQuoteByToken>>>
