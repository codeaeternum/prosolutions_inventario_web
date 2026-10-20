import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { listSupplierPayments, paySupplier } from "@/lib/domain/supplier-payments"
import { businessFailure } from "@/lib/domain/http"

/** Historial de abonos: ?supplierId=<id> acota a un proveedor; sin él,
 *  últimos abonos del negocio (vista "pagos recientes", una sola llamada).
 *  El empleado con sucursales asignadas solo ve abonos a cuenta general y
 *  los ligados a OCs de sus sucursales. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds

    const supplierId = new URL(request.url).searchParams.get("supplierId")
    const payments = await listSupplierPayments(prisma, businessId, supplierId, allowed)
    return NextResponse.json({ payments }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}

/** Registra un abono a proveedor (a OC específica o a cuenta general). */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    // Registrar el abono es liquidar la cuenta por pagar (sin reverso): solo
    // ADMIN. El dominio además lo exige con permission "admin" — este corte
    // temprano evita abrir la transacción para un empleado.
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Solo un administrador puede registrar pagos a proveedores." }, { status: 403 })
    }
    const body = await request.json()
    // Abonar a una OC de sucursal ajena es operar sobre su documento: se
    // valida igual que un branchId explícito (OC inexistente → el dominio 404).
    if (typeof body?.purchaseId === "string" && body.purchaseId) {
      const target = await prisma.purchase.findFirst({
        where: { id: body.purchaseId, businessId },
        select: { branchId: true },
      })
      const denied = assertBranchAllowed(session, target?.branchId)
      if (denied) return denied
    }
    const result = await paySupplier(prisma, session.user.id, businessId, {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
