import { notFound, redirect } from "next/navigation"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { hasModule } from "@/lib/access"
import { businessIdOf } from "@/lib/tenant"
import { getBusinessSetting, getBusinessSettingsMap, getOrderFolioDigits } from "@/lib/settings"
import { parseQuoteValidityDays, DEFAULT_QUOTE_TERMS } from "@/app/api/cotizacion/quote-config"
import prisma from "@/lib/prisma"
import { isValidSlug } from "@/lib/public-slug"
import { formatPrice } from "@/lib/utils"
import { formatFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { loadQuoteServiceLines } from "@/lib/public-quote"
import { approvedPartsTotal, orderBalanceCents, orderHeldCents, orderTotalCents } from "@/lib/workshop-money"
import { decryptAccessValue } from "@/lib/device-secret"
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
const PURPOSE_LABELS: Record<string, string> = { ADVANCE: "Anticipo", ABONO: "Abono", SETTLEMENT: "Liquidación", REFUND: "Devolución" }
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
      // Quién del staff entregó el equipo (auditoría de mostrador).
      deliveredBy: { select: { name: true } },
      // CONFIRMED suman y REFUNDED (reembolsos, amount negativo) restan:
      // es la convención de orderHeldCents — ambas filas se imprimen.
      payments: { where: { status: { in: ["CONFIRMED", "REFUNDED"] } }, orderBy: { createdAt: "asc" } },
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
  searchParams,
}: {
  params: Promise<{ tipo: string; id: string }>
  // ?copias=N imprime el ticket N veces seguidas (1–4) con línea de corte:
  // la copia extra lleva el encabezado "COPIA — CAJA" (p. ej. pago con
  // tarjeta, donde el comprobante duplicado queda en el negocio).
  searchParams?: Promise<{ copias?: string }>
}) {
  // Staff (admin|empleado): el mostrador imprime tickets de recepción, venta,
  // reserva y abono. Todas las consultas resuelven por id + businessId.
  const staffCheck = await requireAdminOrEmployee()
  if (staffCheck.error) redirect("/login")
  const session = getSession(staffCheck)!
  const businessId = businessIdOf(session)

  const [{ tipo, id }, query] = await Promise.all([params, searchParams ?? Promise.resolve({ copias: undefined as string | undefined })])
  const copies = Math.min(4, Math.max(1, Number.parseInt(query.copias ?? "1", 10) || 1))

  let ticketData: {
    title: string; folio: string; date: string; client?: string; clientLabel?: string;
    cashier?: string; badge?: string;
    items: { name: string; qty: number; price: number; total: number }[];
    total: number; paymentMethod?: string; notes?: string; newBalance?: number;
    discount?: number; discountReason?: string;
    qrCode?: string; businessName?: string; subtitle?: string; footer?: string;
    copies?: number;
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
      // Nota de venta a taller (SaleKind.WORKSHOP): otro encabezado, folio NT-,
      // sello de precio taller y el cliente se identifica por su negocio.
      const isWorkshop = saleDoc.kind === "WORKSHOP"
      const isQuote = saleDoc.kind === "QUOTE"
      const isLayaway = saleDoc.kind === "LAYAWAY"
      const isLive = saleDoc.status === "DRAFT" || saleDoc.status === "OPEN"
      const paid = saleDoc.payments.filter(p => p.status === "CONFIRMED").reduce((sum, p) => sum + p.amount, 0)
      const balance = Math.max(0, saleDoc.total - paid)
      // Descuento autorizado al cobrar: el ticket imprime el desglose y el
      // TOTAL pasa a ser lo realmente cobrado (catálogo − descuento).
      const discount = (saleDoc.discountCents ?? 0) / 100
      const title = saleDoc.status === "VOIDED"
        ? (isWorkshop ? "NOTA DE VENTA A TALLER ANULADA" : isLayaway ? "APARTADO CANCELADO" : isQuote ? "COTIZACIÓN ANULADA" : "VENTA ANULADA")
        : isQuote ? "COTIZACIÓN"
          : isLayaway ? "APARTADO"
            : isWorkshop ? "NOTA DE VENTA A TALLER"
              : saleDoc.status === "DRAFT" ? "VENTA SUSPENDIDA" : "TICKET DE VENTA"
      const folioPrefix = isQuote ? "C" : isLayaway ? "A" : isWorkshop ? "NT" : "V"
      ticketData = {
        title,
        folio: `${folioPrefix}-${String(saleDoc.number).padStart(6, "0")}`,
        date: saleDoc.createdAt.toISOString(),
        client: isWorkshop
          ? (saleDoc.customer?.businessName ?? saleDoc.customer?.name)
          : saleDoc.customer?.name,
        clientLabel: isWorkshop && saleDoc.customer ? "Taller/Negocio" : undefined,
        badge: isWorkshop ? "Documento para taller — precio de taller"
          : isQuote && saleDoc.expiresAt ? `Vigente hasta ${new Date(saleDoc.expiresAt).toLocaleDateString("es-MX")}`
            : isLayaway && balance > 0 ? `Saldo pendiente: ${formatPrice(balance)}`
              : undefined,
        items: saleDoc.items.map(item => ({
          name: item.product.name,
          qty: item.quantity,
          price: item.unitPrice,
          total: item.totalPrice,
        })),
        total: saleDoc.total - discount,
        discount: discount > 0 ? discount : undefined,
        discountReason: saleDoc.discountReason ?? undefined,
        paymentMethod: isLive
          ? (isLayaway && paid > 0 ? `Anticipos: ${formatPrice(paid)}` : "")
          : saleDoc.payments.filter(p => p.amount > 0).map(p => `${METHOD_LABEL[p.method] ?? p.method} ${formatPrice(p.amount)}`).join("\n"),
        notes: [saleDoc.note, saleDoc.branch.name].filter(Boolean).join("\n"),
        cashier: saleDoc.seller.name,
        // Doble copia (cliente + caja) cuando el mostrador lo pidió
        // (?copias=2 — ventas con tarjeta abren el ticket así).
        copies: copies > 1 ? copies : undefined,
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
      const qrUrl = `${process.env.NEXTAUTH_URL || 'https://reficio.app'}/verificar/${res.qrCode || res.id}`
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
    // Documentos del taller: mismo gate que /api/workshop — el staff necesita
    // el módulo asignado (venta/reserva/abono quedan para todo el staff).
    if (!hasModule(session.user, "taller")) notFound()
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
      // Dinero de la orden — única fuente de verdad (src/lib/workshop-money):
      // mano de obra y refacciones autorizadas se imprimen por separado y el
      // total/saldo las suma; en cierres sin reparación solo hay diagnóstico.
      const laborCents = order.approvedQuoteCents ?? order.quoteCents
      const partsPriceCents = approvedPartsTotal(order.parts).priceCents
      const totalCents = orderTotalCents(order, order.parts)
      const paidCents = orderHeldCents(order.payments)
      const balanceCents = orderBalanceCents(order, order.parts, order.payments)
      const isTerminalNoRepair = order.status === "NOT_AUTHORIZED" || order.status === "NOT_REPAIRED"
      // Prefijo y largo del folio configurables por negocio (order_prefix,
      // p. ej. "PS", y order_folio_digits, 4–8 dígitos de consecutivo).
      const [orderPrefix, folioDigits, docSettings] = await Promise.all([
        getBusinessSetting(businessId, "order_prefix"),
        getOrderFolioDigits(businessId),
        getBusinessSettingsMap(businessId, [
          "repair_signature_mode",
          "label_show_problem", "label_show_access",
          "quote_validity_days", "quote_terms",
        ]),
      ])
      // Firma en recepción: canvas (digital), ticket (línea impresa) o pin
      // (confirmación por terminación telefónica). Default canvas.
      const signatureModeRaw = docSettings.get("repair_signature_mode")
      const signatureMode = signatureModeRaw === "ticket" || signatureModeRaw === "pin" ? signatureModeRaw : "canvas"
      // Etiqueta del equipo: los toggles apagan la falla y el desbloqueo.
      const labelShowProblem = docSettings.get("label_show_problem") !== "false"
      const labelShowAccess = docSettings.get("label_show_access") !== "false"
      // Cotización impresa: vigencia y términos configurables del negocio.
      const quoteValidityDays = parseQuoteValidityDays(docSettings.get("quote_validity_days"))
      const quoteTerms = docSettings.get("quote_terms") || DEFAULT_QUOTE_TERMS
      const folio = formatFolio(orderPrefix, order.number, folioDigits)
      const base = (process.env.NEXTAUTH_URL || "https://reficio.app").replace(/\/+$/, "")
      // URL pública /evidencia/<uploadToken>: la usa el TÉCNICO para subir
      // fotos; solo va en documentos internos (hoja de taller / etiqueta),
      // nunca en el ticket ni la cotización que recibe el cliente.
      const evidenceUrl = order.uploadToken ? `${base}/evidencia/${order.uploadToken}` : undefined
      // En orden cerrada el QR impreso ya no sirve: la ruta rechaza la
      // subida en estos estados y el cierre rota el token — la hoja/etiqueta
      // muestra el aviso "link desactivado" en vez de un QR muerto.
      const evidenceLinkDisabled = Boolean(evidenceUrl) && ["DELIVERED", "CANCELLED", "NOT_AUTHORIZED", "NOT_REPAIRED"].includes(order.status)
      // No hay deliveredAt dedicado en la orden: la fecha exacta de entrega la
      // conserva el evento público "→ Entregado" (updatedAt cambiaría con una
      // garantía o un reembolso posterior).
      const deliveredAt = order.events.find(event => event.type === "STATUS" && event.detail.includes("Entrega registrada"))?.createdAt.toISOString()

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
            { label: "Servicio", value: order.serviceName ?? "" },
            // Referencia de custodia interna: solo se imprime si existe.
            { label: "Ubicación", value: order.location ?? "" },
          ].filter(row => row.value !== ""),
          issue: order.reportedIssue,
          payments: order.payments.map(p => ({
            label: PURPOSE_LABELS[p.purpose ?? ""] ?? "Pago",
            amount: p.amount,
            method: METHOD_LABELS[p.method] ?? p.method,
          })),
          // Si una mano de obra autorizada distinta ya reemplazó al estimado,
          // el estimado original aún se imprime aparte para aclarar el total.
          estimatedQuote: order.quoteCents != null && order.quoteCents !== laborCents ? order.quoteCents / 100 : undefined,
          laborQuote: !isTerminalNoRepair && laborCents != null ? laborCents / 100 : undefined,
          partsTotal: !isTerminalNoRepair && partsPriceCents > 0 ? partsPriceCents / 100 : undefined,
          diagnosticFee: isTerminalNoRepair ? (order.diagnosticFeeCents ?? 0) / 100 : undefined,
          totalOrder: totalCents / 100,
          balance: balanceCents / 100,
          qrCode: trackingUrl,
          trackingHint: "Escanea para rastrear tu reparación",
          // Firma capturada en recepción (PNG base64).
          signatureData: order.signatureData ?? undefined,
          // Modo de firma configurado: en "ticket" el comprobante imprime la
          // línea "Firma del cliente" aunque no haya signatureData.
          signatureMode,
          // Constancia de entrega: quién recogió el equipo (puede no ser el
          // titular), su identificación, su firma y quién del staff entregó.
          deliveredTo: order.deliveredTo ?? undefined,
          deliveredToDoc: order.deliveredToDoc ?? undefined,
          deliverySignatureData: order.deliverySignatureData ?? undefined,
          deliveredBy: order.deliveredBy?.name ?? undefined,
          deliveredAt,
          // Ciclo de garantía vigente: presente solo mientras la orden está
          // reingresada por garantía (warrantyUntil se limpia al entregar).
          warrantyUntil: order.warrantyUntil?.toISOString(),
          warrantyCount: order.warrantyCount,
        }
      } else if (tipo === "cotizacion") {
        // Desglose por servicio con el precio del equipo de la orden — mismo
        // criterio que la cotización pública (catálogo vigente del negocio;
        // un fallo del lookup deja la fila agregada de siempre).
        const serviceLines = await loadQuoteServiceLines(order).catch(() => [])
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
            { label: "Servicio", value: order.serviceName ?? "" },
          ].filter(row => row.value !== ""),
          issue: order.reportedIssue,
          diagnosis: order.diagnosis ?? undefined,
          serviceAmount: laborCents != null ? laborCents / 100 : undefined,
          serviceLines,
          deviceLabel: [order.brand, order.model].filter(Boolean).join(" ") || undefined,
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
          // Vigencia y términos configurables (quote_validity_days,
          // quote_terms) — mismos valores que la cotización pública.
          validityDays: quoteValidityDays,
          terms: quoteTerms,
        }
      } else {
        // La hoja interna es el único documento que imprime el desbloqueo:
        // verlo deja rastro en la bitácora, igual que el ?reveal=1 de la
        // ficha en línea (evento interno, nunca público). Solo ADMIN lo ve —
        // la hoja del empleado sale sin el código. Valor ilegible por clave
        // rotada o corrupción: igual se omite.
        let accessValue: string | undefined
        if (order.deviceAccessValue && session.user.role === "ADMIN") {
          try { accessValue = decryptAccessValue(order.deviceAccessValue) } catch { accessValue = undefined }
          await prisma.repairEvent.create({ data: { businessId, actorId: session.user.id, orderId: order.id, type: "NOTE", detail: "Vio el desbloqueo en la hoja de taller", isPublic: false } })
        }
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
            { label: "Servicio", value: order.serviceName ?? "" },
            { label: "Ubicación física", value: order.location ?? "" },
          ].filter(row => row.value !== ""),
          accessType: order.deviceAccessType ?? undefined,
          accessTypeLabel: order.deviceAccessType ? (ACCESS_LABELS[order.deviceAccessType] ?? order.deviceAccessType) : undefined,
          accessValue,
          issue: order.reportedIssue,
          diagnosis: order.diagnosis ?? undefined,
          qualityCheck: order.qualityCheck ?? undefined,
          deliveredTo: order.deliveredTo ?? undefined,
          deliveredToDoc: order.deliveredToDoc ?? undefined,
          deliverySignatureData: order.deliverySignatureData ?? undefined,
          deliveredBy: order.deliveredBy?.name ?? undefined,
          deliveredAt,
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
          partsTotal: !isTerminalNoRepair && partsPriceCents > 0 ? partsPriceCents / 100 : undefined,
          diagnosticFee: isTerminalNoRepair ? (order.diagnosticFeeCents ?? 0) / 100 : undefined,
          totalOrder: totalCents / 100,
          balance: balanceCents / 100,
          events: order.events.map(event => ({
            date: event.createdAt.toISOString(),
            typeLabel: EVENT_LABELS[event.type] ?? event.type,
            detail: event.detail,
            actor: event.actor.name,
          })),
          // QR de evidencias: va en la hoja interna y en la etiqueta del equipo.
          evidenceUrl,
          evidenceLinkDisabled,
          // Etiqueta 50×40: toggles del negocio (label_show_problem /
          // label_show_access) — default imprimen falla y desbloqueo.
          labelShowProblem,
          labelShowAccess,
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
