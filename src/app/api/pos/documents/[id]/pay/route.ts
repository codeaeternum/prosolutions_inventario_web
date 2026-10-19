import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { payDocument } from "@/lib/domain/documents"
import { businessFailure } from "@/lib/domain/http"

// Abono a un apartado (OPEN LAYAWAY): registra pagos parciales y completa
// el documento automáticamente cuando el saldo llega a cero.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await req.json()
    // El abono entra a la caja de la sucursal DEL apartado; body.branchId no lo
    // usa el dominio, así que el assert va sobre la sucursal efectiva.
    const doc = await prisma.sale.findUnique({ where: { id }, select: { branchId: true, businessId: true } })
    const denied = assertBranchAllowed(session, doc?.businessId === businessIdOf(session) ? doc.branchId : null)
    if (denied) return denied
    return NextResponse.json(await payDocument(prisma, session.user.id, businessIdOf(session), {
      ...body, saleId: id, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    }))
  } catch (error) { return businessFailure(error) }
}
