import { NextResponse, type NextRequest } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { addShoppingItem, listShoppingNeeds } from "@/lib/domain/shopping"
import { businessFailure } from "@/lib/domain/http"
import { getOrderFolioDigits } from "@/lib/settings"

/**
 * Lista de compras del almacén ("qué debo comprar"): refacciones faltantes en
 * órdenes abiertas, stock bajo e insumos manuales. Antes vivía en
 * /api/encargos; se movió aquí cuando /api/encargos pasó a ser el recurso de
 * encargos de clientes.
 */

/** Lista de compras: refacciones faltantes, stock bajo e insumos manuales. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModule("inventario")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const branchId = new URL(request.url).searchParams.get("branchId") || undefined
    // El filtro de sucursal se valida contra allowedBranchIds: sin el assert un
    // empleado restringido consultaba faltantes y stock de sucursales ajenas.
    const denied = assertBranchAllowed(session, branchId)
    if (denied) return denied
    // El folio de cada orden sale con los dígitos del negocio (order_folio_digits).
    const needs = await listShoppingNeeds(prisma, businessId, branchId, await getOrderFolioDigits(businessId))
    // El costo revela el margen real: solo el ADMIN lo ve (misma regla que
    // productDto); el empleado conserva cantidades y sugeridos para surtir.
    const stripCost = <T extends { costPrice: number | null }>(row: T) => {
      const clone = { ...row } as Partial<T>
      delete clone.costPrice
      return clone
    }
    const payload = session.user.role === "ADMIN" ? needs : {
      ...needs,
      partsShortage: needs.partsShortage.map(stripCost),
      lowStock: needs.lowStock.map(stripCost),
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } })
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
