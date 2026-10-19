import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createPurchase, listPurchases } from "@/lib/domain/purchasing"
import { businessFailure } from "@/lib/domain/http"
import type { PurchaseStatus } from "@prisma/client"

const STATUSES: PurchaseStatus[] = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const query = new URL(request.url).searchParams
    // El filtro de sucursal se valida contra allowedBranchIds: sin el assert
    // un empleado restringido podía listar compras de sucursales ajenas.
    const branchId = query.get("branchId") || undefined
    const deniedBranch = assertBranchAllowed(session, branchId)
    if (deniedBranch) return deniedBranch
    const statusParam = query.get("status")
    const status = STATUSES.includes(statusParam as PurchaseStatus) ? (statusParam as PurchaseStatus) : undefined

    // Sin filtro explícito, el empleado con sucursales asignadas solo ve las
    // compras de las suyas (listPurchases no recibe sucursal: se recorta aquí).
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const purchases = (await listPurchases(prisma, businessId, status))
      .filter(p => (branchId ? p.branchId === branchId : !allowed?.length || allowed.includes(p.branchId)))
    return NextResponse.json({ purchases }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    // La orden de compra surte stock a la sucursal destino.
    const denied = assertBranchAllowed(session, body?.branchId)
    if (denied) return denied
    const result = await createPurchase(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
