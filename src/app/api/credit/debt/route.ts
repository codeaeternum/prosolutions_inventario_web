import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const postSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive("El monto debe ser mayor a 0"),
  notes: z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const result = await requireAdmin()
  if (result.error) return result.error

  const body = await req.json()
  const parse = postSchema.safeParse(body)
  if (!parse.success) {
    const msg =
      parse.error.flatten().fieldErrors.amount?.[0] ??
      parse.error.flatten().fieldErrors.userId?.[0] ??
      "Datos inválidos"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const { userId, amount, notes } = parse.data

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  // Validar límite de crédito
  const currentBalance = user.creditBalance ?? 0
  const limit = user.creditLimit

  if (limit == null) {
    return NextResponse.json(
      { error: "Este usuario no tiene línea de crédito asignada." },
      { status: 400 }
    )
  }

  if (currentBalance + amount > limit) {
    return NextResponse.json(
      {
        error: `Supera el límite de crédito. Saldo actual: $${currentBalance.toLocaleString()}, Límite: $${limit.toLocaleString()}, Monto: $${amount.toLocaleString()}`,
      },
      { status: 400 }
    )
  }

  const newBalance = currentBalance + amount

  await prisma.$transaction([
    prisma.creditMovement.create({
      data: {
        userId,
        amount,
        type: "DEBT",
        referenceType: "MANUAL",
        notes: notes ?? null,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    }),
  ])

  return NextResponse.json({
    creditBalance: newBalance,
    message: "Cargo registrado correctamente",
  })
}
