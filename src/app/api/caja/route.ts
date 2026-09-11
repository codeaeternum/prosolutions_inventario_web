import { changeCash } from "@/lib/domain/cash"
import { businessFailure } from "@/lib/domain/http"
import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

export async function GET() {
  try {
    const result = await requireAdminOrEmployee()
    if (result.error) return result.error

    const activeRegister = await prisma.cashRegister.findFirst({
      where: { status: "OPEN" },
      include: {
        openedBy: { select: { name: true } },
        movements: {
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { name: true } } }
        }
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
        calculatedTotal
      }
    })
  } catch (error) {
    return NextResponse.json({ error: "Error al obtener caja" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    return NextResponse.json(await changeCash(prisma, getSession(auth)!.user.id, await req.json()))
  } catch (error) { return businessFailure(error) }
}
