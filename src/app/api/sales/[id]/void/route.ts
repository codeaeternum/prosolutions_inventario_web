import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { voidSale } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const { id } = await params
    const session = getSession(auth)!
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await voidSale(prisma, session.user.id, businessIdOf(session), { ...body, saleId: id, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") }))
  } catch (error) { return businessFailure(error) }
}
