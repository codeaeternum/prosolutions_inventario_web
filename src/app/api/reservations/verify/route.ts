import { NextResponse } from "next/server"
import { z } from "zod"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeReservation } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"
import { reservationInclude } from "../route"

// Verificación de QR y entrega en mostrador: staff con módulo reservas.
export async function GET(req: Request) {
  try {
    const auth = await requireModule("reservas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const code = z.string().min(1).max(160).parse(new URL(req.url).searchParams.get("code"))
    const reservation = await prisma.reservation.findFirst({ where: { businessId: businessIdOf(session), OR: [{ id: code }, { qrCode: code }] }, include: reservationInclude })
    if (!reservation) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    // La reserva de una sucursal ajena no se muestra al empleado restringido.
    const deniedBranch = assertBranchAllowed(session, reservation.branchId)
    if (deniedBranch) return deniedBranch
    const isExpired = reservation.expiresAt.getTime() <= Date.now()
    const canComplete = !isExpired && ["PENDING", "APPROVED", "DEPOSIT_VERIFIED"].includes(reservation.status) && (reservation.type !== "DEPOSIT" || reservation.depositPaid)
    return NextResponse.json({ reservation, isExpired, canComplete, message: canComplete ? "Revisa el saldo y medio de pago antes de entregar." : "La reserva no está lista para entregar." })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("reservas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const body = await req.json()
    const qrCode = z.string().min(1).max(160).parse(body.qrCode)
    const reservation = await prisma.reservation.findFirst({ where: { businessId, OR: [{ id: qrCode }, { qrCode }] }, select: { id: true, branchId: true } })
    if (!reservation) return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    // La entrega también exige que la reserva pertenezca a una sucursal asignada.
    const deniedBranch = assertBranchAllowed(session, reservation.branchId)
    if (deniedBranch) return deniedBranch
    const result = await changeReservation(prisma, session.user.id, businessId, reservation.id, { action: "complete", finalPaymentMethod: body.finalPaymentMethod })
    return NextResponse.json({ success: true, message: "Reserva entregada", reservation: result.reservation, changed: result.changed })
  } catch (error) { return businessFailure(error) }
}
