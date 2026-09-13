import { NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeReservation } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"
import { reservationInclude } from "../route"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const reservation = await prisma.reservation.findUnique({ where: { id }, include: reservationInclude })
    if (!reservation || reservation.businessId !== businessIdOf(session)) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    if (session.user.role !== "ADMIN" && reservation.userId !== session.user.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    return NextResponse.json(reservation)
  } catch (error) { return businessFailure(error) }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const { id } = await params
    const session = getSession(auth)!
    const result = await changeReservation(prisma, session.user.id, businessIdOf(session), id, await req.json())
    return NextResponse.json({ ...result.reservation, changed: result.changed, requiresRefund: result.requiresRefund })
  } catch (error) { return businessFailure(error) }
}
