import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { amount, BusinessError, cents, openRegister, operation, operationKeySchema, releaseStock, takeStock, resolveBranch } from "./operations"

const movementSchema = z.object({
  productId: z.string().min(1), type: z.enum(["IN", "OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "DAMAGED", "LOST", "RETURN", "TRANSFER"]),
  quantity: z.number().int().min(1).max(100000), reason: z.string().trim().min(1).max(500), notes: z.string().max(1000).optional(),
  relatedId: z.string().min(1).optional(), reservationId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(), toBranchId: z.string().min(1).optional(),
})
const schema = z.object({ idempotencyKey: operationKeySchema, branchId: z.string().min(1).optional(), items: z.array(movementSchema).min(1).max(100) })
export async function moveInventory(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = schema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "INVENTORY", permission: "staff", payload: input }, async tx => {
    const movements = []
    for (const row of input.items) {
      const product = await tx.product.findFirst({ where: { id: row.productId, businessId } })
      if (!product) throw new BusinessError("Producto no encontrado.", 404)
      const branchId = row.branchId ?? input.branchId
      let value: number | undefined
      let method: string | undefined
      let customerId: string | undefined
      if (row.type === "TRANSFER") {
        if (!row.toBranchId) throw new BusinessError("Indica la sucursal de destino del traspaso.")
        const origin = await resolveBranch(tx, branchId, businessId)
        if (row.toBranchId === origin.id) throw new BusinessError("El origen y el destino del traspaso son la misma sucursal.")
        const destination = await resolveBranch(tx, row.toBranchId, businessId)
        await takeStock(tx, { productId: product.id, quantity: row.quantity, branchId: origin.id, businessId })
        await releaseStock(tx, { productId: product.id, quantity: row.quantity, branchId: destination.id, businessId })
        const movement = await tx.inventoryMovement.create({ data: {
          businessId, productId: product.id, userId: actorId, type: "TRANSFER",
          quantity: row.quantity, previousStock: product.stock, newStock: product.stock,
          reason: row.reason, notes: `Traspaso ${origin.name} → ${destination.name}${row.notes ? `. ${row.notes}` : ""}`,
          branchId: origin.id, toBranchId: destination.id, businessVersion: 1,
        } })
        movements.push(movement)
        continue
      }
      if (row.type === "RETURN") {
        if (Boolean(row.relatedId) === Boolean(row.reservationId)) throw new BusinessError("Selecciona la venta o reserva original de la devolución.")
        const source = row.relatedId
          ? await tx.inventoryMovement.findUnique({ where: { id: row.relatedId, businessId } })
          : await tx.reservation.findUnique({ where: { id: row.reservationId!, businessId } })
        if (!source || source.productId !== row.productId || source.businessVersion < 1) throw new BusinessError("La venta original requiere conciliación del historial. No se modificó stock ni dinero.", 409)
        if ("status" in source ? source.status !== "COMPLETED" : source.type !== "OUT" || !source.paymentMethod) throw new BusinessError("La operación original no es una venta entregada.", 409)
        // A reservation stores only its final payment method. It does not preserve
        // a refundable allocation between the bank deposit and the remaining payment.
        if ("status" in source && (source.type === "DEPOSIT" || source.depositPaid || (source.depositAmount ?? 0) > 0)) {
          throw new BusinessError("La reserva incluye un anticipo. Administración debe conciliar los medios de pago y el reembolso antes de devolverla. No se modificó stock, deuda ni caja.", 409, "MIXED_PAYMENT_REFUND_REVIEW")
        }
        const returned = await tx.inventoryMovement.aggregate({ where: { businessId, type: "RETURN", ...(row.relatedId ? { relatedId: row.relatedId } : { reservationId: row.reservationId }) }, _sum: { quantity: true } })
        if ((returned._sum.quantity ?? 0) + row.quantity > source.quantity) throw new BusinessError("La cantidad supera las unidades pendientes de devolución.", 409)
        const unit = "status" in source ? cents(source.totalPrice) / source.quantity : cents(source.unitPrice ?? 0)
        value = Math.round(unit * row.quantity)
        method = source.paymentMethod ?? undefined
        customerId = "status" in source ? source.userId : source.customerId ?? undefined
        if (!["CREDIT", "CREDITO", "EFECTIVO"].includes(method ?? "")) throw new BusinessError("Esta devolución requiere conciliar el reembolso por transferencia/tarjeta desde administración.", 409)
        if (method === "CREDIT" || method === "CREDITO") {
          if (!customerId) throw new BusinessError("No hay cliente vinculado al crédito.", 409)
          const customer = await tx.user.findUniqueOrThrow({ where: { id: customerId, businessId } })
          const balance = cents(customer.creditBalance, true)
          if (value > balance) throw new BusinessError("Hay pagos previos que requieren conciliar el saldo a favor.", 409)
          await tx.user.update({ where: { id: customerId }, data: { creditBalance: amount(balance - value) } })
          if (value > 0) await tx.creditMovement.create({ data: { businessId, userId: customerId, amount: amount(value), type: "REVERSAL", referenceType: row.relatedId ? "SALE" : "RESERVATION", referenceId: row.relatedId ?? row.reservationId, notes: "REVERSIÓN DE DEUDA por devolución. No es un abono de dinero." } })
        }
      }
      const positive = ["IN", "ADJUSTMENT_IN", "RETURN"].includes(row.type)
      const branch = positive
        ? await releaseStock(tx, { productId: product.id, quantity: row.quantity, branchId, businessId })
        : (await takeStock(tx, { productId: product.id, quantity: row.quantity, branchId, businessId })).branch
      const updated = await tx.product.findUniqueOrThrow({ where: { id: product.id } })
      const movement = await tx.inventoryMovement.create({ data: {
        businessId, productId: product.id, userId: actorId, type: row.type.startsWith("ADJUSTMENT") ? "ADJUSTMENT" : row.type === "RETURN" ? "RETURN" : positive ? "IN" : "OUT",
        quantity: row.quantity, previousStock: updated.stock - (positive ? row.quantity : -row.quantity), newStock: updated.stock, reason: row.reason, notes: row.notes,
        relatedId: row.relatedId, reservationId: row.reservationId, businessVersion: 1, branchId: branch.id,
        ...(value !== undefined ? { totalPrice: amount(value), unitPrice: amount(value / row.quantity), paymentMethod: method, customerId } : {}),
      } })
      if (row.type === "RETURN" && method === "EFECTIVO" && value! > 0) {
        const register = await openRegister(tx, branch.id, businessId)
        await tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: "OUT", amount: amount(value!), referenceType: "RETURN", referenceId: movement.id, description: `Devolución: ${product.name}` } })
      }
      movements.push(movement)
    }
    return { movements }
  })
}
