import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { transitionEncargo } from "@/lib/domain/encargos"
import { businessFailure } from "@/lib/domain/http"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"

/**
 * Transición de encargo: { action: "ORDERED" | "READY" | "DELIVERED" |
 * "CANCELLED", marketplaceRequestId?, supplierNote?, idempotencyKey }.
 * Al llegar a READY se avisa al staff del negocio (campanita/SSE).
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

    // La pieza llegó: aviso en vivo a admins + empleados con enlace al panel.
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
    }

    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}
