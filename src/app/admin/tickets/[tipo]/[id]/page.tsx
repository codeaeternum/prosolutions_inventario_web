import { notFound, redirect } from "next/navigation"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getBusinessSettingsMap } from "@/lib/settings"
import prisma from "@/lib/prisma"
import { isValidSlug } from "@/lib/public-slug"
import { formatPrice } from "@/lib/utils"
import { repairFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { TicketPrintView } from "./ticket-print-view"
import { RepairTicketView, type RepairTicketData } from "./repair-ticket-view"
import { WorkshopSheetView, type WorkshopSheetData } from "./workshop-sheet-view"
import { QuoteTicketView, type QuoteTicketData } from "./quote-ticket-view"

export const dynamic = "force-dynamic"

// Etiquetas compartidas por el ticket del cliente y la hoja interna de taller.
const CONDITION_LABELS: Record<string, string> = {
  ENCENDIDO: "Encendido", APAGADO: "Apagado", MOJADO: "Mojado",
  MANIPULADO: "Manipulado", ROTO: "Roto", INCOMPLETO: "Incompleto",
}
const AESTHETICS_LABELS: Record<string, string> = { BUENO: "Bueno", REGULAR: "Regular", MALO: "Malo" }
const METHOD_LABELS: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito" }
const PURPOSE_LABELS: Record<string, string> = { ADVANCE: "Anticipo", ABONO: "Abono", SETTLEMENT: "Liquidación" }
const ACCESS_LABELS: Record<string, string> = { NONE: "Sin bloqueo", PATTERN: "Patrón", PIN: "PIN", PASSWORD: "Contraseña" }
const PART_STATUS_LABELS: Record<string, string> = { REQUESTED: "Solicitada", APPROVED: "Autorizada", REJECTED: "Rechazada" }
const EVENT_LABELS: Record<string, string> = {
  RECEIVED: "Recepción", NOTE: "Nota", QUOTE: "Presupuesto", APPROVE: "Autorización",
  STATUS: "Estado", TRANSFER: "Traspaso", ASSIGN: "Asignación", PART: "Refacción",
  PAYMENT: "Pago", PHOTO: "Evidencia",
}

// La orden se carga igual para el ticket del cliente que para la hoja interna:
// incluye refacciones e historial (la hoja los imprime; el ticket los ignora).
function loadRepairOrder(id: string, businessId: string) {
  return prisma.repairOrder.findUnique({
    where: { id, businessId },
    include: {
      // Slug público del negocio de la orden: QR de rastreo brandeado.
      business: { select: { slug: true, isActive: true } },
      intakeBranch: true,
      currentBranch: true,
      assignedTo: { select: { name: true } },
      createdBy: { select: { name: true } },
      payments: { where: { status: "CONFIRMED" }, orderBy: { createdAt: "asc" } },
      parts: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { name: true } },
          createdBy: { select: { name: true } },
          decidedBy: { select: { name: true } },
        },
      },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
        include: { actor: { select: { name: true } } },
      },
    },
  })
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ tipo: string; id: string }>
}) {
  const adminCheck = await requireAdmin()
  if (adminCheck.error) redirect("/login")
  const businessId = businessIdOf(getSession(adminCheck)!)

  const { tipo, id } = await params
  
  let ticketData: {
    title: string; folio: string; date: string; client?: string; cashier?: string;
    items: { name: string; qty: number; price: number; total: number }[];
    total: number; paymentMethod?: string; notes?: string; newBalance?: number;
    qrCode?: string; businessName?: string; subtitle?: string; footer?: string;
  } | null = null
  let repairData: RepairTicketData | null = null
  let workshopData: WorkshopSheetData | null = null
  let quoteData: QuoteTicketData | null = null

  if (tipo === "venta") {
    // Documento de venta nuevo (Sale con líneas y pagos); fallback al movimiento heredado.
    const saleDoc = await prisma.sale.findUnique({
      where: { id, businessId },
      include: {
        items: { include: { product: true } },
        payments: { orderBy: { createdAt: "asc" } },
        seller: true,
        customer: true,
        branch: true,
      }
    })

    if (saleDoc) {
      const METHOD_LABEL: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito" }
      ticketData = {
        title: saleDoc.status === "VOIDED" ? "VENTA ANULADA" : "TICKET DE VENTA",
        folio: `V-${String(saleDoc.number).padStart(6, "0")}`,
        date: saleDoc.createdAt.toISOString(),
        client: saleDoc.customer?.name,
        items: saleDoc.items.map(item => ({
          name: item.product.name,
          qty: item.quantity,
          price: item.unitPrice,
          total: item.totalPrice,
        })),
        total: saleDoc.total,
        paymentMethod: saleDoc.payments.filter(p => p.amount > 0).map(p => `${METHOD_LABEL[p.method] ?? p.method} ${formatPrice(p.amount)}`).join("\n"),
        notes: saleDoc.branch.name,
        cashier: saleDoc.seller.name,
      }
    } else {
      const sale = await prisma.inventoryMovement.findUnique({
        where: { id, businessId },
        include: {
          product: true,
          user: true, // admin que la hizo
        }
      })

      if (sale) {
        ticketData = {
          title: "TICKET DE VENTA",
          folio: sale.id.slice(-8).toUpperCase(),
          date: sale.createdAt.toISOString(),
          items: [
            {
              name: sale.product.name,
              qty: Math.abs(sale.quantity),
              price: sale.unitPrice || 0,
              total: Math.abs(sale.quantity) * (sale.unitPrice || 0)
            }
          ],
          total: Math.abs(sale.quantity) * (sale.unitPrice || 0),
          notes: sale.notes || "Venta en tienda",
          cashier: sale.user?.name || "Sistema"
        }
      }
    }
  } else if (tipo === "reserva") {
    // Buscar reserva completada
    const res = await prisma.reservation.findUnique({
      where: { id, businessId },
      include: {
        product: true,
        user: true
      }
    })

    if (res) {
      const qrUrl = `${process.env.NEXTAUTH_URL || 'https://prosolutions.ascnex.com'}/verificar/${res.qrCode || res.id}`
      ticketData = {
        title: "TICKET DE RESERVA / ENTREGA",
        folio: res.id.slice(-8).toUpperCase(),
        date: res.createdAt.toISOString(),
        client: res.user.name,
        items: [
          {
            name: res.product.name,
            qty: res.quantity,
            price: res.totalPrice / res.quantity,
            total: res.totalPrice
          }
        ],
        total: res.totalPrice,
        paymentMethod: res.paymentMethod || "Efectivo",
        qrCode: qrUrl,
      }
    }
  } else if (tipo === "abono") {
    // Buscar movimiento de crédito
    const mov = await prisma.creditMovement.findUnique({
      where: { id, businessId },
      include: { user: true }
    })

    if (!mov || mov.type !== "PAYMENT") notFound()
    if (mov) {
      ticketData = {
        title: "COMPROBANTE DE ABONO",
        folio: mov.id.slice(-8).toUpperCase(),
        date: mov.createdAt.toISOString(),
        client: mov.user.name,
        items: [
          {
            name: "Abono a cuenta de crédito",
            qty: 1,
            price: mov.amount,
            total: mov.amount
          }
        ],
        total: mov.amount,
        notes: mov.notes || "",
        newBalance: mov.user.creditBalance || 0
      }
    }
  } else if (tipo === "reparacion" || tipo === "taller" || tipo === "cotizacion") {
    // reparacion = comprobante del cliente: NUNCA imprime deviceAccessType ni
    // deviceAccessValue (datos de desbloqueo del cliente).
    // taller = hoja de servicio interna: sí los imprime, junto con costos,
    // refacciones e historial; es el documento de trabajo del técnico.
    // cotizacion = documento formal para el cliente con el desglose del
    // presupuesto y las refacciones autorizadas.
    const order = await loadRepairOrder(id, businessId)

    if (order) {
      const conditions = (order.functionalConditions ?? "")
        .split(",")
        .map(c => CONDITION_LABELS[c.trim()] ?? c.trim())
        .filter(Boolean)
        .join(", ")
      const quotedCents = order.approvedQuoteCents ?? order.quoteCents
      const paidCents = Math.round(order.payments.reduce((sum, p) => sum + p.amount, 0) * 100)
      const folio = repairFolio(order.number)
      const base = (process.env.NEXTAUTH_URL || "https://prosolutions.ascnex.com").replace(/\/+$/, "")
      // URL pública /evidencia/<uploadToken>: la usa el TÉCNICO para subir
      // fotos; solo va en documentos internos (hoja de taller / etiqueta),
      // nunca en el ticket ni la cotización que recibe el cliente.
      const evidenceUrl = order.uploadToken ? `${base}/evidencia/${order.uploadToken}` : undefined

      if (tipo === "reparacion") {
        // QR de rastreo brandeado: con Business.slug activo apunta a la
        // vitrina /<slug>/order-status; sin slug cae al /seguimiento global.
        // En ambos casos el folio y los últimos 4 dígitos del teléfono van
        // prellenados (?folio=…&t=…): el cliente solo toca "Consultar".
        const businessSlug = order.business.isActive ? order.business.slug : ""
        const trackingSlug = isValidSlug(businessSlug) ? businessSlug : ""
        const phone4 = order.customerPhone.replace(/\D/g, "").slice(-4)
        const trackingQuery = `folio=${encodeURIComponent(folio)}${phone4 ? `&t=${phone4}` : ""}`
        const trackingUrl = trackingSlug
          ? `${base}/${trackingSlug}/order-status?${trackingQuery}`
          : `${base}/seguimiento?${trackingQuery}`

        repairData = {
          title: "COMPROBANTE DE RECEPCIÓN",
          folio,
          date: order.createdAt.toISOString(),
          client: order.customerName,
          clientPhoneAlt: order.customerPhoneAlt ?? undefined,
          branch: order.intakeBranch.name,
          receivedBy: order.createdBy.name,
          promisedAt: order.promisedAt?.toISOString(),
          equipment: [
            { label: "Tipo", value: order.equipmentType },
            { label: "Marca / Modelo", value: [order.brand, order.model].filter(Boolean).join(" ") },
            { label: "Serie / IMEI", value: order.serialNumber ?? "" },
            { label: "Color", value: order.equipmentColor ?? "" },
            { label: "Accesorios", value: order.accessories ?? "" },
            { label: "Estado físico", value: order.intakeCondition ?? "" },
            { label: "Condiciones", value: conditions },
            { label: "Estética", value: order.aesthetics ? (AESTHETICS_LABELS[order.aesthetics] ?? order.aesthetics) : "" },
            // Referencia de custodia interna: solo se imprime si existe.
            { label: "Ubicación", value: order.location ?? "" },
          ].filter(row => row.value !== ""),
          issue: order.reportedIssue,
          payments: order.payments.map(p => ({
            label: PURPOSE_LABELS[p.purpose ?? ""] ?? "Pago",
            amount: p.amount,
            method: METHOD_LABELS[p.method] ?? p.method,
          })),
          // Si un presupuesto autorizado distinto ya reemplazó al estimado, el
          // estimado original aún se imprime aparte para aclarar el total.
          estimatedQuote: order.quoteCents != null && order.quoteCents !== quotedCents ? order.quoteCents / 100 : undefined,
          quote: quotedCents != null ? quotedCents / 100 : undefined,
          balance: quotedCents != null ? Math.max(0, quotedCents - paidCents) / 100 : undefined,
          qrCode: trackingUrl,
          trackingHint: "Escanea para rastrear tu reparación",
          // Firma capturada en recepción (PNG base64).
          signatureData: order.signatureData ?? undefined,
        }
      } else if (tipo === "cotizacion") {
        quoteData = {
          folio,
          issuedAt: (order.quoteApprovedAt ?? order.createdAt).toISOString(),
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerPhoneAlt: order.customerPhoneAlt ?? undefined,
          equipment: [
            { label: "Tipo", value: order.equipmentType },
            { label: "Marca", value: order.brand ?? "" },
            { label: "Modelo", value: order.model ?? "" },
            { label: "Color", value: order.equipmentColor ?? "" },
          ].filter(row => row.value !== ""),
          issue: order.reportedIssue,
          diagnosis: order.diagnosis ?? undefined,
          serviceAmount: quotedCents != null ? quotedCents / 100 : undefined,
          // Solo refacciones autorizadas: las solicitadas/rechazadas no se
          // cotizan al cliente.
          parts: order.parts
            .filter(part => part.status === "APPROVED")
            .map(part => ({
              description: part.description,
              qty: part.qty,
              unitPrice: part.unitPriceCents / 100,
              subtotal: (part.qty * part.unitPriceCents) / 100,
            })),
          elaboratedBy: order.createdBy.name,
        }
      } else {
        workshopData = {
          folio,
          status: repairLabels[order.status as RepairStage] ?? order.status,
          receivedAt: order.createdAt.toISOString(),
          scheduledAt: order.scheduledAt?.toISOString(),
          promisedAt: order.promisedAt?.toISOString(),
          intakeBranch: order.intakeBranch.name,
          currentBranch: order.currentBranch.name,
          assignedTo: order.assignedTo?.name ?? undefined,
          receivedBy: order.createdBy.name,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerPhoneAlt: order.customerPhoneAlt ?? undefined,
          equipment: [
            { label: "Tipo", value: order.equipmentType },
            { label: "Marca", value: order.brand ?? "" },
            { label: "Modelo", value: order.model ?? "" },
            { label: "Serie / IMEI", value: order.serialNumber ?? "" },
            { label: "Color", value: order.equipmentColor ?? "" },
            { label: "Accesorios", value: order.accessories ?? "" },
            { label: "Estado físico", value: order.intakeCondition ?? "" },
            { label: "Condiciones", value: conditions },
            { label: "Estética", value: order.aesthetics ? (AESTHETICS_LABELS[order.aesthetics] ?? order.aesthetics) : "" },
            { label: "Ubicación física", value: order.location ?? "" },
          ].filter(row => row.value !== ""),
          accessType: order.deviceAccessType ?? undefined,
          accessTypeLabel: order.deviceAccessType ? (ACCESS_LABELS[order.deviceAccessType] ?? order.deviceAccessType) : undefined,
          accessValue: order.deviceAccessValue ?? undefined,
          issue: order.reportedIssue,
          diagnosis: order.diagnosis ?? undefined,
          qualityCheck: order.qualityCheck ?? undefined,
          deliveredTo: order.deliveredTo ?? undefined,
          quote: order.quoteCents != null ? order.quoteCents / 100 : undefined,
          approvedQuote: order.approvedQuoteCents != null ? order.approvedQuoteCents / 100 : undefined,
          quoteApprovedAt: order.quoteApprovedAt?.toISOString(),
          parts: order.parts.map(part => ({
            description: part.description,
            productName: part.product?.name ?? undefined,
            qty: part.qty,
            cost: part.unitCostCents / 100,
            price: part.unitPriceCents / 100,
            statusLabel: PART_STATUS_LABELS[part.status] ?? part.status,
            requestedBy: part.createdBy.name,
            decidedBy: part.decidedBy?.name ?? undefined,
            decisionNote: part.decisionNote ?? undefined,
          })),
          payments: order.payments.map(p => ({
            label: PURPOSE_LABELS[p.purpose ?? ""] ?? "Pago",
            amount: p.amount,
            method: METHOD_LABELS[p.method] ?? p.method,
            date: p.createdAt.toISOString(),
          })),
          paidTotal: paidCents / 100,
          balance: quotedCents != null ? Math.max(0, quotedCents - paidCents) / 100 : undefined,
          events: order.events.map(event => ({
            date: event.createdAt.toISOString(),
            typeLabel: EVENT_LABELS[event.type] ?? event.type,
            detail: event.detail,
            actor: event.actor.name,
          })),
          // QR de evidencias: va en la hoja interna y en la etiqueta del equipo.
          evidenceUrl,
        }
      }
    }
  }

  if (!ticketData && !repairData && !workshopData && !quoteData) {
    return <div className="p-8 text-center text-red-500">Ticket no encontrado</div>
  }

  // Load ticket customization settings
  const ticketSettings = await getBusinessSettingsMap(businessId, ["ticket_business_name", "ticket_subtitle", "ticket_footer"])

  const businessName = ticketSettings.get("ticket_business_name") || "PROSOLUTIONS"
  const subtitle = ticketSettings.get("ticket_subtitle") || "Venta de refacciones y\nReparación profesional"
  const footer = ticketSettings.get("ticket_footer") || "¡Gracias por tu preferencia!"

  if (workshopData) {
    return <WorkshopSheetView data={{ ...workshopData, businessName }} />
  }

  if (quoteData) {
    return <QuoteTicketView data={{ ...quoteData, businessName }} />
  }

  if (repairData) {
    return <RepairTicketView data={{ ...repairData, businessName, subtitle, footer }} />
  }

  if (ticketData) {
    ticketData.businessName = businessName
    ticketData.subtitle = subtitle
    ticketData.footer = footer
    return <TicketPrintView data={ticketData} />
  }
}
