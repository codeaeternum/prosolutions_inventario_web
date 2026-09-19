import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, addDebt, amount, BusinessError, cents, itemsSchema, mergeItems, openRegister, operation, operationKeySchema, registerCashCents, releaseStock, resolveBranch, takeStock, type Transaction } from "./operations"
import { collectLowStockIds, syncLowStockAlerts } from "../low-stock"

// Medios del mostrador. El enum de BD es en inglés; el contrato público conserva español.
const METHODS = z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"])
const METHOD_MAP = { EFECTIVO: "CASH", TARJETA: "CARD", TRANSFERENCIA: "TRANSFER", CREDITO: "CREDIT" } as const
type MethodInput = z.infer<typeof METHODS>

const paymentInput = z.object({
  method: METHODS,
  amount: z.number().positive().max(1000000).optional(), // obligatorio salvo que sea el único pago
  reference: z.string().trim().max(200).optional(),
})
const saleSchema = z.object({
  idempotencyKey: operationKeySchema, items: itemsSchema,
  payments: z.array(paymentInput).min(1).max(6).optional(),
  paymentMethod: METHODS.optional(),
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  // Lista de precios: "auto" (default) cobra mayoreo solo si el cliente es STORE;
  // "wholesale"/"retail" fuerzan la lista sin importar el tipo de cliente
  // (p. ej. el surtido de una solicitud del mercado B2B siempre va a mayoreo).
  priceTier: z.enum(["auto", "wholesale", "retail"]).optional(),
  // Marca del mostrador para emitir "nota de venta a taller" (SaleKind.WORKSHOP)
  // aunque el comprador sea walk-in sin cuenta STORE/TECHNICIAN. El servidor
  // siempre resuelve el kind final; el flag solo puede elevar a WORKSHOP.
  workshopSale: z.boolean().optional(),
}).refine(v => Boolean(v.payments) !== Boolean(v.paymentMethod), "Envía payments o paymentMethod.")

