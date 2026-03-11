import { NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const result = await requireAuth()
  if (result.error) return result.error
  const session = getSession(result)
  if (!session?.user?.id) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const userId = session.user.id

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditLimit: true, creditBalance: true },
  })
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  return NextResponse.json({
    creditLimit: user.creditLimit,
    creditBalance: user.creditBalance,
  })
}
