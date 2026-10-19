import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAdmin, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { money, recordAudit } from "@/lib/audit"
import { z } from "zod"

const patchSchema = z.object({
  // Tope razonable: finito, no negativo y ≤ $10,000,000 — un límite absurdo
  // (Infinity, negativos) deja el fiado sin freno real.
  creditLimit: z
    .number()
    .finite()
    .min(0, "El límite de crédito no puede ser negativo")
    .max(10_000_000, "El límite de crédito no puede ser mayor a $10,000,000")
    .nullable(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireModule("credito")
  if (result.error) return result.error
  const businessId = businessIdOf(getSession(result)!)

  const { id } = await params
  const user = await prisma.user.findUnique({
    where: { id, businessId },
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
  // Mover el límite de crédito es decisión del dueño: un empleado del módulo
  // podría inflar cuánto puede deber cualquier cliente. El GET sí queda
  // abierto al módulo (consulta de saldo/movimientos).
  const result = await requireAdmin()
  if (result.error) return result.error
  const session = getSession(result)!
  const businessId = businessIdOf(session)

  const { id } = await params
  const body = await req.json()
  const parse = patchSchema.safeParse(body)
  if (!parse.success) {
    return NextResponse.json(
      { error: parse.error.flatten().fieldErrors.creditLimit?.[0] ?? "Datos inválidos" },
      { status: 400 }
    )
  }

  const existing = await prisma.user.findFirst({
    where: { id, businessId },
    select: { id: true, name: true, creditLimit: true, creditBalance: true },
  })
  if (!existing) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })

  // Un límite por debajo de la deuda viva deja la cuenta en estado inválido:
  // el cliente quedaría "sobre-endeudado" sin que nadie lo registre.
  const newLimit = parse.data.creditLimit
  const balance = existing.creditBalance ?? 0
  if (newLimit !== null && Math.round(newLimit * 100) < Math.round(balance * 100)) {
    return NextResponse.json(
      { error: `El nuevo límite queda por debajo de la deuda actual ($${balance.toLocaleString("es-MX")}). Reduce primero el saldo con un abono.` },
      { status: 400 }
    )
  }

  const user = await prisma.user.update({
    where: { id },
    data: { creditLimit: newLimit },
    select: { id: true, creditLimit: true, creditBalance: true },
  })

  // Bitácora: el límite de crédito decide cuánto puede deber el cliente.
  if (existing.creditLimit !== newLimit) {
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "CUSTOMER_UPDATE",
      entity: "customer",
      entityId: id,
      entityName: existing.name,
      summary: `Límite de crédito ${existing.creditLimit == null ? "sin límite" : money(existing.creditLimit)} → ${newLimit == null ? "sin límite" : money(newLimit)}`,
      changes: { limiteCredito: { before: existing.creditLimit, after: newLimit } },
    })
  }
  return NextResponse.json(user)
}
