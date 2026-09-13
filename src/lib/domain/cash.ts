import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, amount, BusinessError, cents, openRegister, operation, operationKeySchema, resolveBranch } from "./operations"

const schema = z.object({
  idempotencyKey: operationKeySchema, action: z.enum(["OPEN", "CLOSE", "MOVEMENT"]),
  registerId: z.string().min(1).optional(), amount: z.number(),
  type: z.enum(["IN", "OUT"]).optional(), description: z.string().trim().max(1000).optional(),
  branchId: z.string().min(1).optional(),
})
export async function changeCash(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = schema.parse(raw)
  const value = amount(cents(input.amount, input.action !== "MOVEMENT"))
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: `CASH_${input.action}`, permission: "staff", payload: input }, async tx => {
    const user = await actor(tx, actorId, "staff")
    const branch = await resolveBranch(tx, input.branchId ?? user.homeBranchId)
    if (input.action === "OPEN") {
      if (await tx.cashRegister.count({ where: { status: "OPEN", branchId: branch.id } })) throw new BusinessError(`Ya hay una caja abierta en ${branch.name}.`, 409)
      return tx.cashRegister.create({ data: { businessId, initialAmount: value, openedById: actorId, branchId: branch.id } })
    }
    if (!input.registerId) throw new BusinessError("Identifica la caja que estás operando.")
    const register = await openRegister(tx, branch.id)
    if (register.id !== input.registerId) throw new BusinessError("La caja cambió. Actualiza la pantalla antes de continuar.", 409)
    if (input.action === "CLOSE") return tx.cashRegister.update({ where: { id: register.id }, data: { status: "CLOSED", finalAmount: value, closedById: actorId, closedAt: new Date(), notes: input.description } })
    if (!input.type || !input.description) throw new BusinessError("Indica el tipo y motivo del movimiento.")
    return tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: input.type, amount: value, description: input.description, referenceType: "MANUAL" } })
  })
}
