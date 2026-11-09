import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAuth, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { creditAgingByUser } from "@/lib/credit-aging"
import { prisma } from "@/lib/prisma"

const NO_STORE = { "Cache-Control": "private, no-store" } as const

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const summary = searchParams.get("summary")

  // Admin summary mode: returns metrics + debtors + recent movements
  if (summary === "true") {
    const adminResult = await requireModule("credito")
    if (adminResult.error) return adminResult.error
    const businessId = businessIdOf(getSession(adminResult)!)
    const q = searchParams.get("q")?.trim() ?? ""

    const firstDayOfMonth = new Date()
    firstDayOfMonth.setDate(1)
    firstDayOfMonth.setHours(0, 0, 0, 0)

    const [totalDebtAgg, activeClients, monthPaymentsAgg, debtors, movements, business] =
      await Promise.all([
        prisma.user.aggregate({
          _sum: { creditBalance: true },
          where: { businessId, creditBalance: { gt: 0 } },
        }),
        prisma.user.count({
          where: { businessId, creditBalance: { gt: 0 } },
        }),
        prisma.creditMovement.aggregate({
          _sum: { amount: true },
          where: {
            businessId,
            // Debt reversals reduce the balance but are not money collected.
            type: "PAYMENT",
            createdAt: { gte: firstDayOfMonth },
          },
        }),
        prisma.user.findMany({
          where: {
            businessId,
            creditBalance: { gt: 0 },
            ...(q && {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
              ],
            }),
          },
          select: {
            id: true,
            name: true,
            phone: true,
            creditLimit: true,
            creditBalance: true,
          },
          orderBy: { creditBalance: "desc" },
          take: 20,
        }),
        prisma.creditMovement.findMany({
          where: { businessId },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }),
      ])

    // Aging FIFO por deudor: los abonos cubren primero los cargos más viejos.
    // La ventana se acota a 24 meses y el historial anterior entra como saldo
    // de apertura agregado por usuario (groupBy), en vez de materializar
    // décadas de movimientos de los top-20 deudores.
    const AGE_WINDOW_MONTHS = 24
    const agingCutoff = new Date()
    agingCutoff.setMonth(agingCutoff.getMonth() - AGE_WINDOW_MONTHS)
    const debtorIds = debtors.map((d) => d.id)

    const [windowMovements, preWindowSums] = debtorIds.length
      ? await Promise.all([
          prisma.creditMovement.findMany({
            where: { businessId, userId: { in: debtorIds }, createdAt: { gte: agingCutoff } },
            select: { userId: true, type: true, amount: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          }),
          // Saldo de apertura: cargos positivos (los que el FIFO sí consume)
          // y todo abono/reverso previo a la ventana, por usuario.
          prisma.creditMovement.groupBy({
            by: ["userId", "type"],
            where: {
              businessId,
              userId: { in: debtorIds },
              createdAt: { lt: agingCutoff },
              OR: [{ type: { not: "DEBT" } }, { amount: { gt: 0 } }],
            },
            _sum: { amount: true },
          }),
        ])
      : [[], []]

    const opening = new Map<string, { debt: number; credits: number }>()
    for (const row of preWindowSums) {
      const o = opening.get(row.userId) ?? { debt: 0, credits: 0 }
      if (row.type === "DEBT") o.debt += row._sum.amount ?? 0
      else o.credits += row._sum.amount ?? 0
      opening.set(row.userId, o)
    }
    // Si los abonos viejos no alcanzan a cubrir los cargos viejos, el primer
    // DEBT descubierto —el que fija la antigüedad real— está antes del
    // cutoff: esos cargos sí se traen (solo DEBT positivo, solo de esos
    // usuarios) y el FIFO queda exacto.
    const uncoveredIds = [...opening.entries()]
      .filter(([, o]) => o.credits < o.debt)
      .map(([userId]) => userId)
    const oldDebts = uncoveredIds.length
      ? await prisma.creditMovement.findMany({
          where: { businessId, userId: { in: uncoveredIds }, type: "DEBT", amount: { gt: 0 }, createdAt: { lt: agingCutoff } },
          select: { userId: true, type: true, amount: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : []

    // Saldo de apertura como movimientos sintéticos: al cubierto le entra el
    // crédito neto (abonos − cargos ya saldados); al descubierto, sus abonos
    // íntegros (sus cargos reales vienen en oldDebts). Las fechas no importan
    // para los abonos — creditAging los suma, no los ordena.
    const openingMovements = [...opening.entries()].flatMap(([userId, o]) => {
      const net = o.credits - o.debt
      if (o.credits >= o.debt) {
        return net > 0 ? [{ userId, type: "PAYMENT" as const, amount: net, createdAt: agingCutoff }] : []
      }
      return o.credits > 0 ? [{ userId, type: "PAYMENT" as const, amount: o.credits, createdAt: agingCutoff }] : []
    })

    const agingByUser = creditAgingByUser([...oldDebts, ...openingMovements, ...windowMovements])
    const debtorsWithAging = debtors
      .map((d) => ({ ...d, aging: agingByUser.get(d.id) ?? null }))
      .sort(
        (a, b) =>
          (b.aging?.daysOverdue ?? -1) - (a.aging?.daysOverdue ?? -1) ||
          (b.creditBalance ?? 0) - (a.creditBalance ?? 0)
      )

    // Los _sum son Float en pesos: el agregado de Postgres puede arrastrar
    // epsilon binario, así que se redondea por centavos antes de exponerlo.
    const roundMoney = (value: number | null) => Math.round((value ?? 0) * 100) / 100
    return NextResponse.json({
      totalDebt: roundMoney(totalDebtAgg._sum.creditBalance),
      activeClients,
      monthPayments: roundMoney(monthPaymentsAgg._sum.amount),
      businessName: business?.name ?? "",
      debtors: debtorsWithAging,
      movements,
    }, { headers: NO_STORE })
  }

  // Client mode: returns own movements
  const result = await requireAuth()
  if (result.error) return result.error
  const session = getSession(result)
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const userId = session.user.id

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20))

  const [movements, total] = await Promise.all([
    prisma.creditMovement.findMany({
      where: { userId, businessId: businessIdOf(session) },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.creditMovement.count({ where: { userId, businessId: businessIdOf(session) } }),
  ])

  return NextResponse.json({
    movements,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  }, { headers: NO_STORE })
}
