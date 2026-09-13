import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { countFolio, createCount, listCounts } from "@/lib/domain/counts"
import { businessFailure } from "@/lib/domain/http"
import type { CountStatus } from "@prisma/client"

const STATUSES: CountStatus[] = ["OPEN", "APPLIED", "CANCELLED"]

/** Lista de sesiones de conteo con sucursal, estado, # items y # diferencias. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const params = new URL(request.url).searchParams
    const statusParam = params.get("status")
    const status = STATUSES.includes(statusParam as CountStatus) ? (statusParam as CountStatus) : undefined
    const branchId = params.get("branchId") || undefined

    const counts = await listCounts(prisma, businessId, { status, branchId })
    return NextResponse.json(
      {
        counts: counts.map(c => ({
          id: c.id,
          number: c.number,
          folio: countFolio(c.number),
          status: c.status,
          notes: c.notes,
          branch: c.branch,
          createdBy: c.createdBy,
          appliedAt: c.appliedAt,
          createdAt: c.createdAt,
          itemCount: c.items.length,
          diffCount: c.items.filter(i => i.countedQty !== i.expectedQty).length,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}

/** Crea una sesión de conteo OPEN: { branchId, notes? }. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    const result = await createCount(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
