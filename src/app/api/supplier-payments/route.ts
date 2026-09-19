import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { listSupplierPayments, paySupplier } from "@/lib/domain/supplier-payments"
import { businessFailure } from "@/lib/domain/http"

/** Historial de abonos de un proveedor: ?supplierId=<id>. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const supplierId = new URL(request.url).searchParams.get("supplierId")
    if (!supplierId) return NextResponse.json({ error: "supplierId requerido" }, { status: 400 })

    const payments = await listSupplierPayments(prisma, businessId, supplierId)
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
    const body = await request.json()
    const result = await paySupplier(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
