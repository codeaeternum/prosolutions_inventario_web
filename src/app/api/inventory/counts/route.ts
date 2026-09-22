import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { countFolio, createCount, listCounts } from "@/lib/domain/counts"
import { businessFailure } from "@/lib/domain/http"
import type { CountStatus } from "@prisma/client"

const STATUSES: CountStatus[] = ["OPEN", "APPLIED", "CANCELLED"]

/** Lista de sesiones de conteo con sucursal, estado, # items y # diferencias. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const params = new URL(request.url).searchParams
    const statusParam = params.get("status")
    const status = STATUSES.includes(statusParam as CountStatus) ? (statusParam as CountStatus) : undefined
    const branchId = params.get("branchId") || undefined

    // Empleado con sucursales asignadas: solo ve los conteos de las suyas.
    // Pedir una sucursal ajena devuelve lista vacía ({ in: [] } no matchea).
    const session = getSession(auth)!
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const restricted = !!(allowed && allowed.length > 0)
    const branchFilter = restricted
      ? branchId
        ? (allowed!.includes(branchId) ? branchId : { in: [] as string[] })
        : { in: allowed! }
      : branchId

    const counts = await listCounts(prisma, businessId, { status, branchId: branchFilter })
    return NextResponse.json(
      {
        counts: counts.map(c => ({
          id: c.id,
          number: c.number,
          folio: countFolio(c.number),
          status: c.status,
          blind: c.blind,
          notes: c.notes,
          branch: c.branch,
          createdBy: c.createdBy,
          appliedAt: c.appliedAt,
          createdAt: c.createdAt,
          itemCount: c.items.length,
          // Conteo ciego en captura: no se expone ni el agregado de diferencias.
          diffCount: c.blind && c.status === "OPEN" ? null : c.items.filter(i => i.countedQty !== i.expectedQty).length,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}

/** Crea una sesión de conteo OPEN: { branchId, notes?, blind? }. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    // El conteo ajusta existencias de la sucursal contada.
    const denied = assertBranchAllowed(session, body?.branchId)
    if (denied) return denied
    const result = await createCount(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
