import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { changeReservation } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"
import { reservationInclude } from "../route"

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const code = z.string().min(1).max(160).parse(new URL(req.url).searchParams.get("code"))
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id: code }, { qrCode: code }] }, include: reservationInclude })
    if (!reservation) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    const isExpired = reservation.expiresAt.getTime() <= Date.now()
    const canComplete = !isExpired && ["PENDING", "APPROVED", "DEPOSIT_VERIFIED"].includes(reservation.status) && (reservation.type !== "DEPOSIT" || reservation.depositPaid)
    return NextResponse.json({ reservation, isExpired, canComplete, message: canComplete ? "Revisa el saldo y medio de pago antes de entregar." : "La reserva no está lista para entregar." })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const body = await req.json()
    const qrCode = z.string().min(1).max(160).parse(body.qrCode)
    const reservation = await prisma.reservation.findFirst({ where: { OR: [{ id: qrCode }, { qrCode }] }, select: { id: true } })
    if (!reservation) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    const result = await changeReservation(prisma, getSession(auth)!.user.id, reservation.id, { action: "complete", finalPaymentMethod: body.finalPaymentMethod })
    return NextResponse.json({ success: true, message: "Reserva entregada", reservation: result.reservation, changed: result.changed })
  } catch (error) { return businessFailure(error) }
}
