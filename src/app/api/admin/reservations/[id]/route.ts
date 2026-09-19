import { NextResponse } from "next/server"
import { requireModule, getSession } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeReservation } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"

// Gestión de reservas en mostrador (aprobar, verificar anticipo, entregar,
// cancelar/rechazar): staff con módulo reservas.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("reservas")
    if (auth.error) return auth.error
    const { id } = await params
    const session = getSession(auth)!
    const result = await changeReservation(prisma, session.user.id, businessIdOf(session), id, await req.json())
    return NextResponse.json({ ...result.reservation, changed: result.changed, requiresRefund: result.requiresRefund })
  } catch (error) { return businessFailure(error) }
}
