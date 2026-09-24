import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { setPurchaseStatus, updatePurchaseDraft } from "@/lib/domain/purchasing"
import { businessFailure } from "@/lib/domain/http"

/** Cambia el estado de la orden: { action: "ORDER" | "RECEIVE" | "RECEIVE_PARTIAL" | "CANCEL", items? }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await request.json()
    // La transición entra stock a la sucursal de la OC: sin este assert un
    // empleado restringido a otra sucursal podía recibir/cancelar OCs ajenas.
    const purchase = await prisma.purchase.findFirst({
      where: { id, businessId: businessIdOf(session) },
      select: { branchId: true },
    })
    if (purchase) {
      const denied = assertBranchAllowed(session, purchase.branchId)
      if (denied) return denied
    }
    const result = await setPurchaseStatus(prisma, session.user.id, businessIdOf(session), id, {
      action: body.action,
      // RECEIVE_PARTIAL trae items: [{ purchaseItemId, quantity }] con lo que
      // llegó en esta entrega; el dominio valida que no exceda lo pendiente.
      items: body.items,
      // Las transiciones ya son idempotentes por estado; la llave solo protege reintentos de red.
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key") ?? crypto.randomUUID(),
    })
    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}

/** Edita una OC en DRAFT: { supplierId?, branchId, notes?, dueAt?, items[] }. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await request.json()
    const purchase = await prisma.purchase.findFirst({
      where: { id, businessId: businessIdOf(session) },
      select: { branchId: true },
    })
    if (purchase) {
      const denied = assertBranchAllowed(session, purchase.branchId)
      if (denied) return denied
      // También la sucursal destino: un empleado restringido no debe mover la OC
      // a una sucursal fuera de su alcance.
      if (typeof body.branchId === "string" && body.branchId !== purchase.branchId) {
        const deniedTarget = assertBranchAllowed(session, body.branchId)
        if (deniedTarget) return deniedTarget
      }
    }
    const result = await updatePurchaseDraft(prisma, session.user.id, businessIdOf(session), id, body)
    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}
