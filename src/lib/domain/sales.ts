import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, addDebt, amount, BusinessError, cents, itemsSchema, mergeItems, openRegister, operation, operationKeySchema } from "./operations"

const saleSchema = z.object({
  idempotencyKey: operationKeySchema, items: itemsSchema,
  paymentMethod: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"]),
  customerId: z.string().min(1).optional(),
})

export async function sell(db: PrismaClient, actorId: string, raw: unknown) {
  const input = saleSchema.parse(raw)
  const items = mergeItems(input.items)
  if (input.paymentMethod === "CREDITO" && !input.customerId) throw new BusinessError("Selecciona al cliente del crédito.")
  return operation(db, { key: input.idempotencyKey, actorId, kind: "SALE", permission: "staff", payload: { ...input, items } }, async tx => {
    const customer = input.customerId ? await actor(tx, input.customerId) : null
    const register = input.paymentMethod === "EFECTIVO" ? await openRegister(tx) : null
    const movements = []
    let totalCents = 0
    for (const item of items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } })
      if (!product?.isActive || product.stock < item.quantity) throw new BusinessError("Existencias insuficientes. No se registró ningún producto de la venta.", 409)
      const unitCents = cents(customer?.customerType === "STORE" ? product.wholesalePrice : product.retailPrice)
      const lineCents = unitCents * item.quantity
      cents(amount(lineCents))
      const changed = await tx.product.updateMany({ where: { id: product.id, stock: { gte: item.quantity }, isActive: true }, data: { stock: { decrement: item.quantity } } })
      if (changed.count !== 1) throw new BusinessError("Las existencias cambiaron. Reintenta.", 409)
      const movement = await tx.inventoryMovement.create({ data: {
        productId: product.id, userId: actorId, type: "OUT", quantity: item.quantity,
        previousStock: product.stock, newStock: product.stock - item.quantity,
        reason: "Venta", unitPrice: amount(unitCents), totalPrice: amount(lineCents),
        paymentMethod: input.paymentMethod, customerId: customer?.id, businessVersion: 1,
      }, include: { product: { select: { id: true, name: true } } } })
      if (register) await tx.cashMovement.create({ data: { registerId: register.id, userId: actorId, amount: amount(lineCents), type: "IN", referenceType: "SALE", referenceId: movement.id, description: `Venta: ${product.name}` } })
      if (input.paymentMethod === "CREDITO") await addDebt(tx, customer!.id, lineCents, { type: "SALE", id: movement.id, notes: `Venta #${movement.id}` })
      movements.push(movement)
      totalCents += lineCents
    }
    cents(amount(totalCents))
    return { movements, quantity: items.reduce((sum, item) => sum + item.quantity, 0), total: amount(totalCents) }
  })
}
