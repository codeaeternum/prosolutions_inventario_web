import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { supplierAging } from "@/lib/domain/supplier-payments"
import { businessFailure } from "@/lib/domain/http"

/** Antigüedad de saldos por proveedor (cuentas por pagar, solo lectura). */
export async function GET() {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const aging = await supplierAging(prisma, businessIdOf(getSession(auth)!))
    return NextResponse.json(aging, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}
