import type { PrismaClient, PurchaseStatus } from "@prisma/client"
import { z } from "zod"
import { actor, BusinessError, openRegister, operation, operationKeySchema, registerCashCents } from "./operations"
import { purchaseFolio } from "./purchasing"
import { recordAudit } from "../audit"

/** Medios documentados para pagos a proveedor (solo informativo; ver paySupplier). */
export const SUPPLIER_PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number]

/** Un pago puede ligarse solo a una OC ya comprometida: ordenada o recibida. */
const PAYABLE_STATUSES: PurchaseStatus[] = ["ORDERED", "RECEIVED"]

/**
 * Anulación de abonos SIN columna de estado en el modelo: la convención es
 * marcar `notes` con este prefijo (el abono anulado conserva su rastro — la
 * fila no se borra, como la venta VOIDED). Saldos, antigüedad y ligaduras lo
 * excluyen con `notVoidedPaymentWhere`; el historial lo muestra marcado.
 */
export const SUPPLIER_PAYMENT_VOIDED_PREFIX = "[ANULADO]"
export const isSupplierPaymentVoided = (payment: { notes: string | null }): boolean =>
  payment.notes?.startsWith(SUPPLIER_PAYMENT_VOIDED_PREFIX) ?? false
const notVoidedPaymentWhere = { NOT: { notes: { startsWith: SUPPLIER_PAYMENT_VOIDED_PREFIX } } } as const

const paymentSchema = z.object({
  idempotencyKey: operationKeySchema,
  supplierId: z.string().min(1),
  purchaseId: z.string().min(1).nullish(),
  amountCents: z.number().int().min(1).max(100000000),
  method: z.enum(SUPPLIER_PAYMENT_METHODS),
  notes: z.string().trim().max(1000).optional(),
  // Marca explícita del mostrador: el CASH se entrega DESDE el cajón de la
  // sucursal del cobrador. Con ella el pago asienta su CashMovement OUT para
  // que el corte cuadre; ausente, CASH solo documenta la salida (ver paySupplier).
  cashFromRegister: z.boolean().optional(),
  // Sucursal del cajón cuando cashFromRegister: un ADMIN pagando desde otra
  // sucursal lo declara aquí; ausente, cae a la sucursal base del cobrador.
  branchId: z.string().min(1).optional(),
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
 * NOTA: method="CASH" NO crea CashMovement OUT por defecto. El dinero que se
 * entrega al proveedor (transferencia bancaria, efectivo pagado fuera de
 * mostrador) no es efectivo de la caja del local; este registro solo documenta
 * la salida. Con `cashFromRegister: true` —marca explícita del cobrador— el
 * pago SÍ sale del cajón: asienta su CashMovement OUT en la caja abierta de la
 * sucursal base del cobrador para que el corte cuadre, y como toda salida de
 * caja exige que el efectivo disponible lo cubra.
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

    // Salida real del cajón: solo cuando el cobrador declara que el efectivo
    // sale de su caja (cashFromRegister). openRegister exige caja abierta en
    // la sucursal declarada (input.branchId) o la base del cobrador —
    // declarar la salida sin caja sería inconsistente — y el tope es el
    // efectivo disponible, igual que una devolución.
    let cashMovement: { id: string } | null = null
    if (input.method === "CASH" && input.cashFromRegister) {
      const cashier = await actor(tx, actorId, "admin", businessId)
      const register = await openRegister(tx, input.branchId ?? cashier.homeBranchId, businessId)
      const availableCents = await registerCashCents(tx, register.id)
      if (input.amountCents > availableCents) {
        throw new BusinessError(`El pago supera el efectivo en caja (${((input.amountCents - availableCents) / 100).toFixed(2)} faltantes).`, 409, "INSUFFICIENT_CASH")
      }
      cashMovement = await tx.cashMovement.create({ data: {
        businessId, registerId: register.id, userId: actorId, type: "OUT",
        amount: input.amountCents / 100, referenceType: "SUPPLIER_PAYMENT", referenceId: payment.id,
        description: `Pago a proveedor ${supplier.name}`,
      } })
    }

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
      cashMovementId: cashMovement?.id ?? null,
    }
  })
}

const voidSchema = z.object({
  idempotencyKey: operationKeySchema,
  paymentId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
})