export async function sell(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = saleSchema.parse(raw)
  const items = mergeItems(input.items)
  const payments = input.payments ?? [{ method: input.paymentMethod! }]
  if (payments.some(p => p.method === "CREDITO") && !input.customerId) throw new BusinessError("Selecciona al cliente del crédito.")
  if (payments.length > 1 && payments.some(p => p.amount === undefined)) throw new BusinessError("En un pago dividido cada medio debe traer su monto.")
  // Una transferencia sin folio queda imposible de cuadrar contra el estado de cuenta.
  if (payments.some(p => p.method === "TRANSFERENCIA" && !p.reference)) throw new BusinessError("Captura la referencia de cada transferencia.")
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE", permission: "staff", payload: { ...input, items } }, async tx => {
    const seller = await actor(tx, actorId, "staff", businessId)
    const branch = await resolveBranch(tx, input.branchId ?? seller.homeBranchId, businessId)
    const customer = input.customerId ? await actor(tx, input.customerId, "customer", businessId) : null

    // Documento contable: RETAIL es mostrador al público; WORKSHOP ("nota de
    // venta a taller") separa la refacción vendida a talleres/negocios. Lo
    // fuerzan el tipo de cliente (STORE/TECHNICIAN) o la marca manual del POS.
    const kind: "RETAIL" | "WORKSHOP" =
      customer?.customerType === "STORE" || customer?.customerType === "TECHNICIAN" || input.workshopSale === true
        ? "WORKSHOP" : "RETAIL"

    // Precios del servidor; stock por sucursal con decremento condicional.
    // Toda nota a taller cobra la lista de mayoreo salvo lista explícita:
    // el walk-in de taller sin cuenta STORE/TECHNICIAN también va a mayoreo.
    const tier = input.priceTier ?? (kind === "WORKSHOP" ? "wholesale" : "auto")
    const lines = []
    let totalCents = 0
    for (const item of items) {
      const { product } = await takeStock(tx, { productId: item.productId, quantity: item.quantity, branchId: branch.id, businessId })
      const unitCents = cents(
        tier === "wholesale" ? product.wholesalePrice
          : tier === "retail" ? product.retailPrice
            : (customer?.customerType === "STORE" ? product.wholesalePrice : product.retailPrice)
      )
      const lineCents = unitCents * item.quantity
      cents(amount(lineCents))
      lines.push({ item, product, unitCents, lineCents })
      totalCents += lineCents
    }
    const total = amount(totalCents)
    const totalPaidCents = payments.length === 1 ? totalCents : payments.reduce((sum, p) => sum + cents(p.amount!, true), 0)
    if (totalPaidCents !== totalCents) throw new BusinessError(`Los pagos no cuadran con el total (${total}).`, 409)

    const sale = await tx.sale.create({ data: { businessId, total, kind, branchId: branch.id, sellerId: actorId, customerId: customer?.id ?? null } })
    // Medio dominante (el de mayor monto): clasifica el OUT como venta en el
    // historial (paymentMethod != null) y fija el canal de devolución simple.
    // La venta conserva el desglose completo en sus pagos.
    let dominantMethod: MethodInput = payments[0].method
    let topCents = -1
    for (const payment of payments) {
      const paymentCents = payments.length === 1 ? totalCents : cents(payment.amount!, true)
      if (paymentCents > topCents) { topCents = paymentCents; dominantMethod = payment.method }
    }
    const movements = []
    const saleItems = []
    for (const line of lines) {
      const saleItem = await tx.saleItem.create({ data: {
        businessId, saleId: sale.id, productId: line.product.id, quantity: line.item.quantity,
        unitPrice: amount(line.unitCents), totalPrice: amount(line.lineCents),
      } })
      const updated = await tx.product.findUniqueOrThrow({ where: { id: line.product.id } })
      const movement = await tx.inventoryMovement.create({ data: {
        businessId, productId: line.product.id, userId: actorId, type: "OUT", quantity: line.item.quantity,
        previousStock: updated.stock + line.item.quantity, newStock: updated.stock,
        reason: `Venta V-${sale.number}`, unitPrice: amount(line.unitCents), totalPrice: amount(line.lineCents),
        paymentMethod: dominantMethod,
        customerId: customer?.id, businessVersion: 1, branchId: branch.id, saleId: sale.id,
      }, include: { product: { select: { id: true, name: true } } } })
      saleItems.push(saleItem)
      movements.push(movement)
    }

    const created = []
    let register: Awaited<ReturnType<typeof openRegister>> | null = null
    for (const payment of payments) {
      const method = METHOD_MAP[payment.method]
      const paymentCents = payments.length === 1 ? totalCents : cents(payment.amount!, true)
      let cashMovementId: string | undefined
      if (method === "CASH") {
        register ??= await openRegister(tx, branch.id, businessId)
        const cashIn = await tx.cashMovement.create({ data: {
          businessId, registerId: register.id, userId: actorId, amount: amount(paymentCents), type: "IN",
          referenceType: "SALE", referenceId: sale.id, description: `Venta V-${sale.number}`,
        } })
        cashMovementId = cashIn.id
      }
      if (method === "CREDIT") {
        await addDebt(tx, customer!.id, paymentCents, { type: "SALE", id: sale.id, notes: `Venta V-${sale.number}` }, businessId)
      }
      created.push(await tx.payment.create({ data: {
        businessId, saleId: sale.id, method, amount: amount(paymentCents), status: "CONFIRMED",
        reference: payment.reference ?? null, cashMovementId: cashMovementId ?? null, createdById: actorId,
      } }))
    }
    return { sale, items: saleItems, payments: created, movements, quantity: items.reduce((sum, item) => sum + item.quantity, 0), total, kind: sale.kind }
  })
  // Post-commit: la alerta de stock bajo nunca corre dentro de la transacción.
  await syncLowStockAlerts(db, businessId, collectLowStockIds(items))
  return result
}

