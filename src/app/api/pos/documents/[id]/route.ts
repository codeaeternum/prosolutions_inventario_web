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
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params
    const document = await prisma.sale.findUnique({
      where: { id, businessId },
      include: {
        items: { include: { product: { select: { id: true, name: true, barcode: true, retailPrice: true, wholesalePrice: true, stock: true, images: true } } } },
        customer: { select: { id: true, name: true, phone: true, customerType: true } },
        seller: { select: { id: true, name: true } },
        payments: { where: { status: "CONFIRMED" }, select: { id: true, method: true, amount: true, reference: true, createdAt: true } },
        branch: { select: { id: true, name: true } },
      },
    })
    if (!document || document.businessId !== businessId) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
    }
    // El detalle expone renglones y pagos de la sucursal del documento.
    const deniedBranch = assertBranchAllowed(session, document.branchId)
    if (deniedBranch) return deniedBranch
    // Payment.amount y Sale.total son Float en pesos: la cuenta va en centavos.
    const paidCents = document.payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
    const paid = paidCents / 100
    return NextResponse.json(
      { document: { ...document, paid, balance: Math.max(0, Math.round(document.total * 100) - paidCents) / 100 } },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) { return businessFailure(error) }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    // Cancelar reembolsa dinero en la sucursal DEL documento: sin este assert
    // un empleado restringido podía vaciar la caja de una sucursal ajena.
    const doc = await prisma.sale.findUnique({ where: { id, businessId }, select: { branchId: true, businessId: true, status: true, sellerId: true } })
    const deniedBranch = assertBranchAllowed(session, doc?.businessId === businessId ? doc.branchId : null)
    if (deniedBranch) return deniedBranch
    // Corte temprano del mismo gate del dominio: un EMPLOYEE solo cancela los
    // documentos con dinero que él mismo registró; los ajenos requieren ADMIN.
    // El DRAFT no movió dinero ni stock: anularlo sigue siendo de mostrador.
    if (doc?.businessId === businessId && doc.status !== "DRAFT" && session.user.role !== "ADMIN" && doc.sellerId !== session.user.id) {
      return NextResponse.json({ error: "Cancelar el apartado de otra persona requiere un administrador." }, { status: 403 })
    }
    return NextResponse.json(await cancelDocument(prisma, session.user.id, businessId, {
      saleId: id, reason: body.reason ?? "Cancelado desde el mostrador",
      idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key"),
    }))
  } catch (error) { return businessFailure(error) }
}
