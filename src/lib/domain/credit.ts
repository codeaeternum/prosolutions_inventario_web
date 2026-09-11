import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, addDebt, amount, BusinessError, cents, openRegister, operation, operationKeySchema } from "./operations"

const schema = z.object({
  idempotencyKey: operationKeySchema, userId: z.string().min(1), amount: z.number(), notes: z.string().max(500).optional(),
  paymentMethod: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]).default("EFECTIVO"),
})
export async function changeCredit(db: PrismaClient, actorId: string, kind: "DEBT" | "PAYMENT", raw: unknown) {
  const input = schema.parse(raw)
  const value = cents(input.amount)
  return operation(db, { key: input.idempotencyKey, actorId, kind: `CREDIT_${kind}`, permission: "admin", payload: input }, async tx => {
    const user = await actor(tx, input.userId)
    if (kind === "DEBT") {
      await addDebt(tx, user.id, value, { type: "MANUAL", notes: input.notes ?? "Cargo manual" })
      return { creditBalance: amount(cents(user.creditBalance, true) + value) }
    }
    const balance = cents(user.creditBalance, true)
    if (value > balance) throw new BusinessError("El abono supera la deuda. No se registró dinero ni se cambió el saldo.", 409)
    const register = input.paymentMethod === "EFECTIVO" ? await openRegister(tx) : null
    const movement = await tx.creditMovement.create({ data: { userId: user.id, type: "PAYMENT", amount: amount(value), referenceType: "MANUAL", notes: [input.notes, `Medio: ${input.paymentMethod}`].filter(Boolean).join(" · ") } })
    await tx.user.update({ where: { id: user.id }, data: { creditBalance: amount(balance - value) } })
    if (register) await tx.cashMovement.create({ data: { registerId: register.id, userId: actorId, type: "IN", amount: amount(value), referenceType: "CREDIT_PAYMENT", referenceId: movement.id, description: `Abono de cliente #${user.id}` } })
    return { creditBalance: amount(balance - value), movementId: movement.id }
  })
}
