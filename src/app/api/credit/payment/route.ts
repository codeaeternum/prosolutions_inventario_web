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

  const newBalance = Math.max(0, (user.creditBalance ?? 0) - amount)

  const [creditMov, _] = await prisma.$transaction([
    prisma.creditMovement.create({
      data: {
        userId,
        amount,
        type: "PAYMENT",
        referenceType: "MANUAL",
        notes: notes ?? null,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    }),
  ])

  // Ingresar dinero a caja si hay caja abierta
  const openRegister = await prisma.cashRegister.findFirst({
    where: { status: "OPEN" }
  })

  if (openRegister) {
    const sessionAuth = await requireAdmin()
    let adminId = user.id;
    const s = sessionAuth.session as any;
    if (!sessionAuth.error && s?.user?.id) {
      adminId = s.user.id;
    }

    await prisma.cashMovement.create({
      data: {
        registerId: openRegister.id,
        amount: amount,
        type: "IN",
        description: `Abono de Cliente: ${user.name}`,
        referenceType: "CREDIT_PAYMENT",
        referenceId: creditMov.id,
        userId: adminId
      }
    })
  }

  const updated = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  })
  return NextResponse.json({
    creditBalance: updated?.creditBalance ?? newBalance,
    message: "Abono registrado correctamente",
  })
}
