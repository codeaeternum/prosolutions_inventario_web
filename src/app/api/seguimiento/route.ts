import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { repairFolio } from "@/lib/workshop-labels"
import { orderTotalCents, orderHeldCents } from "@/lib/workshop-money"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

// Rastreo público de órdenes de reparación. Sin sesión: la identidad se prueba
// con folio + últimos 4 dígitos del teléfono para no exponer datos a cualquiera
// que adivine un folio consecutivo.
//
// Rate limit en memoria por IP (20 req/min). Es un proceso único: si el
// despliegue escala a multi-instancia hace falta un limiter compartido.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 20

const NOT_FOUND = { error: "No encontramos una orden con esos datos." }
const NO_STORE = { "Cache-Control": "no-store" } as const

const onlyDigits = (value: string) => value.replace(/\D/g, "")

// El detalle de cada evento lo escribe el personal: antes de exponerlo se
// eliminan montos (el presupuesto aún no es público), nombres internos y la
// locación física del equipo (dato de custodia interno).
function publicDetail(detail: string): string {
  return detail
    .replace(/Presupuesto\s+[\d.,]+\s*MXN\.?/i, "Presupuesto registrado.")
    .replace(/Autorización registrada por el operador para\s+[\d.,]+\s*MXN\.?/i, "Presupuesto autorizado.")
    .replace(/Responsable:\s*[^.\n]+\.?/i, "Técnico asignado.")
    // El detalle de entrega interno lleva "Entrega a: <nombre del receptor>".
    .replace(/Entrega a:\s*[^.\n]+\.?/i, "Entrega registrada.")
    .replace(/,?\s*locación\s+[^.,\n]+/gi, "")
    .replace(/\$?\s*\d[\d,]*(\.\d{1,2})?\s*MXN/gi, "")
    .replace(/\$\s*\d[\d,]*(\.\d{1,2})?/g, "")
    // Tras el saneado, lo público termina en la primera frase: transiciones
    // "X → Y." y las frases de presupuesto — lo que sigue es nota interna del
    // staff (diagnóstico, comentarios) que no debe verse en seguimiento.
    .replace(/^([^.\n]*→[^.\n]*)\.[\s\S]*$/, "$1.")
    .replace(/^(Presupuesto (?:registrado|autorizado|estimado en recepción:?)\.?)[\s\S]*$/i, "$1")
    .replace(/ {2,}/g, " ")
    .trim()
}

// reportedIssue puede arrastrar "presupuesto estimado: $X" capturado en
// recepción (mismo caso que /api/cotizacion/[token]): el estimado no es un
// monto autorizado y no debe mostrarse al cliente.
function publicIssue(raw: string): string {
  return raw
    .replace(/presupuesto\s+estimado\s*:?\s*\$?\s*[\d.,]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export async function GET(req: Request) {
  try {
    if (!checkAndRecord("seguimiento", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Intenta de nuevo en un minuto." },
        { status: 429, headers: NO_STORE },
      )
    }

    const query = new URL(req.url).searchParams
    // Mismo formato que /api/workshop: acepta "OT-000001", "000001" o "1".
    const folioMatch = /^(?:OT-)?0*(\d+)$/i.exec((query.get("folio") ?? "").trim())
    const number = folioMatch ? Number(folioMatch[1]) : NaN
    // Últimos 4 dígitos del teléfono registrado — obligatorio.
    const phone4 = onlyDigits((query.get("phone") ?? "").trim())

    if (!Number.isSafeInteger(number) || number > 2147483647 || !/^\d{4}$/.test(phone4)) {
      return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    }

    const order = await prisma.repairOrder.findUnique({
      where: { number },
        include: {
          currentBranch: { select: { name: true } },
          events: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 100,
            select: { id: true, type: true, detail: true, isPublic: true, createdAt: true },
          },
          // Evidencias: se sirven por /api/evidence?id= (cuid no adivinable).
          photos: {
            orderBy: { createdAt: "asc" },
            select: { id: true, label: true, createdAt: true },
          },
          // Abonos que el cliente conoce (CONFIRMED) menos reembolsos
          // (REFUNDED, amount negativo): lo retenido por el negocio, sirve
          // para mostrar el saldo que restaría al recoger el equipo.
          payments: {
            where: { status: { in: ["CONFIRMED", "REFUNDED"] } },
            select: { amount: true, status: true },
          },
          // Refacciones autorizadas: se cobran además de la mano de obra.
          parts: {
            where: { status: "APPROVED" },
            select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true },
          },
          // Branding del negocio dueño de la orden (encabezado + CTA WhatsApp)
          // e isActive: un tenant suspendido no sirve seguimiento.
          business: { select: { name: true, phone: true, isActive: true } },
        },
      })

    // Respuesta genérica: no revelar si falló el folio, el teléfono o si el
    // negocio está suspendido.
    if (!order || !order.business.isActive || !onlyDigits(order.customerPhone).endsWith(phone4)) {
      return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    }

    const businessName = order.business?.name?.trim() || null
    const whatsappPhone = order.business?.phone?.trim() || null
    const paidCents = orderHeldCents(order.payments)

    // Solo datos que el propio cliente ya conoce o puede ver en mostrador.
    // Nunca: nombre/teléfono completo, presupuesto sin autorizar (quoteCents),
    // IDs internos, location, aesthetics ni functionalConditions (custodia
    // interna). Solo salen eventos isPublic: notas que el taller marcó para
    // el cliente y mensajes públicos del flujo (listo, aprobada, rechazada);
    // el resto es bitácora interna. quoteToken solo se expone mientras la
    // orden espera la autorización del cliente — es justo cuando el enlace le sirve.
    return NextResponse.json(
      {
        order: {
          folio: repairFolio(order.number),
          status: order.status,
          equipmentType: order.equipmentType,
          brand: order.brand,
          model: order.model,
          reportedIssue: publicIssue(order.reportedIssue),
          serviceName: order.serviceName,
          promisedAt: order.promisedAt,
          createdAt: order.createdAt,
          branch: order.currentBranch.name,
          // Monto que el cliente YA autorizó (mano de obra autorizada +
          // refacciones aprobadas; en cierre sin reparación el cargo de
          // diagnóstico) y lo que ha abonado: con ambos sabe cuánto pagaría
          // al recoger. Sin autorización registrada no se expone el estimado.
          authorizedCents: order.approvedQuoteCents === null ? null : orderTotalCents(order, order.parts),
          paidCents,
          quoteToken: order.status === "WAITING_APPROVAL" ? order.quoteToken : null,
          photos: order.photos,
          // Whitelist estricta: SOLO eventos marcados isPublic por el dominio.
          // El filtro anterior (type ≠ NOTE) filtraba por tipo y publicaba
          // detalles de texto libre del staff — nombre de quien recibe la
          // entrega, niveles de stock, locación interna. publicDetail queda
          // como segunda capa de saneado sobre lo ya autorizado.
          events: order.events
            .filter(e => e.isPublic)
            .map(e => ({
              id: e.id,
              detail: publicDetail(e.detail),
              createdAt: e.createdAt,
              kind: e.type === "NOTE" ? ("MESSAGE" as const) : ("EVENT" as const),
            })),
        },
        business: { name: businessName, phone: whatsappPhone },
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error("[seguimiento] Error al consultar la orden:", error)
    return NextResponse.json(
      { error: "No pudimos consultar la orden. Intenta más tarde." },
      { status: 500, headers: NO_STORE },
    )
  }
}
