import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { returnSaleItems } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const { id } = await params
    const session = getSession(auth)!
    const body = await req.json()
    // La devolución repone stock y reembolsa en la sucursal DE la venta.
    const sale = await prisma.sale.findUnique({ where: { id }, select: { branchId: true, businessId: true } })
    const denied = assertBranchAllowed(session, sale?.businessId === businessIdOf(session) ? sale.branchId : null)
    if (denied) return denied
    return NextResponse.json(await returnSaleItems(prisma, session.user.id, businessIdOf(session), { ...body, saleId: id, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") }))
  } catch (error) { return businessFailure(error) }
}
