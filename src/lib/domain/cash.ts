import type { CashMovement, CashRegister, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, amount, BusinessError, cents, openRegister, operation, operationKeySchema, registerCashCents, resolveBranch } from "./operations"

/** Denominaciones MXN aceptadas en el conteo físico del corte (valor en centavos). */
export const DENOMINATION_CENTS: Record<string, number> = {
  "1000": 100000, "500": 50000, "200": 20000, "100": 10000, "50": 5000, "20": 2000,
  "10": 1000, "5": 500, "2": 200, "1": 100, "0.5": 50,
}

const denominationsSchema = z.record(z.string(), z.number().int().min(0).max(100000))
  .superRefine((denoms, ctx) => {
    for (const key of Object.keys(denoms)) {
      if (!(key in DENOMINATION_CENTS)) ctx.addIssue({ code: "custom", message: `Denominación desconocida: ${key}`, path: [key] })
    }
  })

/** Suma del conteo físico en centavos; las claves ya pasaron por la whitelist. */
export function denominationsTotalCents(denoms: Record<string, number>): number {
  return Object.entries(denoms).reduce((sum, [key, count]) => sum + (DENOMINATION_CENTS[key] ?? 0) * count, 0)
}

export type CashMovementLike = { type: "IN" | "OUT"; amount: number; payment?: { method: string; amount: number } | null }

/**
 * Efectivo esperado del turno en centavos: fondo inicial + movimientos que sí
 * movieron billetes del cajón. Regla de clasificación (ver los call sites de
 * cashMovement.create):
 *   • payment == null  → movimiento manual (MANUAL), saldo de reserva
 *     (RESERVATION), abono de crédito (CREDIT_PAYMENT), devolución de
 *     inventario (RETURN) o gasto autorizado (EXPENSE): todos son efectivo.
 *   • payment.method === "CASH" → cobro o reembolso en efectivo documentado.
 *   • payment.amount < 0 (reembolso) → aunque el medio del pago no sea CASH
 *     (p. ej. CREDITO), la devolución de abonos ya cobrados sale del cajón en
 *     efectivo (ver refund() en sales.ts).
 * Cobros CARD/TRANSFER/CREDIT nunca generan CashMovement; si uno apareciera
 * ligado a un pago positivo de otro método, NO suma al efectivo esperado.
 */
export function countsAsCash(movement: CashMovementLike): boolean {
  const payment = movement.payment
  return payment == null || payment.method === "CASH" || payment.amount < 0
}

export function expectedCashCents(initialAmount: number, movements: CashMovementLike[]): number {
  let total = Math.round(initialAmount * 100)
  for (const movement of movements) {
    if (!countsAsCash(movement)) continue
    total += (movement.type === "IN" ? 1 : -1) * Math.round(movement.amount * 100)
  }
  return total
}

const schema = z.object({
  idempotencyKey: operationKeySchema, action: z.enum(["OPEN", "CLOSE", "MOVEMENT"]),
  registerId: z.string().min(1).optional(), amount: z.number().optional(),
  type: z.enum(["IN", "OUT"]).optional(), description: z.string().trim().max(1000).optional(),
  branchId: z.string().min(1).optional(),
  // Conteo físico por denominación al cerrar; el servidor deriva finalAmount.
  denominations: denominationsSchema.optional(),
}).superRefine((input, ctx) => {
  // El monto es obligatorio salvo en un cierre con desglose de denominaciones.
  if (input.amount === undefined && (input.action !== "CLOSE" || !input.denominations)) {
    ctx.addIssue({ code: "custom", message: "Indica el monto.", path: ["amount"] })
  }
})

/** Resultado del cierre: la caja cerrada + cuadre esperado/diferencia. */
export interface CashCloseResult { register: CashRegister; expectedCashCents: number; differenceCents: number }
export type CashResult = CashRegister | CashMovement | (CashRegister & CashCloseResult)
// Sobrecarga por acción: quien cierra con `action: "CLOSE"` recibe el cuadre
// tipado; el resto de acciones conserva la unión con `.id` en todos sus miembros.
export function changeCash(db: PrismaClient, actorId: string, businessId: string, raw: { action: "CLOSE" } & Record<string, unknown>): Promise<(CashRegister & CashCloseResult) & { operationId: string }>
export function changeCash(db: PrismaClient, actorId: string, businessId: string, raw: unknown): Promise<CashResult & { operationId: string }>
export async function changeCash(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = schema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: `CASH_${input.action}`, permission: "staff", payload: input }, async tx => {
    const user = await actor(tx, actorId, "staff", businessId)
    const branch = await resolveBranch(tx, input.branchId ?? user.homeBranchId, businessId)
    if (input.action === "OPEN") {
      if (await tx.cashRegister.count({ where: { status: "OPEN", branchId: branch.id, businessId } })) throw new BusinessError(`Ya hay una caja abierta en ${branch.name}.`, 409)
      return tx.cashRegister.create({ data: { businessId, initialAmount: amount(cents(input.amount!, true)), openedById: actorId, branchId: branch.id } })
    }
    if (!input.registerId) throw new BusinessError("Identifica la caja que estás operando.")
    const register = await openRegister(tx, branch.id, businessId)
    if (register.id !== input.registerId) throw new BusinessError("La caja cambió. Actualiza la pantalla antes de continuar.", 409)
    if (input.action === "CLOSE") {
      // El cierre cuadra el turno: solo un admin o quien lo abrió puede sellarlo.
      if (user.role !== "ADMIN" && register.openedById !== actorId) throw new BusinessError("Solo un administrador o quien abrió la caja puede cerrarla.", 403)
      // Contado: con desglose de denominaciones el servidor deriva el total;
      // sin él conserva el cierre clásico por monto capturado.
      const finalCents = input.denominations ? denominationsTotalCents(input.denominations) : cents(input.amount!, true)
      // Esperado: fondo + entradas de efectivo − salidas de efectivo (regla
      // documentada en countsAsCash: pagos de otros medios no tocan el cajón).
      const movements = await tx.cashMovement.findMany({
        where: { registerId: register.id },
        select: { type: true, amount: true, payment: { select: { method: true, amount: true } } },
      })
      const expectedCents = expectedCashCents(register.initialAmount, movements)
      const closed = await tx.cashRegister.update({
        where: { id: register.id },
        data: {
          status: "CLOSED", finalAmount: amount(finalCents), closedById: actorId, closedAt: new Date(), notes: input.description,
          ...(input.denominations ? { denominations: input.denominations } : {}),
        },
      })
      // Se conservan los campos de la caja al nivel superior (compat con la
      // respuesta anterior) y además el cuadre bajo register/expected/difference.
      return { ...closed, register: closed, expectedCashCents: expectedCents, differenceCents: finalCents - expectedCents }
    }
    if (!input.type || !input.description) throw new BusinessError("Indica el tipo y motivo del movimiento.")
    const valueCents = cents(input.amount!)
    const value = amount(valueCents)
    if (input.type === "OUT") {
      // Salida directa sin autorización previa: solo admin. El staff solicita
      // el gasto (CashRequest) y un admin distinto lo autoriza.
      if (user.role !== "ADMIN") throw new BusinessError("Las salidas de efectivo requieren un administrador. Registra una solicitud de gasto.", 403)
      const availableCents = await registerCashCents(tx, register.id)
      if (valueCents > availableCents) throw new BusinessError(`El retiro supera el efectivo en caja (${amount(availableCents)} disponibles).`, 409, "INSUFFICIENT_CASH")
    }
    return tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: input.type, amount: value, description: input.description, referenceType: "MANUAL" } })
  })
}