/**
 * Anula un abono a proveedor registrado por error. No existe columna de
 * estado en SupplierPayment, así que la anulación es la convención marcada
 * en `notes` (SUPPLIER_PAYMENT_VOIDED_PREFIX) — la fila se conserva para la
 * historia, igual que una venta VOIDED.
 *
 * Qué revierte dentro de la misma operación durable:
 * - Si el abono estaba ligado a una OC: su `paidCents` baja lo abonado y el
 *   `paidAt` se limpia cuando la OC deja de quedar liquidada (guard de
 *   concurrencia sobre el paidCents leído, como paySupplier).
 * - Si el abono sacó efectivo del cajón (CashMovement OUT con
 *   referenceType "SUPPLIER_PAYMENT" + referenceId del abono): se asienta el
 *   CashMovement IN de reverso en la caja abierta de la MISMA sucursal — el
 *   dinero vuelve a entrar físicamente a un cajón — ligado por el mismo
 *   referenceId para que el par OUT/IN quede trazado.
 *
 * Solo ADMIN — anular un asiento de dinero es la misma clase de decisión
 * que registrarlo. Reintentar una anulación ya hecha es no-op idempotente.
 */
export async function voidSupplierPayment(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = voidSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SUPPLIER_PAYMENT_VOID", permission: "admin", payload: input }, async tx => {
    const payment = await tx.supplierPayment.findFirst({
      where: { id: input.paymentId, businessId },
      include: { supplier: { select: { name: true } }, purchase: { select: { id: true, number: true, totalCents: true, paidCents: true, paidAt: true } } },
    })
    if (!payment) throw new BusinessError("Abono no encontrado.", 404)
    // Ya anulado: el reintento no duplica reverso ni reescribe el marcador.
    if (isSupplierPaymentVoided(payment)) {
      return { payment, alreadyVoided: true, cashMovementId: null }
    }

    // La OC ligada recupera su saldo: el abono deja de contar.
    let purchasePaid: { paidCents: number; totalCents: number; settled: boolean } | null = null
    if (payment.purchase) {
      const purchase = payment.purchase
      const paidCents = Math.max(0, purchase.paidCents - payment.amountCents)
      const updated = await tx.purchase.updateMany({
        where: { id: purchase.id, paidCents: purchase.paidCents },
        data: { paidCents, ...(paidCents < purchase.totalCents ? { paidAt: null } : {}) },
      })
      if (updated.count !== 1) throw new BusinessError("El saldo de la orden cambió durante la anulación; reintenta.", 409)
      purchasePaid = { paidCents, totalCents: purchase.totalCents, settled: paidCents >= purchase.totalCents }
    }

    // Reverso de la salida de caja, si la hubo: el IN vuelve a la caja
    // abierta de la sucursal de donde salió el efectivo.
    let cashMovement: { id: string } | null = null
    const originalOut = await tx.cashMovement.findFirst({
      where: { businessId, type: "OUT", referenceType: "SUPPLIER_PAYMENT", referenceId: payment.id },
      include: { register: { select: { branchId: true } } },
    })
    if (originalOut) {
      const register = await openRegister(tx, originalOut.register.branchId, businessId)
      cashMovement = await tx.cashMovement.create({ data: {
        businessId, registerId: register.id, userId: actorId, type: "IN",
        amount: payment.amountCents / 100, referenceType: "SUPPLIER_PAYMENT", referenceId: payment.id,
        description: `Reverso del pago a proveedor ${payment.supplier.name} (abono anulado)`,
      } })
    }

    const reason = input.reason?.trim()
    const marked = await tx.supplierPayment.update({
      where: { id: payment.id },
      data: {
        notes: `${SUPPLIER_PAYMENT_VOIDED_PREFIX} ${reason ? `${reason} · ` : ""}${payment.notes ?? ""}`.trim().slice(0, 900),
      },
      include: {
        purchase: { select: { id: true, number: true } },
        supplier: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })

    await recordAudit(tx, {
      businessId,
      actorId,
      action: "SUPPLIER_PAYMENT_VOID",
      entity: "supplier",
      entityId: payment.id,
      entityName: payment.supplier.name,
      summary: `Abono a proveedor anulado: ${(payment.amountCents / 100).toFixed(2)} MXN a ${payment.supplier.name}${payment.purchase ? ` · ${purchaseFolio(payment.purchase.number)}` : " · cuenta general"}${originalOut ? " · efectivo devuelto a caja" : ""}${reason ? ` · motivo: ${reason}` : ""}`,
    })

    return { payment: marked, alreadyVoided: false, purchasePaid, cashMovementId: cashMovement?.id ?? null }
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
      // Abonos anulados no restan deuda: el marcador en notes los excluye.
      where: { businessId, ...paymentScope, ...notVoidedPaymentWhere },
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
      where: { businessId, ...paymentScopeWhere(purchaseBranchIds), ...notVoidedPaymentWhere },
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
  const payments = await db.supplierPayment.findMany({
    where: { businessId, ...(supplierId ? { supplierId } : {}), ...paymentScopeWhere(purchaseBranchIds) },
    include: {
      purchase: { select: { id: true, number: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  // Los anulados se conservan en el historial marcados (voided): la fila no
  // se borra — el panel puede pintarlos tachados sin perder la traza.
  return payments.map(p => ({ ...p, voided: isSupplierPaymentVoided(p) }))
}
