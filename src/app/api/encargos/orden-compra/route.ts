import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createPurchaseFromNeeds } from "@/lib/domain/shopping"
import { businessFailure } from "@/lib/domain/http"

/**
 * Genera una orden de compra en borrador con los productos tildados en la
 * lista de encargos; los insumos manuales tildados quedan ligados a la OC.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    const result = await createPurchaseFromNeeds(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
