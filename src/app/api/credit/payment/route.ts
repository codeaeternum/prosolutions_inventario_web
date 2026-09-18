import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { changeCredit } from "@/lib/domain/credit"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request) {
  try {
    // Cobrar abonos es tarea de mostrador: staff (admin o empleado).
    // Cargar deuda manual (/api/credit/debt) y mover límites siguen siendo de admin.
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    return NextResponse.json(await changeCredit(prisma, session.user.id, businessIdOf(session), "PAYMENT", await req.json()))
  } catch (error) { return businessFailure(error) }
}
