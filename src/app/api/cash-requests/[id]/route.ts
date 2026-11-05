import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { decideCashRequest } from "@/lib/domain/cash-requests"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // La decisión asienta dinero real (CashMovement OUT): solo ADMIN, nunca
    // un empleado del módulo caja. La auto-aprobación se bloquea en decide().
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params
    const body = await req.json()
    const headerKey = req.headers.get("idempotency-key") ?? undefined
    const result = await decideCashRequest(prisma, actorId, businessId, id, body, headerKey)
    return NextResponse.json(result)
  } catch (error) { return businessFailure(error) }
}
