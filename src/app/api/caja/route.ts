import { changeCash, expectedCashCents, registerPaymentWhere, type CashMovementLike } from "@/lib/domain/cash"
import { businessFailure } from "@/lib/domain/http"
import { NextResponse } from "next/server"
import { assertBranchAllowed, assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import prisma from "@/lib/prisma"

const METHODS = ["CASH", "CARD", "TRANSFER", "CREDIT"] as const

// Las respuestas de caja son datos de dinero por usuario/sucursal: nunca
// servibles desde un caché compartido (tableta de recepción, proxy LAN).
const NO_STORE = { "Cache-Control": "private, no-store" } as const

/** Totales cobrados por método durante el turno (neto: cobros − reembolsos). */
async function methodTotals(businessId: string, register: { branchId: string | null; openedAt: Date; closedAt: Date | null }) {
  // Los pagos con asiento de caja (efectivo) se atribuyen a la sucursal del
  // cajón donde se cobraron (cashMovement.register.branchId); los que no tocan
  // cajón (cashMovementId: null — tarjeta, transferencia, crédito) se acotan a
  // la sucursal del documento (venta, orden de taller o encargo), igual que en
  // /api/caja/movements. VOIDED entra en la suma: al anular una venta del mismo
  // turno el cobro positivo queda VOIDED y su reembolso REFUNDED (−X) — juntos
  // cancelan a 0.
  const rows = await prisma.payment.groupBy({
    by: ["method"],
    where: registerPaymentWhere(businessId, register),
    _sum: { amount: true },
  })
  const totals = Object.fromEntries(METHODS.map(m => [m, 0])) as Record<(typeof METHODS)[number], number>
  // _sum.amount es Float en pesos: se redondea el agregado a centavos exactos.
  for (const row of rows) totals[row.method] = Math.round((row._sum.amount ?? 0) * 100) / 100
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

/** Resumen del último turno cerrado: alcanza para la tarjeta de cuadre y para reimprimir el ticket (/admin/tickets/corte/[id]). */
function lastClosureOf(closed: { id: string; initialAmount: number; finalAmount: number | null; movements: CashMovementLike[] }) {
  const expectedCents = expectedCashCents(closed.initialAmount, closed.movements)
  const countedCents = closed.finalAmount == null ? expectedCents : Math.round(closed.finalAmount * 100)
  return {
    registerId: closed.id,
    counted: countedCents / 100,
    expected: expectedCents / 100,
    difference: (countedCents - expectedCents) / 100,
  }
}

export async function GET(req: Request) {
  try {
    const result = await requireModule("caja")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const url = new URL(req.url)
    const branchId = url.searchParams.get("branchId") || undefined
    // El filtro de sucursal se valida contra allowedBranchIds.
    const deniedBranch = assertBranchAllowed(session, branchId)
    if (deniedBranch) return deniedBranch
    // Sin filtro explícito, el empleado con sucursales asignadas solo ve las
    // cajas de las suyas (abierta y cortes de la semana).
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const branchScope = branchId ?? (allowed?.length ? { in: allowed } : undefined)

    // Vista semanal: cierres de los últimos 7 días con esperado y diferencia.
    if (url.searchParams.get("view") === "week") {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const registers = await prisma.cashRegister.findMany({
        where: { businessId, status: "CLOSED", closedAt: { gte: since }, ...(branchScope ? { branchId: branchScope } : {}) },
        orderBy: { closedAt: "desc" },
        take: 50,
        include: {
          branch: { select: { id: true, name: true } },
          openedBy: { select: { name: true } },
          closedBy: { select: { name: true } },
          movements: { select: { type: true, amount: true, payment: { select: { method: true, amount: true } } } },
        },
      })
      return NextResponse.json(
        {
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
        },
        { headers: NO_STORE },
      )
    }

    const [activeRegister, lastClosed] = await Promise.all([
      prisma.cashRegister.findFirst({
        where: { businessId, status: "OPEN", ...(branchScope ? { branchId: branchScope } : {}) },
        orderBy: { openedAt: "desc" },
        include: {
          branch: { select: { id: true, name: true } },
          openedBy: { select: { name: true } },
          closedBy: { select: { name: true } },
          movements: movementInclude
        }
      }),
      // Último cierre del mismo alcance de sucursal: permite reimprimir el
      // corte recién hecho aunque la página se haya recargado.
      prisma.cashRegister.findFirst({
        where: { businessId, status: "CLOSED", ...(branchScope ? { branchId: branchScope } : {}) },
        orderBy: { closedAt: "desc" },
        select: {
          id: true,
          initialAmount: true,
          finalAmount: true,
          movements: { select: { type: true, amount: true, payment: { select: { method: true, amount: true } } } },
        },
      }),
    ])
    const lastClosure = lastClosed ? lastClosureOf(lastClosed) : null

    if (!activeRegister) {
      return NextResponse.json({ active: false, lastClosure }, { headers: NO_STORE })
    }

    // initialAmount/amount son Float en pesos: la corrida se hace en centavos
    // y se expone en pesos, igual que expectedCashCents.
    const calculatedCents = activeRegister.movements.reduce((sum, mov) => {
      return mov.type === "IN" ? sum + Math.round(mov.amount * 100) : sum - Math.round(mov.amount * 100)
    }, Math.round(activeRegister.initialAmount * 100))
    const calculatedTotal = calculatedCents / 100

    return NextResponse.json(
      {
        active: true,
        register: {
          ...activeRegister,
          calculatedTotal,
          // Efectivo esperado real: solo movimientos que tocaron el cajón
          // (countsAsCash en domain/cash). Hoy coincide con calculatedTotal.
          expectedCash: expectedCashCents(activeRegister.initialAmount, activeRegister.movements as CashMovementLike[]) / 100,
          methodTotals: await methodTotals(businessId, activeRegister),
        },
        lastClosure,
      },
      { headers: NO_STORE },
    )
  } catch {
    return NextResponse.json({ error: "Error al obtener caja" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireModule("caja")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const body = await req.json()
    // Abrir/mover la caja toca la sucursal indicada o la base del cajero.
    const denied = await assertOperationBranch(session, body?.branchId)
    if (denied) return denied
    return NextResponse.json(await changeCash(prisma, session.user.id, businessIdOf(session), body))
  } catch (error) { return businessFailure(error) }
}