/** Devuelve el stock a la sucursal de la venta y revierte el dinero por cada medio. */
async function refund(tx: Transaction, input: {
  saleId: string; actorId: string; businessId: string; branchId: string; customerId: string | null;
  refundCents: number; channel: MethodInput; note: string;
}) {
  const paid = await tx.payment.aggregate({ where: { saleId: input.saleId, method: METHOD_MAP[input.channel], amount: { gt: 0 } }, _sum: { amount: true } })
  const refunded = await tx.payment.aggregate({ where: { saleId: input.saleId, method: METHOD_MAP[input.channel], amount: { lt: 0 } }, _sum: { amount: true } })
  const toCents = (value: number | null) => (value == null ? 0 : Math.round(value * 100))
  const netCents = toCents(paid._sum.amount) + toCents(refunded._sum.amount)
  if (input.refundCents > netCents) throw new BusinessError("El reembolso supera lo cobrado por ese medio de pago.", 409)

  let cashMovementId: string | undefined
  // Devolución física de dinero: solo si la caja tiene efectivo suficiente —
  // una salida mayor dejaría la caja en negativo (dinero ficticio).
  const cashRefund = async (refundCents: number, description: string) => {
    const register = await openRegister(tx, input.branchId, input.businessId)
    const availableCents = await registerCashCents(tx, register.id)
    if (refundCents > availableCents) throw new BusinessError("El efectivo en caja no alcanza para esta devolución.", 409, "INSUFFICIENT_CASH")
    const cashOut = await tx.cashMovement.create({ data: {
      businessId: input.businessId, registerId: register.id, userId: input.actorId, type: "OUT", amount: amount(refundCents),
      referenceType: "RETURN", referenceId: input.saleId, description,
    } })
    cashMovementId = cashOut.id
  }
  if (input.channel === "EFECTIVO") {
    await cashRefund(input.refundCents, input.note)
  }
  if (input.channel === "CREDITO") {
    if (!input.customerId) throw new BusinessError("La venta no tiene cliente para revertir el crédito.", 409)
    const customer = await tx.user.findUniqueOrThrow({ where: { id: input.customerId, businessId: input.businessId } })
    const balance = cents(customer.creditBalance, true)
    // Lo que aún se debe se perdona (REVERSAL); lo que el cliente ya abonó se
    // devuelve en efectivo — no puede quedar como saldo a favor implícito.
    const debtCents = Math.min(input.refundCents, balance)
    const collectedCents = input.refundCents - debtCents
    if (debtCents > 0) {
      await tx.user.update({ where: { id: customer.id }, data: { creditBalance: amount(balance - debtCents) } })
      await tx.creditMovement.create({ data: { businessId: input.businessId, userId: customer.id, amount: amount(debtCents), type: "REVERSAL", referenceType: "SALE", referenceId: input.saleId, notes: `REVERSIÓN DE DEUDA. ${input.note}` } })
    }
    if (collectedCents > 0) await cashRefund(collectedCents, `${input.note} · Devolución de abonos ya cobrados`)
  }
  return tx.payment.create({ data: {
    businessId: input.businessId, saleId: input.saleId, method: METHOD_MAP[input.channel], amount: amount(-input.refundCents), status: "REFUNDED",
    cashMovementId: cashMovementId ?? null, createdById: input.actorId, notes: input.note,
  } })
}

