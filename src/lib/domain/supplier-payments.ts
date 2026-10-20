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
  // Liquidar la cuenta por pagar es mutación permanente sin reverso: solo
  // ADMIN — un empleado no registra salidas de dinero del negocio (el gate
  // temprano vive además en el POST de /api/supplier-payments).
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SUPPLIER_PAYMENT", permission: "admin", payload: input }, async tx => {
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

/** Filtro Prisma que deja fuera los abonos ligados a OCs de sucursales ajenas
 *  (un abono a cuenta general, purchaseId null, es del negocio y no se recorta). */
function paymentScopeWhere(branchIds: readonly string[] | null | undefined) {
  return branchIds?.length
    ? { OR: [{ purchaseId: null }, { purchase: { branchId: { in: [...branchIds] } } }] }
    : {}
}

/**
 * Saldos por proveedor (cuentas por pagar). La deuda se deriva:
 * sum(Purchase.totalCents RECEIVED) - sum(SupplierPayment.amountCents).
 * Incluye ocsPendientes (ORDERED|RECEIVED con saldo) para ligar abonos y
 * proximoVencimiento = min(dueAt) entre ellas.
 * `purchaseBranchIds` recorta las OCs y los abonos ligados a ellas a esas
 * sucursales (empleado con allowedBranchIds); null/vacío = sin recorte.
 */
