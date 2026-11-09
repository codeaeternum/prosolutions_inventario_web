import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireAdminOrEmployee, requireModule } from "@/lib/api-auth"
import { hasModule } from "@/lib/access"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { transitionEncargo } from "@/lib/domain/encargos"
import { businessFailure } from "@/lib/domain/http"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"
import { escapeTelegramHtml, sendTelegramToCustomer } from "@/lib/telegram"

/**
 * Detalle de un encargo para cobro en POS (/admin/ventas?encargo=<id>):
 * acepta módulo "ventas" además de "inventario" para que un cajero solo-ventas
 * pueda cargar el cliente, pieza, precio cotizado y anticipo neto del encargo.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    if (!hasModule(session.user, "inventario") && !hasModule(session.user, "ventas")) {
      return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 })
    }
    const businessId = businessIdOf(session)
    const { id } = await params
    const encargo = await prisma.encargo.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        product: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        payments: {
          where: { purpose: { in: ["ADVANCE", "REFUND"] }, status: { in: ["CONFIRMED", "REFUNDED"] } },
          select: { purpose: true, amount: true, method: true },
        },
      },
    })
    const denied = assertBranchAllowed(session, encargo?.businessId === businessId ? encargo.branchId : null)
    if (denied) return denied
    if (!encargo || encargo.businessId !== businessId) {
      return NextResponse.json({ error: "Encargo no encontrado." }, { status: 404 })
    }
    const advances = (encargo.payments ?? []).filter(p => p.purpose === "ADVANCE")
    const refunds = (encargo.payments ?? []).filter(p => p.purpose === "REFUND")
    const heldCents = advances.length
      ? Math.max(
          0,
          advances.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) +
            refunds.reduce((sum, p) => sum + Math.round(p.amount * 100), 0),
        )
      : Math.round(encargo.deposit * 100)
    return NextResponse.json(
      { encargo: { ...encargo, deposit: heldCents / 100 } },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}

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
 * "CANCELLED", marketplaceRequestId?, supplierNote?, idempotencyKey,
 * refundMethod?, supplierId?, supplierAmountCents?, supplierMethod?,
 * cashFromRegister? }.
 * ORDERED admite además el pago al proveedor (SupplierPayment; solo ADMIN,
 * con cashFromRegister opcional para sacar el efectivo del cajón) y
 * CANCELLED devuelve el anticipo del cliente (Payment REFUND + salida de
 * caja cuando es efectivo).
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
    // La transición opera sobre la sucursal DEL encargo: un empleado restringido
    // no puede mover encargos de sucursales que no tiene asignadas.
    const encargo = await prisma.encargo.findUnique({ where: { id }, select: { branchId: true, businessId: true } })
    const denied = assertBranchAllowed(session, encargo?.businessId === businessId ? encargo.branchId : null)
    if (denied) return denied
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
