import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { cancelDocument } from "@/lib/domain/documents"
import { businessFailure } from "@/lib/domain/http"

// Detalle de un documento vivo para retomarlo en la terminal. Solo lectura;
// el cambio de estado siempre pasa por checkout/pay/cancel.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const { id } = await params
    const document = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true, barcode: true, retailPrice: true, wholesalePrice: true, stock: true, images: true } } } },
        customer: { select: { id: true, name: true, phone: true, customerType: true } },
        seller: { select: { id: true, name: true } },
        payments: { where: { status: "CONFIRMED" }, select: { id: true, method: true, amount: true, reference: true, createdAt: true } },
        branch: { select: { id: true, name: true } },
      },
    })
    if (!document || document.businessId !== businessIdOf(getSession(auth)!)) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
    }
    // El detalle expone renglones y pagos de la sucursal del documento.
    const deniedBranch = assertBranchAllowed(getSession(auth)!, document.branchId)
    if (deniedBranch) return deniedBranch
    const paid = document.payments.reduce((sum, p) => sum + p.amount, 0)
    return NextResponse.json(
      { document: { ...document, paid, balance: Math.max(0, document.total - paid) } },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) { return businessFailure(error) }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    // Cancelar reembolsa dinero en la sucursal DEL documento: sin este assert
    // un empleado restringido podía vaciar la caja de una sucursal ajena.
    const doc = await prisma.sale.findUnique({ where: { id }, select: { branchId: true, businessId: true } })
    const deniedBranch = assertBranchAllowed(session, doc?.businessId === businessIdOf(session) ? doc.branchId : null)
    if (deniedBranch) return deniedBranch
    return NextResponse.json(await cancelDocument(prisma, session.user.id, businessIdOf(session), {
      saleId: id, reason: body.reason ?? "Cancelado desde el mostrador",
      idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    }))
  } catch (error) { return businessFailure(error) }
}
