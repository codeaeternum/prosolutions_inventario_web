import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { convenioReport, settleConvenio } from "@/lib/domain/convenio"
import { businessFailure } from "@/lib/domain/http"

// Cuentas del convenio B2B entre talleres asociados: lo que debo a talleres
// por órdenes delegadas y lo que me deben captadores por órdenes espejo.
// Es control interno entre negocios — el cobro al cliente final va por POS.
export async function GET() {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const report = await convenioReport(prisma, businessIdOf(session))
    // canSettle refleja el permission "admin" del dominio: la UI solo muestra
    // el toggle a quien puede confirmarlo.
    return NextResponse.json({ ...report, canSettle: session.user.role === "ADMIN" }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await req.json()
    const result = await settleConvenio(prisma, session.user.id, businessIdOf(session), {
      ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    })
    return NextResponse.json(result)
  } catch (error) { return businessFailure(error) }
}
