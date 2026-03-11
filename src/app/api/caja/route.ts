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
    const result = await requireAdminOrEmployee()
    if (result.error) return result.error
    const session = getSession(result)!
    const user = session.user

    const body = await req.json()
    const { action, amount, description } = body

    if (action === "OPEN") {
      const existing = await prisma.cashRegister.findFirst({ where: { status: "OPEN" } })
      if (existing) return NextResponse.json({ error: "Ya hay una caja abierta" }, { status: 400 })

      const newRegister = await prisma.cashRegister.create({
        data: {
          initialAmount: amount || 0,
          status: "OPEN",
          openedById: user.id
        }
      })
      return NextResponse.json(newRegister)
    }

    if (action === "CLOSE") {
      const existing = await prisma.cashRegister.findFirst({ where: { status: "OPEN" } })
      if (!existing) return NextResponse.json({ error: "No hay caja abierta" }, { status: 400 })

      const closed = await prisma.cashRegister.update({
        where: { id: existing.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedById: user.id,
          finalAmount: amount || 0,
          notes: description
        }
      })
      return NextResponse.json(closed)
    }

    if (action === "MOVEMENT") {
      const existing = await prisma.cashRegister.findFirst({ where: { status: "OPEN" } })
      if (!existing) return NextResponse.json({ error: "No hay caja abierta" }, { status: 400 })

      const { type, referenceType, referenceId } = body
      if (!type || !amount || !description) return NextResponse.json({ error: "Faltan datos" }, { status: 400 })

      const mov = await prisma.cashMovement.create({
        data: {
          registerId: existing.id,
          amount: parseFloat(amount),
          type,
          description,
          userId: user.id,
          referenceType,
          referenceId
        }
      })
      return NextResponse.json(mov)
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 })
  } catch (error) {
    console.error("Caja Error:", error)
    return NextResponse.json({ error: "Error en servidor" }, { status: 500 })
  }
}
