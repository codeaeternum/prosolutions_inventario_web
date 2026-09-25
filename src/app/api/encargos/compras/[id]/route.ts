import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { resolveShoppingItem } from "@/lib/domain/shopping"
import { businessFailure } from "@/lib/domain/http"

/** Resuelve un insumo de la lista de compras: { action: "PURCHASED" | "CANCELLED" }. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await request.json()
    const result = await resolveShoppingItem(prisma, session.user.id, businessIdOf(session), id, {
      action: body.action,
      // La transición es una sola por estado; la llave protege reintentos de red.
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key") ?? crypto.randomUUID(),
    })
    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}
