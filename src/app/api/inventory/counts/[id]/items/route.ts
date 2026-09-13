import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { setCountItems } from "@/lib/domain/counts"
import { businessFailure } from "@/lib/domain/http"

/** Captura/actualiza lo contado: { items: [{ productId, countedQty }] }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await request.json()
    const result = await setCountItems(prisma, session.user.id, businessIdOf(session), id, {
      items: body.items,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key") ?? crypto.randomUUID(),
    })
    return NextResponse.json(result)
  } catch (error) {
    return businessFailure(error)
  }
}
