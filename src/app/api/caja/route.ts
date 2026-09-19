import { changeCash, expectedCashCents, type CashMovementLike } from "@/lib/domain/cash"
import { businessFailure } from "@/lib/domain/http"
import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import prisma from "@/lib/prisma"

const METHODS = ["CASH", "CARD", "TRANSFER", "CREDIT"] as const

/** Totales cobrados por método durante el turno (neto: cobros − reembolsos). */
async function methodTotals(businessId: string, register: { branchId: string | null; openedAt: Date; closedAt: Date | null }) {
  // Los pagos no llevan registerId: se acotan a la ventana apertura→cierre y a
  // la sucursal de la caja vía su venta u orden de taller. Un pago de tarjeta o
  // transferencia no genera CashMovement, así que este total no sale de los
  // movimientos sino directo de Payment.
  const rows = await prisma.payment.groupBy({
    by: ["method"],
    where: {
      businessId,
      status: { in: ["CONFIRMED", "REFUNDED"] },
      createdAt: { gte: register.openedAt, ...(register.closedAt ? { lte: register.closedAt } : {}) },
      ...(register.branchId
        ? { OR: [{ sale: { branchId: register.branchId } }, { repairOrder: { currentBranchId: register.branchId } }] }
        : {}),
    },
    _sum: { amount: true },
  })
  const totals = Object.fromEntries(METHODS.map(m => [m, 0])) as Record<(typeof METHODS)[number], number>
  for (const row of rows) totals[row.method] = row._sum.amount ?? 0
  return totals
}

const movementInclude = {
  orderBy: { createdAt: "desc" as const },
  include: {
    user: { select: { name: true } },
    // Método del pago documentado; null en movimientos manuales.
    payment: { select: { method: true, amount: true } },
  },
}

export async function GET(req: Request) {
  try {
    const result = await requireAdminOrEmployee()
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const url = new URL(req.url)
    const branchId = url.searchParams.get("branchId") || undefined

    // Vista semanal: cierres de los últimos 7 días con esperado y diferencia.
    if (url.searchParams.get("view") === "week") {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const registers = await prisma.cashRegister.findMany({
        where: { businessId, status: "CLOSED", closedAt: { gte: since }, ...(branchId ? { branchId } : {}) },
        orderBy: { closedAt: "desc" },
        take: 50,
        include: {
          branch: { select: { id: true, name: true } },
          openedBy: { select: { name: true } },
          closedBy: { select: { name: true } },
          movements: { select: { type: true, amount: true, payment: { select: { method: true, amount: true } } } },
        },
      })
      return NextResponse.json({
        view: "week",
        registers: registers.map(register => {
          const expectedCents = expectedCashCents(register.initialAmount, register.movements as CashMovementLike[])
          const countedCents = register.finalAmount == null ? null : Math.round(register.finalAmount * 100)
          return {
            id: register.id,
            branch: register.branch,
            openedAt: register.openedAt,
            closedAt: register.closedAt,
            openedBy: register.openedBy,
            closedBy: register.closedBy,
            initialAmount: register.initialAmount,
            finalAmount: register.finalAmount,
            expectedCash: expectedCents / 100,
            difference: countedCents == null ? null : (countedCents - expectedCents) / 100,
            notes: register.notes,
          }
        }),
      })
    }

    const activeRegister = await prisma.cashRegister.findFirst({
      where: { businessId, status: "OPEN", ...(branchId ? { branchId } : {}) },
      orderBy: { openedAt: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
        openedBy: { select: { name: true } },
        closedBy: { select: { name: true } },
        movements: movementInclude
      }
    })

    if (!activeRegister) {
      return NextResponse.json({ active: false })
    }

    const calculatedTotal = activeRegister.movements.reduce((sum, mov) => {
      return mov.type === "IN" ? sum + mov.amount : sum - mov.amount
    }, activeRegister.initialAmount)

    return NextResponse.json({
      active: true,
      register: {
        ...activeRegister,
        calculatedTotal,
        // Efectivo esperado real: solo movimientos que tocaron el cajón
        // (countsAsCash en domain/cash). Hoy coincide con calculatedTotal.
        expectedCash: expectedCashCents(activeRegister.initialAmount, activeRegister.movements as CashMovementLike[]) / 100,
        methodTotals: await methodTotals(businessId, activeRegister),
      }
    })
  } catch {
    return NextResponse.json({ error: "Error al obtener caja" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    return NextResponse.json(await changeCash(prisma, session.user.id, businessIdOf(session), await req.json()))
  } catch (error) { return businessFailure(error) }
}
