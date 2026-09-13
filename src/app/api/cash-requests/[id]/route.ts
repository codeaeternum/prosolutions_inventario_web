import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"
import { BusinessError, operation, operationKeySchema, transaction, type Transaction } from "@/lib/domain/operations"

// Decisión sobre una solicitud de gasto: solo ADMIN y nunca sobre la propia.
// APPROVE asienta el CashMovement OUT en la caja abierta de la sucursal.
const decideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: operationKeySchema.optional(),
})

const requestInclude = {
  branch: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.CashRequestInclude

async function decide(tx: Transaction, actorId: string, businessId: string, id: string, input: z.infer<typeof decideSchema>) {
  const request = await tx.cashRequest.findUnique({ where: { id } })
  if (!request || request.businessId !== businessId) throw new BusinessError("Solicitud no encontrada.", 404)
  if (request.requestedById === actorId) throw new BusinessError("No puedes autorizar tu propio gasto.", 403)
  if (request.status !== "PENDING") throw new BusinessError("La solicitud ya fue decidida.", 409)
  if (input.decision === "REJECT") {
    const rejected = await tx.cashRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionNote: input.note ?? null },
    })
    if (rejected.count !== 1) throw new BusinessError("La solicitud ya fue decidida.", 409)
    return { request: await tx.cashRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }) }
  }
  // APPROVE: requiere caja abierta en la sucursal de la solicitud.
  const register = await tx.cashRegister.findFirst({ where: { status: "OPEN", branchId: request.branchId }, orderBy: { openedAt: "desc" } })
  if (!register) throw new BusinessError("Abre la caja de la sucursal primero.", 409)
  const approved = await tx.cashRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "APPROVED", decidedById: actorId, decidedAt: new Date(), decisionNote: input.note ?? null },
  })
  if (approved.count !== 1) throw new BusinessError("La solicitud ya fue decidida.", 409)
  const movement = await tx.cashMovement.create({
    data: { businessId, registerId: register.id, userId: request.requestedById, type: "OUT", amount: request.amountCents / 100, description: `Gasto autorizado: ${request.concept}`, referenceType: "EXPENSE", referenceId: request.id },
  })
  const updated = await tx.cashRequest.update({ where: { id }, data: { cashMovementId: movement.id }, include: requestInclude })
  return { request: updated }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params
    const input = decideSchema.parse(await req.json())
    const key = input.idempotencyKey ?? req.headers.get("idempotency-key") ?? undefined
    const result = key
      ? await operation(prisma, { key, actorId, businessId, kind: "CASH_REQUEST_DECIDE", permission: "admin", payload: { id, ...input } }, tx => decide(tx, actorId, businessId, id, input))
      : await transaction(prisma, tx => decide(tx, actorId, businessId, id, input))
    return NextResponse.json(result)
  } catch (error) { return businessFailure(error) }
}
