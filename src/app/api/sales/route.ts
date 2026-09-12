import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { sell } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const query = new URL(req.url).searchParams
    const page = Math.max(1, Math.min(1000, Number(query.get("page")) || 1))
    const branchId = query.get("branchId") || undefined
    const status = query.get("status")
    if (status && !["COMPLETED", "VOIDED"].includes(status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    const where = { ...(branchId ? { branchId } : {}), ...(status ? { status: status as "COMPLETED" | "VOIDED" } : {}) }
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
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const body = await req.json()
    return NextResponse.json(await sell(prisma, getSession(auth)!.user.id, { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") }), { status: 201 })
  } catch (error) { return businessFailure(error) }
}
