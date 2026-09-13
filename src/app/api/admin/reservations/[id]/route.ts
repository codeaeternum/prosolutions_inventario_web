import { NextResponse } from "next/server"
import { requireAdmin, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeReservation } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    const session = getSession(auth)!
    const result = await changeReservation(prisma, session.user.id, businessIdOf(session), id, await req.json())
    return NextResponse.json({ ...result.reservation, changed: result.changed, requiresRefund: result.requiresRefund })
  } catch (error) { return businessFailure(error) }
}
