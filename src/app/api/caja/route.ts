import { changeCash } from "@/lib/domain/cash"
import { businessFailure } from "@/lib/domain/http"
import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import prisma from "@/lib/prisma"

export async function GET(req: Request) {
  try {
    const result = await requireAdminOrEmployee()
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const branchId = new URL(req.url).searchParams.get("branchId") || undefined
    const activeRegister = await prisma.cashRegister.findFirst({
      where: { businessId, status: "OPEN", ...(branchId ? { branchId } : {}) },
      orderBy: { openedAt: "desc" },
      include: {
        branch: { select: { id: true, name: true } },
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
