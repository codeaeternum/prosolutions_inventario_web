import { NextResponse } from "next/server"
import { assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeCredit } from "@/lib/domain/credit"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request) {
  try {
    // Cobrar abonos es tarea de mostrador: staff (admin o empleado).
    // Cargar deuda manual (/api/credit/debt) y mover límites siguen siendo de admin.
    const auth = await requireModule("credito")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await req.json()
    // Un abono en efectivo entra a la caja de la sucursal indicada o la base del cobrador.
    if (body?.branchId || body?.paymentMethod === "EFECTIVO") {
      const denied = await assertOperationBranch(session, body?.branchId)
      if (denied) return denied
    }
    return NextResponse.json(await changeCredit(prisma, session.user.id, businessIdOf(session), "PAYMENT", body))
  } catch (error) { return businessFailure(error) }
}
