import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { updateRepair } from "@/lib/domain/workshop"
import { businessFailure } from "@/lib/domain/http"
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
  const folio = repairFolio(order.number)
  if (!exists) {
    await prisma.repairEvent.create({
      data: { businessId: order.businessId, actorId, orderId: order.id, type: "NOTE", detail: READY_PUBLIC_MESSAGE, isPublic: true },
    })
    void sendNotificationToStaff({
      type: "repair_ready",
      title: "Orden lista para entregar",
      message: `${folio} está lista para que el cliente la recoja.`,
      data: { orderId: order.id, folio },
    }).catch(() => {})
  }
  const base = (process.env.NEXTAUTH_URL || "https://reficio.app").replace(/\/+$/, "")
  const digits = order.customerPhone.replace(/\D/g, "")
  // wa.me exige formato internacional; los teléfonos locales de 10 dígitos se asumen MX (+52).
  const phone = digits.length === 10 ? `52${digits}` : digits
  const text = `Hola ${order.customerName}, tu equipo ${folio} ya está listo para recoger. Sigue tu orden aquí: ${base}/seguimiento?folio=${folio}`
  const notifyWhatsApp = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : undefined
  return { notifyWhatsApp }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const { id } = await params
    const order = await prisma.repairOrder.findUnique({ where: { id, businessId: businessIdOf(getSession(auth)!) }, include: { currentBranch: true, intakeBranch: true, assignedTo: { select: { id: true, name: true } }, events: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200, include: { actor: { select: { name: true } } } }, parts: { include: { createdBy: { select: { name: true } }, product: { select: { id: true, name: true, barcode: true, retailPrice: true } } }, orderBy: { createdAt: "asc" } }, payments: { where: { status: "CONFIRMED" }, orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } }, photos: { orderBy: { createdAt: "asc" }, include: { uploadedBy: { select: { name: true } } } } } })
    return NextResponse.json(order ? { order } : { error: "Orden no encontrada" }, { status: order ? 200 : 404, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
async function handleUpdate(req: Request, params: Promise<{ id: string }>) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const { id } = await params
    const result = await updateRepair(prisma, actorId, businessIdOf(session), id, await req.json())
    // La actualización ya se confirmó: un fallo en el aviso no debe reportarse
    // como error de la operación.
    const extra = await readySideEffects(result.order, actorId).catch(() => ({}))
    return NextResponse.json({ ...result, ...extra })
  } catch (error) { return businessFailure(error) }
}
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) { return handleUpdate(req, ctx.params) }
export function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) { return handleUpdate(req, ctx.params) }
