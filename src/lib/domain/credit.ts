import type { PrismaClient } from "@/generated/prisma/client"
import { z } from "zod"
import { actor, addDebt, amount, BusinessError, cents, openRegister, operation, operationKeySchema, resolveBranch } from "./operations"
import { CREDIT_PAYMENT_PURPOSE } from "./cash"

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
    // El abono lo cobra el mostrador AUNQUE el cliente esté suspendido o sin
    // aprobar: bloquear su pago también bloquearía la cobranza — lo contrario
    // del objetivo del freno. PAYMENT solo exige que la cuenta sea un cliente
    // DEL negocio (el 403 genérico no revela si existe en otro tenant); el
    // CARGO de deuda sí exige APPROVED: actor() y addDebt lo validan.
    const user = kind === "PAYMENT"
      ? await tx.user.findFirst({ where: { id: input.userId, businessId, role: { in: ["CUSTOMER", "WORKSHOP"] } } })
      : await actor(tx, input.userId, "customer", businessId)
    if (!user) throw new BusinessError("La cuenta no está autorizada para operar.", 403, "ACCOUNT_NOT_APPROVED")
    if (kind === "DEBT") {
      await addDebt(tx, user.id, value, { type: "MANUAL", notes: input.notes ?? "Cargo manual" }, businessId)
      return { creditBalance: amount(cents(user.creditBalance, true) + value) }
    }
    const balance = cents(user.creditBalance, true)
    if (value > balance) throw new BusinessError("El abono supera la deuda. No se registró dinero ni se cambió el saldo.", 409)
    const collector = await actor(tx, actorId, "staff", businessId)
    const register = input.paymentMethod === "EFECTIVO" ? await openRegister(tx, input.branchId ?? collector.homeBranchId, businessId) : null
    // En efectivo la sucursal real es la del cajón; en tarjeta/transferencia
    // no hay cajón físico, así que se atribuye a la sucursal operativa
    // explícita/base del cobrador para que "Cobrado por método" pueda
    // conciliarla. Va en la columna Payment.branchId (antes tag en notes).
    const collectionBranchId = register?.branchId ?? (await resolveBranch(tx, input.branchId ?? collector.homeBranchId, businessId)).id
    const movement = await tx.creditMovement.create({ data: {
      businessId: user.businessId, userId: user.id, type: "PAYMENT", amount: amount(value), referenceType: "MANUAL",
      notes: [input.notes, `Medio: ${input.paymentMethod}`, input.reference ? `Ref: ${input.reference}` : null].filter(Boolean).join(" · "),
    } })
    await tx.user.update({ where: { id: user.id }, data: { creditBalance: amount(balance - value) } })
    const cashIn = register
      ? await tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: "IN", amount: amount(value), referenceType: "CREDIT_PAYMENT", referenceId: movement.id, description: `Abono de cliente #${user.id}` } })
      : null
    // Comprobante estructurado del dinero. CreditMovement sigue siendo el
    // asiento de deuda; Payment es lo que entienden los cortes/métodos. El
    // vínculo cashMovementId evita duplicar el efectivo (el pago no aparece
    // como fila adicional en el feed de pagos).
    const methodMap = { EFECTIVO: "CASH", TARJETA: "CARD", TRANSFERENCIA: "TRANSFER" } as const
    const payment = await tx.payment.create({ data: {
      businessId,
      purpose: CREDIT_PAYMENT_PURPOSE,
      method: methodMap[input.paymentMethod],
      amount: amount(value),
      status: "CONFIRMED",
      reference: input.reference ?? null,
      cashMovementId: cashIn?.id ?? null,
      // Ligadura estructurada: el asiento de deuda y la sucursal de cobro son
      // columnas reales — los tags [credit-movement:…]/[branch:…] en notes
      // fueron la convención transitoria de Oleada 45 y los pagos históricos
      // quedaron migrados en payment_credit_branch.
      creditMovementId: movement.id,
      branchId: collectionBranchId,
      createdById: actorId,
      notes: [`Abono de ${user.name}`, input.notes].filter(Boolean).join(" · "),
    } })
    return { creditBalance: amount(balance - value), movementId: movement.id, paymentId: payment.id }
  })
}
