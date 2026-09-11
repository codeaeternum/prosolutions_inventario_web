import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { amount, BusinessError, cents, openRegister, operation, operationKeySchema } from "./operations"

const schema = z.object({
  idempotencyKey: operationKeySchema, action: z.enum(["OPEN", "CLOSE", "MOVEMENT"]),
  registerId: z.string().min(1).optional(), amount: z.number(),
  type: z.enum(["IN", "OUT"]).optional(), description: z.string().trim().max(1000).optional(),
})
export async function changeCash(db: PrismaClient, actorId: string, raw: unknown) {
  const input = schema.parse(raw)
  const value = amount(cents(input.amount, input.action !== "MOVEMENT"))
  return operation(db, { key: input.idempotencyKey, actorId, kind: `CASH_${input.action}`, permission: "staff", payload: input }, async tx => {
    if (input.action === "OPEN") {
      if (await tx.cashRegister.count({ where: { status: "OPEN" } })) throw new BusinessError("Ya hay una caja abierta.", 409)
      return tx.cashRegister.create({ data: { initialAmount: value, openedById: actorId } })
    }
    if (!input.registerId) throw new BusinessError("Identifica la caja que estás operando.")
    const register = await openRegister(tx)
    if (register.id !== input.registerId) throw new BusinessError("La caja cambió. Actualiza la pantalla antes de continuar.", 409)
    if (input.action === "CLOSE") return tx.cashRegister.update({ where: { id: register.id }, data: { status: "CLOSED", finalAmount: value, closedById: actorId, closedAt: new Date(), notes: input.description } })
    if (!input.type || !input.description) throw new BusinessError("Indica el tipo y motivo del movimiento.")
    return tx.cashMovement.create({ data: { registerId: register.id, userId: actorId, type: input.type, amount: value, description: input.description, referenceType: "MANUAL" } })
  })
}
