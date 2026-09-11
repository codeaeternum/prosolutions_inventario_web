import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { sell } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const body = await req.json()
    return NextResponse.json(await sell(prisma, getSession(auth)!.user.id, { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") }), { status: 201 })
  } catch (error) { return businessFailure(error) }
}
