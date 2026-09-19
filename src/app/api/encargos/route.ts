import { NextResponse, type NextRequest } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { addShoppingItem, listShoppingNeeds } from "@/lib/domain/shopping"
import { businessFailure } from "@/lib/domain/http"

/** Lista de encargos: refacciones faltantes, stock bajo e insumos manuales. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const branchId = new URL(request.url).searchParams.get("branchId") || undefined
    const needs = await listShoppingNeeds(prisma, businessId, branchId)
    return NextResponse.json(needs, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}

/** Alta de un insumo manual en la lista. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await request.json()
    const result = await addShoppingItem(prisma, session.user.id, businessIdOf(session), {
      ...body,
      idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"),
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return businessFailure(error)
  }
}