const returnSchema = z.object({
  saleId: z.string().min(1),
  items: z.array(z.object({ saleItemId: z.string().min(1), quantity: z.number().int().min(1).max(100000) })).min(1).max(100),
  refundMethod: METHODS,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: operationKeySchema,
})
export async function returnSaleItems(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = returnSchema.parse(raw)
  // Productos repuestos por la devolución: se acumulan dentro del tx y la
  // alerta se sincroniza post-commit (fuera de la transacción).
  const touchedProductIds = new Set<string>()
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE_RETURN", permission: "staff", payload: input }, async tx => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true } })
    if (!sale || sale.businessId !== businessId || sale.status !== "COMPLETED") throw new BusinessError("La venta no existe o ya fue anulada.", 409)
    const merged = mergeItems(input.items.map(i => ({ productId: i.saleItemId, quantity: i.quantity })))
    let refundCents = 0
    for (const line of merged) {
      const item = sale.items.find(i => i.id === line.productId)
      if (!item) throw new BusinessError("Una línea no pertenece a esta venta.", 409)
      const changed = await tx.saleItem.updateMany({ where: { id: item.id, quantity: { gte: item.returnedQuantity + line.quantity } }, data: { returnedQuantity: { increment: line.quantity } } })
      if (changed.count !== 1) throw new BusinessError(`La cantidad a devolver de ${item.id} supera lo vendido.`, 409)
      await releaseStock(tx, { productId: item.productId, quantity: line.quantity, branchId: sale.branchId, businessId })
      touchedProductIds.add(item.productId)
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
      await tx.inventoryMovement.create({ data: {
        businessId, productId: item.productId, userId: actorId, type: "RETURN", quantity: line.quantity,
        previousStock: product.stock - line.quantity, newStock: product.stock,
        reason: `Devolución V-${sale.number}: ${input.reason}`, businessVersion: 1, branchId: sale.branchId, saleId: sale.id,
        unitPrice: item.unitPrice, totalPrice: amount(cents(item.unitPrice) * line.quantity),
        customerId: sale.customerId,
      } })
      refundCents += cents(item.unitPrice) * line.quantity
    }
    const refundRow = await refund(tx, { saleId: sale.id, actorId, businessId, branchId: sale.branchId, customerId: sale.customerId, refundCents, channel: input.refundMethod, note: `Devolución V-${sale.number}: ${input.reason}` })
    // La devolución hereda el documento original: kind solo se expone, no se decide aquí.
    return { refund: refundRow, refunded: amount(refundCents), kind: sale.kind }
  })
  await syncLowStockAlerts(db, businessId, [...touchedProductIds])
  return result
}

const voidSchema = z.object({ saleId: z.string().min(1), reason: z.string().trim().min(1).max(500), idempotencyKey: operationKeySchema })
export async function voidSale(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = voidSchema.parse(raw)
  const touchedProductIds = new Set<string>()
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE_VOID", permission: "staff", payload: input }, async tx => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true, payments: true } })
    if (!sale || sale.businessId !== businessId) throw new BusinessError("Venta no encontrada.", 404)
    if (sale.status !== "COMPLETED") throw new BusinessError("La venta ya fue anulada.", 409)
    for (const item of sale.items) {
      const pending = item.quantity - item.returnedQuantity
      if (pending <= 0) continue
      await releaseStock(tx, { productId: item.productId, quantity: pending, branchId: sale.branchId, businessId })
      touchedProductIds.add(item.productId)
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
      await tx.inventoryMovement.create({ data: {
        businessId, productId: item.productId, userId: actorId, type: "IN", quantity: pending,
        previousStock: product.stock - pending, newStock: product.stock,
        reason: `Anulación V-${sale.number}: ${input.reason}`, businessVersion: 1, branchId: sale.branchId, saleId: sale.id,
      } })
    }
    // Reembolsa por cada medio solo su NETO pendiente (cobrado − ya devuelto);
    // pedir el bruto truena cuando la venta tuvo una devolución parcial previa.
    const paidMethods = [...new Set(sale.payments.filter(p => p.status === "CONFIRMED" && p.amount > 0).map(p => p.method))]
    for (const method of paidMethods) {
      const channel = (Object.keys(METHOD_MAP) as MethodInput[]).find(k => METHOD_MAP[k] === method)!
      const netCents = sale.payments.filter(p => p.method === method).reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
      if (netCents > 0) await refund(tx, { saleId: sale.id, actorId, businessId, branchId: sale.branchId, customerId: sale.customerId, refundCents: netCents, channel, note: `Anulación V-${sale.number}: ${input.reason}` })
      await tx.payment.updateMany({ where: { saleId: sale.id, method, status: "CONFIRMED" }, data: { status: "VOIDED" } })
    }
    const changed = await tx.sale.updateMany({ where: { id: sale.id, status: "COMPLETED" }, data: { status: "VOIDED" } })
    if (changed.count !== 1) throw new BusinessError("La venta cambió durante la operación; reintenta.", 409)
    // La anulación conserva el kind del documento (nota a taller vs ticket retail).
    return { saleId: sale.id, number: sale.number, kind: sale.kind }
  })
  await syncLowStockAlerts(db, businessId, [...touchedProductIds])
  return result
}
