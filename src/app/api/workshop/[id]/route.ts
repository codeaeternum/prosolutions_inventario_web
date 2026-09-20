import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireAdminOrEmployee, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { updateRepair } from "@/lib/domain/workshop"
import { REPAIR_PARTNER_KEY } from "@/lib/domain/delegation"
import { decryptAccessValue } from "@/lib/device-secret"
import { businessFailure } from "@/lib/domain/http"
import { loadQuoteServiceLines } from "@/lib/public-quote"
import { suggestedServiceLinesTotal } from "@/lib/quote-services"
import { getBusinessSetting, getOrderFolioDigits } from "@/lib/settings"
import { repairFolio } from "@/lib/workshop-labels"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"

const READY_PUBLIC_MESSAGE = "Tu equipo está listo para recoger."

// Tras una transición exitosa a READY: deja un mensaje público para el
// cliente (una sola vez), avisa al staff conectado (SSE de admins) y arma el
// enlace de WhatsApp para que el front ofrezca notificar al cliente.
async function readySideEffects(order: { id: string; number: number; status: string; customerName: string; customerPhone: string; businessId: string }, actorId: string) {
  if (order.status !== "READY") return {}
  const exists = await prisma.repairEvent.findFirst({
    where: { orderId: order.id, isPublic: true, detail: READY_PUBLIC_MESSAGE },
    select: { id: true },
  })
  const folio = repairFolio(order.number, await getOrderFolioDigits(order.businessId))
  if (!exists) {
    await prisma.repairEvent.create({
      data: { businessId: order.businessId, actorId, orderId: order.id, type: "NOTE", detail: READY_PUBLIC_MESSAGE, isPublic: true },
    })
    void sendNotificationToStaff({
      type: "repair_ready",
      title: "Orden lista para entregar",
      message: `${folio} está lista para que el cliente la recoja.`,
      data: { orderId: order.id, folio },
    }, order.businessId).catch(() => {})
  }
  const base = (process.env.NEXTAUTH_URL || "https://reficio.app").replace(/\/+$/, "")
  const digits = order.customerPhone.replace(/\D/g, "")
  // wa.me exige formato internacional; los teléfonos locales de 10 dígitos se asumen MX (+52).
  const phone = digits.length === 10 ? `52${digits}` : digits
  // El link lleva folio + últimos 4 dígitos (?t=): el cliente no teclea nada.
  const phone4 = digits.slice(-4)
  const tracking = `${base}/seguimiento?folio=${folio}${phone4 ? `&t=${phone4}` : ""}`
  const text = `Hola ${order.customerName}, tu equipo ${folio} ya está listo para recoger. Sigue tu orden aquí: ${tracking}`
  const notifyWhatsApp = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : undefined
  return { notifyWhatsApp }
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const order = await prisma.repairOrder.findUnique({ where: { id, businessId: businessIdOf(session) }, include: { currentBranch: true, intakeBranch: true, assignedTo: { select: { id: true, name: true } }, deliveredBy: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } }, originBusiness: { select: { id: true, name: true } }, delegatedToBusiness: { select: { id: true, name: true } }, events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200, include: { actor: { select: { name: true } } } }, parts: { include: { createdBy: { select: { name: true } }, product: { select: { id: true, name: true, barcode: true, retailPrice: true } }, sourceBranch: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }, payments: { where: { status: { in: ["CONFIRMED", "REFUNDED"] } }, orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } }, photos: { orderBy: { createdAt: "asc" }, include: { uploadedBy: { select: { name: true } } } } } })
    if (!order) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404, headers: { "Cache-Control": "private, no-store" } })
    // El PIN/patrón viaja cifrado en BD y solo sale con ?reveal=1; sin el
    // parámetro la ficha recibe null (deviceAccessType sigue indicando que
    // hay credencial). Staff admin y empleado pueden revelarlo — los
    // técnicos lo necesitan — pero cada reveal queda en la bitácora interna.
    let deviceAccessValue: string | null = null
    if (new URL(req.url).searchParams.get("reveal") === "1" && order.deviceAccessValue) {
      // Clave rotada o dato ilegible: la ficha se sirve igual, sin el código.
      try { deviceAccessValue = decryptAccessValue(order.deviceAccessValue) } catch { deviceAccessValue = null }
      await prisma.repairEvent.create({ data: { businessId: order.businessId, actorId: session.user.id, orderId: order.id, type: "NOTE", detail: "Consultó el dato de desbloqueo del equipo", isPublic: false } })
    }
    // El folio viaja ya formateado con los dígitos del negocio
    // (order_folio_digits) — los clientes no recalculan el padding.
    const folioDigits = await getOrderFolioDigits(order.businessId)
    // partnerConfigured: el detalle decide si muestra "Enviar a taller"
    // (delegación saliente al reparador configurado). Los campos de delegación
    // (delegatedToBusinessId/delegatedOrderId/delegatedAt + delegatedToBusiness)
    // ya viajan en order.
    const partnerConfigured = Boolean((await getBusinessSetting(order.businessId, REPAIR_PARTNER_KEY).catch(() => null))?.trim())
    // Precio sugerido por catálogo para el equipo de la orden (suma de los
    // servicios elegidos con precio por modelo/tipo): la acción QUOTE lo
    // prellena cuando aún no hay importe capturado. null si algún servicio
    // no resuelve — "se cotiza al recibir" — o el lookup falla.
    const suggestedQuoteCents = suggestedServiceLinesTotal(await loadQuoteServiceLines(order).catch(() => []))
    return NextResponse.json({ order: { ...order, folio: repairFolio(order.number, folioDigits), deviceAccessValue, suggestedQuoteCents }, partnerConfigured }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
async function handleUpdate(req: Request, params: Promise<{ id: string }>) {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const { id } = await params
    const body = await req.json()
    // TRANSFER mueve la orden a branchId; PART_REQUEST/PART_ADD descuenta la
    // pieza de sourceBranchId — ambas sucursales deben estar asignadas.
    for (const branchId of [body?.branchId, body?.sourceBranchId]) {
      const denied = assertBranchAllowed(session, branchId)
      if (denied) return denied
    }
    const result = await updateRepair(prisma, actorId, businessIdOf(session), id, body)
    // La actualización ya se confirmó: un fallo en el aviso no debe reportarse
    // como error de la operación.
    const extra = await readySideEffects(result.order, actorId).catch(() => ({}))
    return NextResponse.json({ ...result, ...extra })
  } catch (error) { return businessFailure(error) }
}
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) { return handleUpdate(req, ctx.params) }
export function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) { return handleUpdate(req, ctx.params) }
