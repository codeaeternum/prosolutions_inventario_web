import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAuth, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { creditAgingByUser } from "@/lib/credit-aging"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const summary = searchParams.get("summary")

  // Admin summary mode: returns metrics + debtors + recent movements
  if (summary === "true") {
    const adminResult = await requireModule("credito")
    if (adminResult.error) return adminResult.error
    const businessId = businessIdOf(getSession(adminResult)!)

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
          where: { businessId, creditBalance: { gt: 0 } },
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
    const debtorMovements = debtors.length
      ? await prisma.creditMovement.findMany({
          where: { businessId, userId: { in: debtors.map((d) => d.id) } },
          select: { userId: true, type: true, amount: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : []
    const agingByUser = creditAgingByUser(debtorMovements)
    const debtorsWithAging = debtors
      .map((d) => ({ ...d, aging: agingByUser.get(d.id) ?? null }))
      .sort(
        (a, b) =>
          (b.aging?.daysOverdue ?? -1) - (a.aging?.daysOverdue ?? -1) ||
          (b.creditBalance ?? 0) - (a.creditBalance ?? 0)
      )

    return NextResponse.json({
      totalDebt: totalDebtAgg._sum.creditBalance || 0,
      activeClients,
      monthPayments: monthPaymentsAgg._sum.amount || 0,
      businessName: business?.name ?? "",
      debtors: debtorsWithAging,
      movements,
    })
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
  })
}
