import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, addDebt, amount, BusinessError, cents, openRegister, operation, operationKeySchema } from "./operations"

const schema = z.object({
  idempotencyKey: operationKeySchema, userId: z.string().min(1), amount: z.number(), notes: z.string().max(500).optional(),
  paymentMethod: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]).default("EFECTIVO"),
  // Folio/autorización del abono no-efectivo (SPEI, terminal): sin él el abono
  // reduce deuda sin dejar rastro de dinero — regla espejo de checkSalePayments.
  reference: z.string().trim().max(200).optional(),
  // Sucursal donde se cobra el abono en efectivo; sin ella cae a la caja de la
  // sucursal base del cobrador (homeBranchId), nunca siempre a la principal.
  branchId: z.string().min(1).optional(),
})
export async function changeCredit(db: PrismaClient, actorId: string, businessId: string, kind: "DEBT" | "PAYMENT", raw: unknown) {
  const input = schema.parse(raw)
  const value = cents(input.amount)
  // Un abono por tarjeta/transferencia sin referencia es dinero sin rastro:
  // cualquiera podría "cobrar" y borrar deuda sin comprobante. El efectivo se
  // verifica contra caja; los demás medios exigen folio (mínimo 4 caracteres).
  if (kind === "PAYMENT" && input.paymentMethod !== "EFECTIVO" && (input.reference ?? "").length < 4) {
    throw new BusinessError("Captura la referencia del abono (mínimo 4 caracteres).", 400)
  }
  // En mostrador el staff cobra abonos; cargar deuda o mover límites sí es de admin.
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: `CREDIT_${kind}`, permission: kind === "PAYMENT" ? "staff" : "admin", payload: input }, async tx => {
    const user = await actor(tx, input.userId, "customer", businessId)
    if (kind === "DEBT") {
      await addDebt(tx, user.id, value, { type: "MANUAL", notes: input.notes ?? "Cargo manual" }, businessId)
      return { creditBalance: amount(cents(user.creditBalance, true) + value) }
    }
    const balance = cents(user.creditBalance, true)
    if (value > balance) throw new BusinessError("El abono supera la deuda. No se registró dinero ni se cambió el saldo.", 409)
    const collector = await actor(tx, actorId, "staff", businessId)
    const register = input.paymentMethod === "EFECTIVO" ? await openRegister(tx, input.branchId ?? collector.homeBranchId, businessId) : null
    const movement = await tx.creditMovement.create({ data: {
      businessId: user.businessId, userId: user.id, type: "PAYMENT", amount: amount(value), referenceType: "MANUAL",
      notes: [input.notes, `Medio: ${input.paymentMethod}`, input.reference ? `Ref: ${input.reference}` : null].filter(Boolean).join(" · "),
    } })
    await tx.user.update({ where: { id: user.id }, data: { creditBalance: amount(balance - value) } })
    if (register) await tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: "IN", amount: amount(value), referenceType: "CREDIT_PAYMENT", referenceId: movement.id, description: `Abono de cliente #${user.id}` } })
    return { creditBalance: amount(balance - value), movementId: movement.id }
  })
}
