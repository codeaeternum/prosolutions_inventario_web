import type { PrismaClient, PurchaseStatus } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema } from "./operations"
import { purchaseFolio } from "./purchasing"

/** Medios documentados para pagos a proveedor (solo informativo; ver paySupplier). */
export const SUPPLIER_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number]

/** Un pago puede ligarse solo a una OC ya comprometida: ordenada o recibida. */
const PAYABLE_STATUSES: PurchaseStatus[] = ["ORDERED", "RECEIVED"]

const paymentSchema = z.object({
  idempotencyKey: operationKeySchema,
  supplierId: z.string().min(1),
  purchaseId: z.string().min(1).nullish(),
  amountCents: z.number().int().min(1).max(100000000),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  notes: z.string().trim().max(1000).optional(),
})

/**
 * Registra un abono del negocio a un proveedor.
 *
 * Con purchaseId: la OC debe ser del mismo negocio Y del mismo proveedor, estar
 * en ORDERED|RECEIVED (un DRAFT todavía no compromete pago; CANCELLED ya no lo
 * hace) y el monto no puede exceder el saldo de esa OC (totalCents - paidCents).
 * Sin purchaseId queda a cuenta general: se permite aunque supere la deuda
 * derivada — representa anticipo o saldo a favor del negocio.
 *
 * NOTA: method="CASH" NO crea CashMovement OUT. El dinero que se entrega al
 * proveedor (transferencia bancaria, efectivo pagado fuera de mostrador) no es
 * efectivo de la caja del local; este registro solo documenta la salida.
 */
export async function paySupplier(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = paymentSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SUPPLIER_PAYMENT", permission: "staff", payload: input }, async tx => {
    // Se permite pagar aunque el proveedor esté inactivo: la deuda no desaparece.
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, businessId } })
    if (!supplier) throw new BusinessError("Proveedor no encontrado.", 404)

    let purchase: {
      id: string; number: number; supplierId: string | null
      status: PurchaseStatus; totalCents: number; paidCents: number
    } | null = null
    if (input.purchaseId) {
      const found = await tx.purchase.findFirst({ where: { id: input.purchaseId, businessId } })
      if (!found) throw new BusinessError("Orden de compra no encontrada.", 404)
      if (found.supplierId !== supplier.id) throw new BusinessError("La orden de compra no pertenece a este proveedor.", 409)
      if (!PAYABLE_STATUSES.includes(found.status)) {
        throw new BusinessError("Solo se pueden abonar órdenes en estado ordenada o recibida.", 409)
      }
      const remainingCents = found.totalCents - found.paidCents
      if (input.amountCents > remainingCents) {
        throw new BusinessError(`El abono excede el saldo de la orden (${(remainingCents / 100).toFixed(2)} pendiente).`, 409)
      }
      purchase = found
    }

    const payment = await tx.supplierPayment.create({
      data: {
        businessId,
        supplierId: supplier.id,
        purchaseId: purchase?.id ?? null,
        amountCents: input.amountCents,
        method: input.method,
        notes: input.notes || null,
        createdById: actorId,
      },
      include: {
        purchase: { select: { id: true, number: true } },
        supplier: { select: { id: true, name: true } },
      },
    })

    let purchasePaid: { paidCents: number; totalCents: number; settled: boolean } | null = null
    if (purchase) {
      const paidCents = purchase.paidCents + input.amountCents
      const settled = paidCents >= purchase.totalCents
      const updated = await tx.purchase.updateMany({
        where: { id: purchase.id, paidCents: purchase.paidCents },
        data: { paidCents, ...(settled ? { paidAt: new Date() } : {}) },
      })
      if (updated.count !== 1) throw new BusinessError("El saldo de la orden cambió durante el pago; reintenta.", 409)
      purchasePaid = { paidCents, totalCents: purchase.totalCents, settled }
    }

    return {
      payment,
      folio: purchase ? purchaseFolio(purchase.number) : null,
      purchasePaid,
    }
  })
}

/**
 * Saldos por proveedor (cuentas por pagar). La deuda se deriva:
 * sum(Purchase.totalCents RECEIVED) - sum(SupplierPayment.amountCents).
 * Incluye ocsPendientes (ORDERED|RECEIVED con saldo) para ligar abonos y
 * proximoVencimiento = min(dueAt) entre ellas.
 */
export async function supplierBalances(db: PrismaClient, businessId: string) {
  const [suppliers, received, paid, openPurchases] = await Promise.all([
    db.supplier.findMany({
      where: { businessId },
      include: { _count: { select: { purchases: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.purchase.groupBy({
      by: ["supplierId"],
      where: { businessId, status: "RECEIVED", supplierId: { not: null } },
      _sum: { totalCents: true },
    }),
    db.supplierPayment.groupBy({
      by: ["supplierId"],
      where: { businessId },
      _sum: { amountCents: true },
    }),
    db.purchase.findMany({
      where: { businessId, supplierId: { not: null }, status: { in: PAYABLE_STATUSES } },
      select: { id: true, number: true, supplierId: true, status: true, totalCents: true, paidCents: true, dueAt: true },
    }),
  ])

  const receivedMap = new Map<string, number>()
  for (const row of received) if (row.supplierId) receivedMap.set(row.supplierId, row._sum.totalCents ?? 0)
  const paidMap = new Map<string, number>()
  for (const row of paid) paidMap.set(row.supplierId, row._sum.amountCents ?? 0)
  const openMap = new Map<string, typeof openPurchases>()
  for (const p of openPurchases) {
    if (!p.supplierId) continue
    const list = openMap.get(p.supplierId) ?? []
    list.push(p)
    openMap.set(p.supplierId, list)
  }

  return suppliers.map(supplier => {
    const recibidoCents = receivedMap.get(supplier.id) ?? 0
    const pagadoCents = paidMap.get(supplier.id) ?? 0
    const ocsPendientes = (openMap.get(supplier.id) ?? [])
      .filter(p => p.totalCents - p.paidCents > 0)
      .map(p => ({
        id: p.id,
        number: p.number,
        folio: purchaseFolio(p.number),
        status: p.status,
        totalCents: p.totalCents,
        paidCents: p.paidCents,
        saldoCents: p.totalCents - p.paidCents,
        dueAt: p.dueAt,
      }))
      .sort((a, b) => a.number - b.number)
    const proximoVencimiento = ocsPendientes.reduce<Date | null>(
      (min, oc) => (oc.dueAt && (!min || oc.dueAt < min) ? oc.dueAt : min),
      null,
    )
    return { supplier, recibidoCents, pagadoCents, saldoCents: recibidoCents - pagadoCents, proximoVencimiento, ocsPendientes }
  })
}

/** Historial de abonos de un proveedor del tenant, más reciente primero. */
export async function listSupplierPayments(db: PrismaClient, businessId: string, supplierId: string) {
  const supplier = await db.supplier.findFirst({ where: { id: supplierId, businessId } })
  if (!supplier) throw new BusinessError("Proveedor no encontrado.", 404)
  return db.supplierPayment.findMany({
    where: { businessId, supplierId },
    include: {
      purchase: { select: { id: true, number: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
}
