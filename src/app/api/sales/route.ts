import { NextResponse } from "next/server"
import { assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { sell } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

export async function GET(req: Request) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const query = new URL(req.url).searchParams
    const page = Math.max(1, Math.min(1000, Number(query.get("page")) || 1))
    const branchId = query.get("branchId") || undefined
    const status = query.get("status")
    if (status && !["COMPLETED", "VOIDED"].includes(status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    // ?kind=WORKSHOP|RETAIL separa notas a taller de la venta al público.
    const kind = query.get("kind")
    if (kind && !["WORKSHOP", "RETAIL"].includes(kind)) return NextResponse.json({ error: "Tipo de venta inválido" }, { status: 400 })
    const where = { businessId: businessIdOf(getSession(auth)!), ...(branchId ? { branchId } : {}), ...(status ? { status: status as "COMPLETED" | "VOIDED" } : {}), ...(kind ? { kind: kind as "WORKSHOP" | "RETAIL" } : {}) }
    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where, take: 20, skip: (page - 1) * 20, orderBy: [{ number: "desc" }],
        include: {
          branch: { select: { id: true, name: true } },
          seller: { select: { id: true, name: true } },
          customer: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
          payments: { select: { id: true, method: true, amount: true, status: true, reference: true } },
        },
      }),
      prisma.sale.count({ where }),
    ])
    return NextResponse.json({ sales, total, page, totalPages: Math.max(1, Math.ceil(total / 20)) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await req.json()
    // La venta descuenta stock y cobra en la sucursal indicada o en la base del vendedor.
    const denied = await assertOperationBranch(session, body?.branchId)
    if (denied) return denied
    return NextResponse.json(await sell(prisma, session.user.id, businessIdOf(session), { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") }), { status: 201 })
  } catch (error) { return businessFailure(error) }
}
