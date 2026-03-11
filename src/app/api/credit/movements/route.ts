import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAuth, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const summary = searchParams.get("summary")

  // Admin summary mode: returns metrics + debtors + recent movements
  if (summary === "true") {
    const adminResult = await requireAdmin()
    if (adminResult.error) return adminResult.error

    const firstDayOfMonth = new Date()
    firstDayOfMonth.setDate(1)
    firstDayOfMonth.setHours(0, 0, 0, 0)

    const [totalDebtAgg, activeClients, monthPaymentsAgg, debtors, movements] =
      await Promise.all([
        prisma.user.aggregate({
          _sum: { creditBalance: true },
          where: { creditBalance: { gt: 0 } },
        }),
        prisma.user.count({
          where: { creditBalance: { gt: 0 } },
        }),
        prisma.creditMovement.aggregate({
          _sum: { amount: true },
          where: {
            type: "PAYMENT",
            createdAt: { gte: firstDayOfMonth },
          },
        }),
        prisma.user.findMany({
          where: { creditBalance: { gt: 0 } },
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
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ])

    return NextResponse.json({
      totalDebt: totalDebtAgg._sum.creditBalance || 0,
      activeClients,
      monthPayments: monthPaymentsAgg._sum.amount || 0,
      debtors,
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
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.creditMovement.count({ where: { userId } }),
  ])

  return NextResponse.json({
    movements,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  })
}
