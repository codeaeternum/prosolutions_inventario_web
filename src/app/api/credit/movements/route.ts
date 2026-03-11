import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: NextRequest) {
  const result = await requireAuth()
  if (result.error) return result.error
  const session = getSession(result)
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
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
