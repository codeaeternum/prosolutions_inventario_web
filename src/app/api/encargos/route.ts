import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createEncargo, isEncargoStatus, listEncargos } from "@/lib/domain/encargos"
import { businessFailure } from "@/lib/domain/http"

/**
 * Encargos de clientes: piezas que el cliente pide y no hay en stock.
 * (La lista de compras para el almacén — faltantes, stock bajo, insumos —
 * vive en /api/encargos/compras.)
 */

// GET /api/encargos?status=&branchId= — lista del tenant, activos primero.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const params = new URL(request.url).searchParams
    const status = params.get("status") || undefined
    const branchId = params.get("branchId") || undefined
    if (status && !isEncargoStatus(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    }
    const denied = assertBranchAllowed(session, branchId)
    if (denied) return denied

    // Sucursal base del empleado: la UI la fija en el formulario de alta.
    const me = session.user.role === "EMPLOYEE"
      ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { homeBranchId: true } })
      : null

    // Empleado con sucursales asignadas: sin filtro explícito solo ve los
    // encargos de las suyas (listEncargos acota por UNA sucursal; el recorte
    // multi-sucursal va aquí).
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const encargos = (await listEncargos(prisma, businessId, { status, branchId }))
      .filter(e => !allowed?.length || (e.branchId != null && allowed.includes(e.branchId)))
    return NextResponse.json(
      { encargos, viewer: { role: session.user.role, homeBranchId: me?.homeBranchId ?? null } },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}

// POST /api/encargos — alta de encargo { description, quantity?, deposit?,
// customerId?, productId?, branchId?, supplierNote?, idempotencyKey }.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    // Mismo guard que caja/compras: un empleado restringido no puede registrar
    // en una sucursal que no tiene asignada (dominio además fija homeBranchId).
    const denied = await assertOperationBranch(session, body?.branchId)
    if (denied) return denied
    const result = await createEncargo(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
