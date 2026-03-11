import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { z } from "zod"

const patchSchema = z.object({
  creditLimit: z.number().min(0).nullable(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAdmin()
  if (result.error) return result.error

  const { id } = await params
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      creditLimit: true,
      creditBalance: true,
      creditMovements: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  })
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  return NextResponse.json(user)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAdmin()
  if (result.error) return result.error

  const { id } = await params
  const body = await req.json()
  const parse = patchSchema.safeParse(body)
  if (!parse.success) {
    return NextResponse.json(
      { error: parse.error.flatten().fieldErrors.creditLimit?.[0] ?? "Datos inválidos" },
      { status: 400 }
    )
  }

  const user = await prisma.user.update({
    where: { id },
    data: { creditLimit: parse.data.creditLimit },
    select: { id: true, creditLimit: true, creditBalance: true },
  })
  return NextResponse.json(user)
}
