import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z, ZodError } from "zod"
import { prisma } from "@/lib/prisma"
import { transaction, BusinessError } from "@/lib/domain/operations"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { getBusinessSetting } from "@/lib/settings"
import { ORDER_FOLIO_DIGITS_KEY, parseFolioDigits, repairFolio } from "@/lib/workshop-labels"
import { approvedPartsTotal } from "@/lib/workshop-money"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"

// Decisión pública de la cotización (cliente con el link de WhatsApp, sin
// sesión — el quoteToken es el secreto). Los eventos usan como actor a quien
// recibió la orden porque RepairEvent.actorId es requerido y no hay usuario
// autenticado; el detalle deja claro que respondió el cliente.
const NO_STORE = { "Cache-Control": "no-store" } as const
const NOT_FOUND = "Cotización no encontrada o enlace expirado."
const WINDOW_MS = 60 * 60 * 1000
const MAX_DECISIONS = 10 // por hora por IP; el flujo real necesita 1-2 intentos

const PUBLIC_APPROVED = "El cliente aprobó la cotización."
const PUBLIC_REJECTED = "El cliente no autorizó la cotización."
// Monto visto ≠ monto vigente: el cliente reabre el link y vuelve a decidir.
const QUOTE_CHANGED = "La cotización cambió; vuelve a abrir el link"

const bodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  signerName: z.string().trim().max(80).optional(),
  // Anti-TOCTOU: la mano de obra que el cliente vio en pantalla. Si el taller
  // cambió el presupuesto entre la carga y el POST, se rechaza la decisión
  // en vez de comprometer una cifra que el cliente nunca autorizó.
  expectedLaborCents: z.number().int().min(0).max(100000000),
  // Anti-TOCTOU de refacciones: el total de piezas autorizadas que el
  // cliente vio desglosado. Opcional por compatibilidad con clientes
  // anteriores; la UI actual siempre lo envía. Si no coincide con el
  // total vigente → 409 QUOTE_CHANGED, igual que la mano de obra.
  expectedPartsCents: z.number().int().min(0).max(100000000).optional(),
  // Parte del contrato para una futura captura de firma; hoy no se persiste:
  // RepairOrder.signatureData guarda la firma de RECEPCIÓN y no debe mezclarse.
  signatureData: z.string().max(300000).regex(/^data:image\/png;base64,/).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!checkAndRecord("cotizacion-decision", getClientIp(req), WINDOW_MS, MAX_DECISIONS)) {
      return NextResponse.json(
        { error: "Demasiados intentos. Intenta de nuevo en una hora." },
        { status: 429, headers: NO_STORE },
      )
    }

    const { token } = await params
    const input = bodySchema.parse(await req.json())
    const signer = input.signerName?.trim() || ""
    const approving = input.action === "APPROVE"

    const decided = await transaction(prisma, async tx => {
      const order = await tx.repairOrder.findUnique({
        where: { quoteToken: token },
        select: {
          id: true, number: true, version: true, status: true, businessId: true,
          quoteCents: true, approvedQuoteCents: true, quoteApprovedAt: true,
          quoteExpiresAt: true,
          createdById: true, equipmentType: true, brand: true, model: true,
          // Tenant suspendido: el enlace muere igual que un token inválido
          // (sin mutar nada — el cliente no decide sobre un negocio inactivo).
          business: { select: { isActive: true } },
          // Refacciones autorizadas: se cobran además de la mano de obra y son
          // parte de lo que el cliente ve al aprobar.
          parts: { where: { status: "APPROVED" }, select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true } },
        },
      })
      if (!order || !order.business.isActive) throw new BusinessError(NOT_FOUND, 404)
      if (order.quoteApprovedAt) throw new BusinessError("Esta cotización ya fue decidida.", 409)
      if (order.status === "NOT_AUTHORIZED") throw new BusinessError("Esta cotización ya no está vigente.", 409)
      if (order.status === "CANCELLED" || order.status === "DELIVERED") throw new BusinessError("La orden ya está cerrada; la cotización no puede modificarse.", 409)
      // La decisión pública solo existe sobre una cotización formalmente
      // presentada (WAITING_APPROVAL la fija la acción QUOTE con importe).
      // Antes se aceptaban RECEIVED/DIAGNOSIS con quoteCents: un estimado
      // informal de recepción se convertía en cobro autorizado.
      if (order.status !== "WAITING_APPROVAL" || order.quoteCents === null) {
        throw new BusinessError("Esta cotización no está pendiente de autorización.", 409)
      }
      // Vigencia real: el documento dice "Válida por 15 días". Una cotización
      // vencida sin decidir ya no puede aprobarse — el taller la reenvía con
      // la acción QUOTE, que fija una vigencia nueva.
      if (order.quoteExpiresAt && order.quoteExpiresAt.getTime() < Date.now()) {
        throw new BusinessError("La cotización venció. Contacta al taller para reenviarla.", 410, "QUOTE_EXPIRED")
      }
      // El cliente aprueba la cifra que VIO, no la vigente al llegar el POST:
      // mano de obra y refacciones autorizadas por separado (una refacción
      // nueva no cambia quoteCents, pero sí el total autorizado).
      const partsCentsNow = approvedPartsTotal(order.parts).priceCents
      if (approving && (input.expectedLaborCents !== order.quoteCents
        || (input.expectedPartsCents !== undefined && input.expectedPartsCents !== partsCentsNow))) {
        throw new BusinessError(QUOTE_CHANGED, 409, "QUOTE_CHANGED")
      }

      // Idempotencia defensiva: el rechazo también marca NOT_AUTHORIZED, pero
      // si un intento anterior solo alcanzó a escribir el evento, no duplicar.
      if (!approving) {
        const already = await tx.repairEvent.findFirst({
          where: { orderId: order.id, detail: PUBLIC_REJECTED },
          select: { id: true },
        })
        if (already) throw new BusinessError("Esta cotización ya fue decidida.", 409)
      }

      const now = new Date()
      const data: Prisma.RepairOrderUncheckedUpdateManyInput = { version: { increment: 1 } }
      if (approving) {
        data.quoteApprovedAt = now
        // `??= quoteCents`: respeta un importe autorizado ya registrado en
        // mostrador. Lo que el cliente VE al aprobar es el quoteCents vigente
        // (la vista pública muestra labor + refacciones aprobadas).
        if (order.approvedQuoteCents === null && order.quoteCents !== null) data.approvedQuoteCents = order.quoteCents
        // Directo a reparación, igual que la autorización en mostrador
        // (workshop.ts APPROVE). Antes fijaba DIAGNOSIS y la orden quedaba
        // varada: DIAGNOSIS no tiene transición a IN_REPAIR en repairNextStages.
        // La guardia de arriba ya garantiza status === WAITING_APPROVAL.
        data.status = "IN_REPAIR"
      } else {
        data.status = "NOT_AUTHORIZED"
      }

      const updated = await tx.repairOrder.updateMany({
        where: { id: order.id, version: order.version, quoteApprovedAt: null },
        data,
      })
      if (updated.count !== 1) throw new BusinessError("La cotización cambió al mismo tiempo. Recarga el enlace.", 409)
      const newStatus = (data.status as string | undefined) ?? order.status

      // Constancia de la cifra que el cliente vio al decidir: mano de obra
      // autorizada + refacciones aprobadas (lo que la vista pública desglosa).
      const laborCents = (data.approvedQuoteCents as number | undefined) ?? order.approvedQuoteCents ?? order.quoteCents ?? 0
      const decisionAmounts = ` Mano de obra ${(laborCents / 100).toFixed(2)} MXN + refacciones ${(partsCentsNow / 100).toFixed(2)} MXN = ${((laborCents + partsCentsNow) / 100).toFixed(2)} MXN.`

      await tx.repairEvent.create({
        data: {
          businessId: order.businessId,
          actorId: order.createdById,
          orderId: order.id,
          type: "NOTE",
          isPublic: false,
          detail: approving
            ? `Cotización aprobada por el cliente vía link público${signer ? ` (${signer})` : ""}.${decisionAmounts}`
            : `Cotización no autorizada por el cliente vía link público${signer ? ` (${signer})` : ""}.${decisionAmounts}`,
        },
      })
      await tx.repairEvent.create({
        data: {
          businessId: order.businessId,
          actorId: order.createdById,
          orderId: order.id,
          type: "NOTE",
          isPublic: true,
          detail: approving ? PUBLIC_APPROVED : PUBLIC_REJECTED,
        },
      })
      return { order, newStatus, approvedAt: approving ? now : null }
    })

    // Aviso al staff conectado (SSE). Un fallo del aviso no debe reportarse
    // como error: la decisión ya quedó comprometida en la transacción.
    // El folio del aviso usa el largo configurado por el negocio dueño de la
    // orden (order_folio_digits); un ajuste ausente/inválido cae al default.
    const folio = repairFolio(decided.order.number, parseFolioDigits(await getBusinessSetting(decided.order.businessId, ORDER_FOLIO_DIGITS_KEY).catch(() => null)))
    const equipment = [decided.order.equipmentType, decided.order.brand, decided.order.model].filter(Boolean).join(" ")
    void sendNotificationToStaff({
      type: "repair_ready",
      title: approving ? "Cotización aprobada" : "Cotización rechazada",
      message: `${folio}${equipment ? ` · ${equipment}` : ""} — el cliente ${approving ? "aprobó" : "no autorizó"} la cotización vía link público${signer ? ` (${signer})` : ""}.`,
      data: { orderId: decided.order.id, folio },
    }, decided.order.businessId).catch(() => {})

    return NextResponse.json(
      {
        ok: true,
        decision: approving ? "APPROVED" : "REJECTED",
        status: decided.newStatus,
        quoteApprovedAt: decided.approvedAt?.toISOString() ?? null,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof BusinessError) {
      // El código viaja para que la UI distinga "cotización cambió" (mensaje
      // + recargar) de "ya fue decidida" (pantalla de estado final).
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: NO_STORE })
    }
    console.error("[cotizacion] Error al registrar la decisión:", error)
    return NextResponse.json(
      { error: "No pudimos registrar tu respuesta. Intenta de nuevo." },
      { status: 500, headers: NO_STORE },
    )
  }
}
