import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { voidSale } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const { id } = await params
    const session = getSession(auth)!
    const body = await req.json().catch(() => ({}))
    // Anular repone stock y reembolsa dinero en la sucursal DE la venta.
    const sale = await prisma.sale.findUnique({ where: { id }, select: { branchId: true, businessId: true, sellerId: true } })
    const denied = assertBranchAllowed(session, sale?.businessId === businessIdOf(session) ? sale.branchId : null)
    if (denied) return denied
    // Corte temprano del mismo gate del dominio: un EMPLOYEE solo anula sus
    // propias ventas; las ajenas requieren ADMIN (vector de robo interno).
    if (sale?.businessId === businessIdOf(session) && session.user.role !== "ADMIN" && sale.sellerId !== session.user.id) {
      return NextResponse.json({ error: "Anular la venta de otra persona requiere un administrador." }, { status: 403 })
    }
    return NextResponse.json(await voidSale(prisma, session.user.id, businessIdOf(session), { ...body, saleId: id, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") }))
  } catch (error) { return businessFailure(error) }
}
