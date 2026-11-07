import { NextResponse } from "next/server"
import { assertBranchAllowed, assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
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
    // Primero la barrera del documento: sin acceso a la sucursal del apartado
    // ni siquiera se evalúa el cobro.
    const doc = await prisma.sale.findUnique({ where: { id }, select: { branchId: true, businessId: true } })
    const denied = assertBranchAllowed(session, doc?.businessId === businessIdOf(session) ? doc.branchId : null)
    if (denied) return denied
    // El efectivo del abono entra a la caja del COBRADOR (cashierBranchId o su
    // sucursal base), no a la del documento — mismo patrón que el abono de
    // crédito (/api/credit/payment): la sucursal efectiva del cobro también
    // debe ser operable por el cajero.
    const hasCash = Array.isArray(body?.payments) && body.payments.some((p: { method?: string }) => p?.method === "EFECTIVO")
    if (body?.cashierBranchId || hasCash) {
      const deniedCashier = await assertOperationBranch(session, body?.cashierBranchId)
      if (deniedCashier) return deniedCashier
    }
    return NextResponse.json(await payDocument(prisma, session.user.id, businessIdOf(session), {
      ...body, saleId: id, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    }))
  } catch (error) { return businessFailure(error) }
}
