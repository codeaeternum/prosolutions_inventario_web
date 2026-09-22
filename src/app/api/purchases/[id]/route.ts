import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { setPurchaseStatus } from "@/lib/domain/purchasing"
import { businessFailure } from "@/lib/domain/http"

/** Cambia el estado de la orden: { action: "ORDER" | "RECEIVE" | "CANCEL" }. */
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
      // Las transiciones ya son idempotentes por estado; la llave solo protege reintentos de red.
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key") ?? crypto.randomUUID(),
    })
    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}
