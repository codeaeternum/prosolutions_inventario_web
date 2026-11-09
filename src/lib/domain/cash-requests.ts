import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, BusinessError, operation, operationKeySchema, registerCashCents, transaction, type Transaction } from "./operations"

// Decisión sobre una solicitud de gasto: solo ADMIN y nunca sobre la propia.
// APPROVE asienta el CashMovement OUT en la caja abierta de la sucursal.
export const decideCashRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: operationKeySchema.optional(),
})

export type DecideCashRequestInput = z.infer<typeof decideCashRequestSchema>

const requestInclude = {
  branch: { select: { id: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
} satisfies Prisma.CashRequestInclude

async function decide(tx: Transaction, actorId: string, businessId: string, id: string, input: DecideCashRequestInput) {
  await actor(tx, actorId, "admin", businessId)
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
  // APPROVE: requiere caja abierta en la sucursal de la solicitud y efectivo
  // suficiente — aprobar de más dejaría la caja en negativo (dinero ficticio).
  const register = await tx.cashRegister.findFirst({ where: { status: "OPEN", branchId: request.branchId, businessId }, orderBy: { openedAt: "desc" } })
  if (!register) throw new BusinessError("Abre la caja de la sucursal primero.", 409)
  const availableCents = await registerCashCents(tx, register.id)
  if (request.amountCents > availableCents) throw new BusinessError(`La caja solo tiene $${(availableCents / 100).toFixed(2)}; no alcanza para autorizar este gasto.`, 409, "INSUFFICIENT_CASH")
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

/** Decide una solicitud de gasto en efectivo (APPROVE / REJECT) con recibo idempotente opcional. */
export async function decideCashRequest(
  db: PrismaClient,
  actorId: string,
  businessId: string,
  id: string,
  raw: unknown,
  idempotencyKey?: string,
) {
  const input = decideCashRequestSchema.parse(raw)
  const key = input.idempotencyKey ?? idempotencyKey
  return key
    ? operation(db, { key, actorId, businessId, kind: "CASH_REQUEST_DECIDE", permission: "admin", payload: { id, ...input } }, tx => decide(tx, actorId, businessId, id, input))
    : transaction(db, tx => decide(tx, actorId, businessId, id, input))
}
