import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { supplierBalances } from "@/lib/domain/supplier-payments"
import { businessFailure } from "@/lib/domain/http"

/** Cuentas por pagar: saldo derivado por proveedor + OCs pendientes de liquidar. */
export async function GET() {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const balances = await supplierBalances(prisma, businessIdOf(getSession(auth)!))
    return NextResponse.json({ balances }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}
