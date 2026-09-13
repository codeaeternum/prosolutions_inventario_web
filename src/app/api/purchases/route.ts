import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { createPurchase, listPurchases } from "@/lib/domain/purchasing"
import { businessFailure } from "@/lib/domain/http"
import type { PurchaseStatus } from "@prisma/client"

const STATUSES: PurchaseStatus[] = ["DRAFT", "ORDERED", "RECEIVED", "CANCELLED"]

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const statusParam = new URL(request.url).searchParams.get("status")
    const status = STATUSES.includes(statusParam as PurchaseStatus) ? (statusParam as PurchaseStatus) : undefined

    const purchases = await listPurchases(prisma, businessId, status)
    return NextResponse.json({ purchases }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    const result = await createPurchase(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
