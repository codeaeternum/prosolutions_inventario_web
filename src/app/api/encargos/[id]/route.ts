import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { transitionEncargo } from "@/lib/domain/encargos"
import { businessFailure } from "@/lib/domain/http"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"
import { escapeTelegramHtml, sendTelegramToCustomer } from "@/lib/telegram"

/**
 * Aviso directo al cliente por Telegram cuando su pieza llega (encargo →
 * READY). Solo si el encargo tiene cliente ligado con Telegram
 * (User.telegramId); sendTelegramToCustomer valida tenant + role CUSTOMER
 * por dentro, así que nunca se escribe a otro negocio ni a staff.
 */
async function notifyCustomerEncargoReady(
  businessId: string,
  result: { customerId: string | null; description: string; branchName: string | null },
) {
  if (!result.customerId) return
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } })
  const where = business?.name ? ` en <b>${escapeTelegramHtml(business.name)}</b>` : ""
  const branch = result.branchName ? ` (${escapeTelegramHtml(result.branchName)})` : ""
  await sendTelegramToCustomer(
    businessId,
    result.customerId,
    `✅ <b>¡Tu pieza ya llegó!</b>\n\n"${escapeTelegramHtml(result.description)}" ya está lista para recoger${where}${branch}. Te esperamos.`,
  )
}

/**
 * Transición de encargo: { action: "ORDERED" | "READY" | "DELIVERED" |
 * "CANCELLED", marketplaceRequestId?, supplierNote?, idempotencyKey }.
 * Al llegar a READY se avisa al staff del negocio (campanita/SSE) y al
 * cliente por Telegram si tiene su cuenta ligada.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params
    const body = await request.json()
    const result = await transitionEncargo(prisma, session.user.id, businessId, id, {
      ...body,
      // La transición es una sola por estado; la llave protege reintentos de red.
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key") ?? crypto.randomUUID(),
    })

    // La pieza llegó: aviso en vivo a admins + empleados con enlace al panel,
    // y aviso directo al cliente por Telegram si tiene la cuenta ligada.
    // Fire-and-forget — un fallo del broadcast no debe revertir el encargo.
    if (result.status === "READY") {
      void sendNotificationToStaff({
        type: "encargo_listo",
        title: "Encargo listo para entregar",
        message: `Llegó "${result.description}"${result.branchName ? ` a ${result.branchName}` : ""}. Avisa al cliente.`,
        data: {
          encargoId: result.encargoId,
          description: result.description,
          branchId: result.branchId,
          href: "/admin/inventario?tab=encargos",
        },
      }, businessId).catch(() => {})
      void notifyCustomerEncargoReady(businessId, result).catch(() => {})
    }

    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}