export async function supplierBalances(db: PrismaClient, businessId: string, purchaseBranchIds?: readonly string[] | null) {
  const purchaseScope = purchaseBranchIds?.length ? { branchId: { in: [...purchaseBranchIds] } } : {}
  const paymentScope = paymentScopeWhere(purchaseBranchIds)
  const [suppliers, received, paid, openPurchases] = await Promise.all([
    db.supplier.findMany({
      where: { businessId },
      include: { _count: { select: { purchases: { where: purchaseScope } } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.purchase.groupBy({
      by: ["supplierId"],
      where: { businessId, status: "RECEIVED", supplierId: { not: null }, ...purchaseScope },
      _sum: { totalCents: true },
    }),
    db.supplierPayment.groupBy({
      by: ["supplierId"],
      where: { businessId, ...paymentScope },
      _sum: { amountCents: true },
    }),
    db.purchase.findMany({
      where: { businessId, supplierId: { not: null }, status: { in: PAYABLE_STATUSES }, ...purchaseScope },
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

/** Buckets de antigüedad en centavos. */
export interface AgingBuckets {
  current: number // no vencida o sin fecha de vencimiento
  d1_15: number
  d16_30: number
  d31_60: number
  d60plus: number
}

export interface SupplierAgingRow extends AgingBuckets {
  supplierId: string
  name: string
  total: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Orden del waterfall: los abonos a cuenta general cubren primero lo más viejo. */
const BUCKETS_OLDEST_FIRST = ["d60plus", "d31_60", "d16_30", "d1_15", "current"] as const

/**
 * Reparte saldos pendientes en buckets de antigüedad según los días de atraso
 * contra `dueAt` (sin fecha o aún no vencida = corriente) y luego descuenta
 * los abonos a cuenta general del bucket MÁS VIEJO primero (waterfall).
 * Los buckets nunca quedan negativos: un excedente de abonos generales es
 * saldo a favor del negocio y no se refleja en la antigüedad.
 */
export function agingBuckets(
  debts: { remainingCents: number; dueAt: Date | null }[],
  generalPaymentCents: number,
  now: Date = new Date(),
): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0 }
  for (const debt of debts) {
    if (debt.remainingCents <= 0) continue
    const overdueDays = debt.dueAt ? Math.floor((now.getTime() - debt.dueAt.getTime()) / MS_PER_DAY) : 0
    const key =
      overdueDays <= 0 ? "current"
        : overdueDays <= 15 ? "d1_15"
          : overdueDays <= 30 ? "d16_30"
            : overdueDays <= 60 ? "d31_60"
              : "d60plus"
    buckets[key] += debt.remainingCents
  }

  let remaining = Math.max(0, generalPaymentCents)
  for (const key of BUCKETS_OLDEST_FIRST) {
    if (remaining <= 0) break
    const applied = Math.min(buckets[key], remaining)
    buckets[key] -= applied
    remaining -= applied
  }
  return buckets
}

/**
 * Antigüedad de cuentas por pagar por proveedor.
 *
 * La deuda de cada OC (ORDERED|RECEIVED) = totalCents - abonos ligados a ella
 * (SupplierPayment.purchaseId). Los abonos sin OC (a cuenta general) y los
 * abonos ligados a OCs que ya no son pagaderas (ej. canceladas después de
 * abonar) descuentan del bucket más viejo primero. Devuelve solo proveedores
 * con deuda (total > 0), ordenados por nombre, más los totales generales.
 * `purchaseBranchIds` recorta las OCs y los abonos ligados a ellas a esas
 * sucursales (empleado con allowedBranchIds); null/vacío = sin recorte.
 */
export async function supplierAging(db: PrismaClient, businessId: string, now: Date = new Date(), purchaseBranchIds?: readonly string[] | null) {
  const [suppliers, openPurchases, payments] = await Promise.all([
    db.supplier.findMany({ where: { businessId }, select: { id: true, name: true } }),
    db.purchase.findMany({
      where: { businessId, supplierId: { not: null }, status: { in: PAYABLE_STATUSES }, ...(purchaseBranchIds?.length ? { branchId: { in: [...purchaseBranchIds] } } : {}) },
      select: { id: true, supplierId: true, totalCents: true, dueAt: true },
    }),
    db.supplierPayment.findMany({
      where: { businessId, ...paymentScopeWhere(purchaseBranchIds) },
      select: { supplierId: true, purchaseId: true, amountCents: true },
    }),
  ])

  const payableIds = new Set(openPurchases.map(p => p.id))
  const paidByPurchase = new Map<string, number>()
  const generalBySupplier = new Map<string, number>()
  for (const p of payments) {
    if (p.purchaseId && payableIds.has(p.purchaseId)) {
      paidByPurchase.set(p.purchaseId, (paidByPurchase.get(p.purchaseId) ?? 0) + p.amountCents)
    } else {
      // Sin OC, o ligado a una OC que ya no es pagadera: actúa como cuenta general.
      generalBySupplier.set(p.supplierId, (generalBySupplier.get(p.supplierId) ?? 0) + p.amountCents)
    }
  }

  const debtsBySupplier = new Map<string, { remainingCents: number; dueAt: Date | null }[]>()
  for (const purchase of openPurchases) {
    if (!purchase.supplierId) continue
    const remainingCents = purchase.totalCents - (paidByPurchase.get(purchase.id) ?? 0)
    if (remainingCents <= 0) continue
    const list = debtsBySupplier.get(purchase.supplierId) ?? []
    list.push({ remainingCents, dueAt: purchase.dueAt })
    debtsBySupplier.set(purchase.supplierId, list)
  }

  const rows: SupplierAgingRow[] = []
  for (const supplier of suppliers) {
    const buckets = agingBuckets(
      debtsBySupplier.get(supplier.id) ?? [],
      generalBySupplier.get(supplier.id) ?? 0,
      now,
    )
    const total = buckets.current + buckets.d1_15 + buckets.d16_30 + buckets.d31_60 + buckets.d60plus
    if (total <= 0) continue
    rows.push({ supplierId: supplier.id, name: supplier.name, ...buckets, total })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "es"))

  const totals = rows.reduce<AgingBuckets & { total: number }>(
    (acc, row) => ({
      current: acc.current + row.current,
      d1_15: acc.d1_15 + row.d1_15,
      d16_30: acc.d16_30 + row.d16_30,
      d31_60: acc.d31_60 + row.d31_60,
      d60plus: acc.d60plus + row.d60plus,
      total: acc.total + row.total,
    }),
    { current: 0, d1_15: 0, d16_30: 0, d31_60: 0, d60plus: 0, total: 0 },
  )
  return { suppliers: rows, totals }
}

/** Historial de abonos del tenant, más reciente primero. Con `supplierId`
 *  se limita a ese proveedor (404 si no existe); sin él devuelve los últimos
 *  abonos del negocio completo — la vista "pagos recientes" del panel Les
 *  debo, que antes pedía el historial de cada proveedor por separado.
 *  `purchaseBranchIds` recorta los abonos ligados a OCs de esas sucursales
 *  (los a cuenta general son del negocio); null/vacío = sin recorte. */
export async function listSupplierPayments(db: PrismaClient, businessId: string, supplierId?: string | null, purchaseBranchIds?: readonly string[] | null) {
  if (supplierId) {
    const supplier = await db.supplier.findFirst({ where: { id: supplierId, businessId } })
    if (!supplier) throw new BusinessError("Proveedor no encontrado.", 404)
  }
  return db.supplierPayment.findMany({
    where: { businessId, ...(supplierId ? { supplierId } : {}), ...paymentScopeWhere(purchaseBranchIds) },
    include: {
      purchase: { select: { id: true, number: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
}
