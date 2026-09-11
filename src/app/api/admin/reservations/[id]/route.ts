import { NextResponse } from "next/server"
import { requireAdmin, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { changeReservation } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const { id } = await params
    const result = await changeReservation(prisma, getSession(auth)!.user.id, id, await req.json())
    return NextResponse.json({ ...result.reservation, changed: result.changed, requiresRefund: result.requiresRefund })
  } catch (error) { return businessFailure(error) }
}
