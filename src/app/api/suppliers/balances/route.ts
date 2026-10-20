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
    const session = getSession(auth)!
    // Saldos derivados de OCs por sucursal: se recortan a las asignadas.
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const balances = await supplierBalances(prisma, businessIdOf(session), allowed)
    return NextResponse.json({ balances }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return businessFailure(error)
  }
}
