import { NextResponse } from "next/server"
import { assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { checkoutDocument } from "@/lib/domain/documents"
import { businessFailure } from "@/lib/domain/http"

// Cobro de un documento vivo: el DRAFT suspendido o la cotización toma
// stock, registra pagos y queda COMPLETED con su mismo folio.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await req.json()
    const denied = await assertOperationBranch(session, body?.branchId)
    if (denied) return denied
    return NextResponse.json(await checkoutDocument(prisma, session.user.id, businessIdOf(session), {
      ...body, saleId: id, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    }))
  } catch (error) { return businessFailure(error) }
}
