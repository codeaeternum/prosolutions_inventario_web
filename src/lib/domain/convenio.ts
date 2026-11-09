import type { PrismaClient, RepairStatus } from "@prisma/client"
import { z } from "zod"
import { actor, BusinessError, openRegister, operation, operationKeySchema, type Transaction } from "./operations"
import { formatFolio, parseFolioDigits } from "../workshop-labels"

/**
 * Cuentas del convenio B2B entre talleres asociados (órdenes espejo).
 *
 * Dos caras del mismo vínculo, siempre desde el tenant actual:
 *  - porPagar (lado captador): mis órdenes con delegatedOrderId — el trabajo
 *    vive en la espejo del taller reparador y partnerPriceCents es lo que él
 *    me cobra. convenioSettledAt = "ya le pagué".
 *  - porCobrar (lado reparador): mis órdenes con originBusinessId,
 *    delegatedFromOrderId u originBusinessName — yo reparo lo que el
 *    captador trajo; el nombre libre cubre al aliado de MOSTRADOR sin
 *    cuenta (partnerDrop en la recepción). convenioSettledAt = "ya me pagó".
 *
 * La lectura cross-tenant se limita a las espejos vinculadas desde mis
 * órdenes (delegatedOrderId), mismo patrón que delegation.ts. El folio se
 * imprime con los ajustes del tenant dueño de cada orden.
 */

// La cuenta es exigible cuando el trabajo llegó a un estado entregable o
// entregado (READY/DELIVERED y los cierres con devolución: NOT_REPAIRED,
// NOT_AUTHORIZED, WARRANTY en reingreso). CANCELLED y los estados en proceso
// no generan saldo — aún no hay contraprestación que cobrar/pagar.
export const CONVENIO_CHARGEABLE_STATUSES: readonly RepairStatus[] = ["READY", "DELIVERED", "NOT_REPAIRED", "NOT_AUTHORIZED", "WARRANTY"]
export const isConvenioChargeable = (status: RepairStatus | null | undefined): boolean =>
  status != null && CONVENIO_CHARGEABLE_STATUSES.includes(status)

const DAY_MS = 24 * 60 * 60 * 1000

type ConvenioAgingRow = { chargeable: boolean; convenioSettledAt: unknown; daysPending: number | null }

/** Pendientes exigibles primero, de mayor a menor antigüedad; las cuentas
 *  en proceso o saldadas conservan su orden cronológico al fondo (sort
 *  estable: empate dentro del grupo deja la fila donde estaba). */
const byPendingAge = <T extends ConvenioAgingRow>(rows: T[]): T[] =>
  [...rows].sort((a, b) => {
    const pendA = a.chargeable && !a.convenioSettledAt ? 0 : 1
    const pendB = b.chargeable && !b.convenioSettledAt ? 0 : 1
    if (pendA !== pendB) return pendA - pendB
    return (b.daysPending ?? -1) - (a.daysPending ?? -1)
  })

export interface ConvenioTotalsRow {
  chargeable: boolean
  partnerPriceCents: number | null
  convenioSettledAt: Date | string | null
  // Monto congelado al liquidar la cuenta. NULL en cuentas saldadas antes
  // del snapshot: se usa el partnerPriceCents actual como respaldo legacy.
  convenioSettledAmountCents?: number | null
}

/** Agregado puro: pendiente = exigible y sin saldar con precio convenio;
 *  saldado suma lo ya marcado pagado (cualquier status — pagado es pagado)
 *  al monto congelado al liquidar, no al precio convenio vigente hoy;
 *  unpricedPending cuenta las exigibles sin precio convenio capturado. */
export function convenioTotals(rows: ConvenioTotalsRow[]) {
  let pendingCents = 0, settledCents = 0, unpricedPending = 0
  for (const row of rows) {
    if (row.convenioSettledAt) { settledCents += row.convenioSettledAmountCents ?? row.partnerPriceCents ?? 0; continue }
    if (!row.chargeable) continue
    if (row.partnerPriceCents == null) { unpricedPending++; continue }
    pendingCents += row.partnerPriceCents
  }
  return { pendingCents, settledCents, unpricedPending }
}

/** Lado del convenio al que pertenece una orden PROPIA (null = no es cuenta
 *  B2B): la ORIGEN delegada (delegatedOrderId) es "pagar"; la captada por un
 *  aliado —tenant ligado (originBusinessId), espejo de delegación
 *  (delegatedFromOrderId) o alta de mostrador con solo el nombre en texto
 *  (originBusinessName)— es "cobrar". */
const convenioSide = (order: {
  delegatedOrderId: string | null
  originBusinessId: string | null
  delegatedFromOrderId: string | null
  originBusinessName: string | null
}): "pagar" | "cobrar" | null =>
  order.delegatedOrderId ? "pagar"
    : (order.originBusinessId || order.delegatedFromOrderId || order.originBusinessName) ? "cobrar" : null

/** Lector mínimo de SystemSettings: admite el cliente global y el de la
 *  transacción (folioFormatter corre dentro de la tx en los settles). */
type SettingsReader = {
  systemSettings: {
    findMany: (args: {
      where: { businessId: { in: string[] }; key: { in: string[] } }
      select: { businessId: true; key: true; value: true }
    }) => Promise<{ businessId: string; key: string; value: string }[]>
  }
}

/** Folio con los ajustes de cada tenant involucrado, leídos una sola vez. */
async function folioFormatter(db: SettingsReader, businessIds: string[]) {
  const rows = await db.systemSettings.findMany({
    where: { businessId: { in: businessIds }, key: { in: ["order_prefix", "order_folio_digits"] } },
    select: { businessId: true, key: true, value: true },
  })
  const byTenant = new Map<string, Map<string, string>>()
  for (const row of rows) {
    const settings = byTenant.get(row.businessId) ?? new Map<string, string>()
    settings.set(row.key, row.value)
    byTenant.set(row.businessId, settings)
  }
  return (businessId: string, number: number) => {
    const settings = byTenant.get(businessId)
    return formatFolio(settings?.get("order_prefix"), number, parseFolioDigits(settings?.get("order_folio_digits")))
  }
}

export async function convenioReport(db: PrismaClient, businessId: string) {
  const [outgoing, incoming] = await Promise.all([
    // Lado captador: órdenes mías delegadas al taller asociado.
    db.repairOrder.findMany({
      where: { businessId, delegatedOrderId: { not: null } },
      orderBy: [{ delegatedAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true, number: true, delegatedOrderId: true, delegatedAt: true, convenioSettledAt: true,
        convenioSettledAmountCents: true,
        delegatedToBusiness: { select: { name: true } },
      },
    }),
    // Lado reparador: órdenes mías captadas por un negocio aliado (intake
    // aliado, espejo de una delegación saliente del captador, o alta de
    // mostrador con solo el nombre del aliado en texto — originBusinessName).
    db.repairOrder.findMany({
      where: { businessId, OR: [{ originBusinessId: { not: null } }, { delegatedFromOrderId: { not: null } }, { originBusinessName: { not: null } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true, number: true, status: true, createdAt: true, convenioSettledAt: true,
        convenioSettledAmountCents: true,
        partnerPriceCents: true, originContact: true, originBusinessName: true,
        originBusinessId: true, delegatedFromOrderId: true,
        originBusiness: { select: { name: true } },
      },
    }),
  ])

  // Cross-tenant acotado: SOLO las espejos a las que mis órdenes apuntan.
  const mirrorIds = outgoing.map(o => o.delegatedOrderId).filter((id): id is string => Boolean(id))
  const mirrors = mirrorIds.length
    ? await db.repairOrder.findMany({
        where: { id: { in: mirrorIds } },
        select: { id: true, number: true, businessId: true, status: true, partnerPriceCents: true },
      })
    : []
  const mirrorById = new Map(mirrors.map(m => [m.id, m]))

  // Antigüedad de la cuenta: cuándo llegó la orden que se entrega a estado
  // exigible (la ESPEJO en porPagar —sus eventos viven en el tenant
  // reparador—, la propia en porCobrar). Toda entrada a un estado exigible
  // escribe un evento STATUS: el STATUS directo o el "→ Entregado" que
  // acompaña a SETTLE_DELIVER; las acciones que mueven estado sin STATUS
  // (QUOTE, APPROVE, re-autorización por refacción, delegación) solo
  // aterrizan en estados NO exigibles, así que para una orden exigible el
  // último STATUS es su llegada al estado actual.
  // UNA query batch para ambos lados: las mías con businessId propio; las
  // espejos solo por id — mismo cross-tenant acotado que la consulta de
  // arriba, no hay otra forma de leer la bitácora del taller asociado.
  const pendingOwnIds = incoming
    .filter(o => !o.convenioSettledAt && isConvenioChargeable(o.status))
    .map(o => o.id)
  const pendingMirrorIds = outgoing
    .filter(o => !o.convenioSettledAt && o.delegatedOrderId && isConvenioChargeable(mirrorById.get(o.delegatedOrderId)?.status))
    .map(o => o.delegatedOrderId as string)
  const [folio, statusEvents] = await Promise.all([
    folioFormatter(db, [...new Set([businessId, ...mirrors.map(m => m.businessId)])]),
    pendingOwnIds.length + pendingMirrorIds.length > 0
      ? db.repairEvent.findMany({
          where: { type: "STATUS", OR: [{ businessId, orderId: { in: pendingOwnIds } }, { orderId: { in: pendingMirrorIds } }] },
          select: { orderId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ])
  const chargeableAtByOrder = new Map<string, Date>()
  for (const event of statusEvents) {
    const prev = chargeableAtByOrder.get(event.orderId)
    if (!prev || event.createdAt > prev) chargeableAtByOrder.set(event.orderId, event.createdAt)
  }
  const now = Date.now()
  const agingOf = (orderId: string | null | undefined): { chargeableAt: Date | null; daysPending: number | null } => {
    const chargeableAt = (orderId ? chargeableAtByOrder.get(orderId) : undefined) ?? null
    return {
      chargeableAt,
      // Sin STATUS registrado (órdenes históricas anteriores a la bitácora
      // de eventos) la antigüedad queda en null — mejor "sin dato" que
      // inventarla desde createdAt, que la inflaría.
      daysPending: chargeableAt ? Math.max(0, Math.floor((now - chargeableAt.getTime()) / DAY_MS)) : null,
    }
  }

  const porPagar = byPendingAge(outgoing.map(order => {
    const mirror = order.delegatedOrderId ? mirrorById.get(order.delegatedOrderId) ?? null : null
    const chargeable = isConvenioChargeable(mirror?.status)
    // Solo envejecen las cuentas exigibles y sin saldar; el resto va en null.
    const aging = chargeable && !order.convenioSettledAt
      ? agingOf(order.delegatedOrderId)
      : { chargeableAt: null, daysPending: null }
    return {
      orderId: order.id,
      folio: folio(businessId, order.number),
      delegatedAt: order.delegatedAt,
      convenioSettledAt: order.convenioSettledAt,
      convenioSettledAmountCents: order.convenioSettledAmountCents,
      mirrorOrderId: order.delegatedOrderId,
      mirrorFolio: mirror ? folio(mirror.businessId, mirror.number) : null,
      partnerName: order.delegatedToBusiness?.name ?? null,
      mirrorStatus: mirror?.status ?? null,
      // El precio convenio vive en la espejo: null = "sin precio convenio".
      partnerPriceCents: mirror?.partnerPriceCents ?? null,
      chargeable,
      chargeableAt: aging.chargeableAt,
      daysPending: aging.daysPending,
    }
  }))

  const porCobrar = byPendingAge(incoming.map(order => {
    const chargeable = isConvenioChargeable(order.status)
    const aging = chargeable && !order.convenioSettledAt
      ? agingOf(order.id)
      : { chargeableAt: null, daysPending: null }
    return {
      orderId: order.id,
      folio: folio(businessId, order.number),
      createdAt: order.createdAt,
      convenioSettledAt: order.convenioSettledAt,
      convenioSettledAmountCents: order.convenioSettledAmountCents,
      // En la espejo de una delegación, originContact guarda el folio local del
      // captador; en el intake aliado es el texto de "quién lo trajo".
      originFolio: order.originContact,
      captorName: order.originBusiness?.name ?? order.originBusinessName ?? null,
      // Captada de mostrador (partnerDrop): el aliado no tiene cuenta ligada
      // (sin originBusinessId ni espejo) — solo quedó su nombre en texto. La
      // UI la distingue del intake/espejo con este marcador.
      walkIn: order.originBusinessId == null && order.delegatedFromOrderId == null,
      status: order.status,
      partnerPriceCents: order.partnerPriceCents,
      chargeable,
      chargeableAt: aging.chargeableAt,
      daysPending: aging.daysPending,
    }
  }))

  return {
    generatedAt: new Date(),
    porPagar: { rows: porPagar, totals: convenioTotals(porPagar) },
    porCobrar: { rows: porCobrar, totals: convenioTotals(porCobrar) },
  }
}

const settleSchema = z.object({
  orderId: z.string().min(1),
  settled: z.boolean(),
  // Ingreso en ventanilla: al saldar una cuenta por COBRAR registra el
  // CashMovement IN en la caja abierta (aliado que paga en efectivo). Quien
  // liquida por transferencia no manda el flag.
  recordCashIn: z.boolean().optional(),
  // Sucursal explícita de la caja que recibe el ingreso; sin ella se resuelve
  // por la de la orden (o la base de quien liquida en el lote).
  branchId: z.string().min(1).optional(),
  idempotencyKey: operationKeySchema,
})

const settleBatchSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(50),
  settled: z.boolean(),
  recordCashIn: z.boolean().optional(),
  branchId: z.string().min(1).optional(),
  idempotencyKey: operationKeySchema,
})

/** El ingreso en caja solo existe del lado COBRAR (el aliado me paga a mí);
 *  del lado pagar el dinero sale hacia el taller — un IN lo falsearía. */
function assertCashInApplies(side: "pagar" | "cobrar") {
  if (side !== "cobrar") throw new BusinessError("El ingreso en caja solo aplica a lo que el aliado te debe; el pago al taller se registra como salida aparte.", 409)
}

/** UN solo CashMovement IN por el total liquidado en ventanilla. */
async function convenioCashIn(tx: Transaction, args: {
  businessId: string; actorId: string; registerId: string; totalCents: number
  allyLabel: string; folios: string[]
}) {
  const description = `Convenio ${args.allyLabel} · ${args.folios.join(", ")}`.slice(0, 200)
  await tx.cashMovement.create({ data: { businessId: args.businessId, registerId: args.registerId, userId: args.actorId, type: "IN", amount: args.totalCents / 100, description, referenceType: "CONVENIO" } })
}

/** Texto de la bitácora privada del settle (individual y lote comparten el
 *  formato para que el historial de la orden se lea igual). */
const settleEventDetail = (settled: boolean, side: "pagar" | "cobrar", amountCents: number | null) => {
  const amountNote = amountCents != null ? ` por ${(amountCents / 100).toFixed(2)} MXN` : ""
  return settled
    ? side === "pagar"
      ? `Convenio saldado${amountNote}: se registró el pago al taller asociado.`
      : `Convenio saldado${amountNote}: se registró el pago del negocio captador.`
    : "Convenio reabierto: la cuenta vuelve a quedar pendiente."
}

/**
 * Marca/desmarca la cuenta del convenio en una orden PROPIA. Cada lado salda
 * su propia orden (el captador la origen, el reparador la espejo): el otro
 * tenant ve su marca independiente. Solo admin — es la bitácora de dinero
 * entre negocios, misma clase de decisión que un REFUND.
 */
export async function settleConvenio(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = settleSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "CONVENIO_SETTLE", permission: "admin", payload: input }, async tx => {
    const order = await tx.repairOrder.findFirst({ where: { id: input.orderId, businessId }, include: { originBusiness: { select: { name: true } } } })
    if (!order) throw new BusinessError("Orden no encontrada.", 404)
    const side = convenioSide(order)
    if (!side) throw new BusinessError("La orden no pertenece a un convenio entre talleres.", 409)
    // Toggle idempotente: pedir el estado que ya tiene no reescribe nada ni
    // duplica el asiento de caja — el reintento devuelve el mismo recibo.
    if ((order.convenioSettledAt != null) === input.settled) {
      return { orderId: order.id, convenioSettledAt: order.convenioSettledAt, convenioSettledAmountCents: order.convenioSettledAmountCents, side }
    }
    // Snapshot del monto liquidado: el precio convenio vigente EN ESTE
    // INSTANTE queda congelado en la orden — si después el taller edita el
    // partnerPriceCents de una orden ya saldada, el histórico no se mueve.
    // En el lado "pagar" el precio vive en la espejo del reparador (lectura
    // cross-tenant acotada por id, mismo patrón que convenioReport); en el
    // lado "cobrar" es el de la propia orden.
    const settledAmountCents = input.settled
      ? side === "pagar"
        ? (await tx.repairOrder.findUnique({ where: { id: order.delegatedOrderId! }, select: { partnerPriceCents: true } }))?.partnerPriceCents ?? null
        : order.partnerPriceCents
      : null
    // Cobro en ventanilla: la caja se valida ANTES de tocar la orden — sin
    // caja abierta la marca tampoco ocurre (todo o nada dentro de la tx).
    let cashRegister: { id: string } | null = null
    if (input.settled && input.recordCashIn && (settledAmountCents ?? 0) > 0) {
      assertCashInApplies(side)
      // La caja de LA sucursal del convenio: la indicada, la de la orden o la
      // base de quien liquida — nunca "la que esté abierta en el negocio",
      // que podía ser la de otra sucursal. openRegister además bloquea la
      // fila como el resto de escrituras de caja.
      const me = await actor(tx, actorId, "admin", businessId)
      cashRegister = await openRegister(tx, input.branchId ?? order.currentBranchId ?? me.homeBranchId, businessId)
    }
    const settledAt = input.settled ? new Date() : null
    await tx.repairOrder.update({ where: { id: order.id }, data: { convenioSettledAt: settledAt, convenioSettledAmountCents: settledAmountCents, version: { increment: 1 } } })
    await tx.repairEvent.create({ data: { businessId, orderId: order.id, actorId, type: "NOTE", detail: settleEventDetail(input.settled, side, settledAmountCents), isPublic: false } })
    if (cashRegister && settledAmountCents != null) {
      const folio = (await folioFormatter(tx, [businessId]))(businessId, order.number)
      const allyLabel = order.originBusiness?.name ?? order.originBusinessName ?? "aliado"
      await convenioCashIn(tx, { businessId, actorId, registerId: cashRegister.id, totalCents: settledAmountCents, allyLabel, folios: [folio] })
    }
    return { orderId: order.id, convenioSettledAt: settledAt, convenioSettledAmountCents: settledAmountCents, side }
  })
}

/**
 * Liquidación EN LOTE de cuentas del convenio (el aliado que acumula y paga
 * mensual): una sola operación durable marca varias órdenes propias del
 * MISMO lado, cada una con su snapshot del partnerPriceCents vigente. Las
 * que ya están en el estado pedido se saltan idempotentemente y se reportan
 * aparte. Solo admin — misma clase de decisión que el settle individual.
 */
export async function settleConvenioBatch(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = settleBatchSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "CONVENIO_SETTLE_BATCH", permission: "admin", payload: input }, async tx => {
    const requestedIds = [...new Set(input.orderIds)]
    const orders = await tx.repairOrder.findMany({
      where: { id: { in: requestedIds }, businessId },
      include: { originBusiness: { select: { name: true } } },
    })
    // Todo o nada: una orden ajena (o inexistente) invalida el lote completo.
    if (orders.length !== requestedIds.length) throw new BusinessError("Orden no encontrada.", 404)
    const sides = orders.map(convenioSide)
    if (sides.some(s => s === null)) throw new BusinessError("Todas las órdenes deben pertenecer a un convenio entre talleres.", 409)
    // Un lote es UNA cuenta: mezclar "te debo" con "me debes" haría el total
    // y el asiento de caja ambiguos.
    const side = sides[0] as "pagar" | "cobrar"
    if (sides.some(s => s !== side)) throw new BusinessError("El lote mezcla cuentas por cobrar y por pagar; liqúidalas por separado.", 409)
    if (input.settled && input.recordCashIn) assertCashInApplies(side)
    // Snapshots del lado pagar: el precio convenio vive en la espejo del
    // reparador — lectura cross-tenant acotada por id, como convenioReport.
    const mirrorIds = side === "pagar"
      ? orders.map(o => o.delegatedOrderId).filter((id): id is string => Boolean(id))
      : []
    const mirrors = mirrorIds.length
      ? await tx.repairOrder.findMany({ where: { id: { in: mirrorIds } }, select: { id: true, partnerPriceCents: true } })
      : []
    const mirrorPriceById = new Map(mirrors.map(m => [m.id, m.partnerPriceCents]))
    const snapshotOf = (order: (typeof orders)[number]): number | null =>
      !input.settled ? null
        : side === "pagar" ? (order.delegatedOrderId ? mirrorPriceById.get(order.delegatedOrderId) ?? null : null)
          : order.partnerPriceCents
    // Toggle idempotente por orden: pedir el estado que ya tiene la salta.
    const toSettle = orders.filter(o => (o.convenioSettledAt != null) !== input.settled)
    const skipped = orders.filter(o => (o.convenioSettledAt != null) === input.settled).map(o => o.id)
    const totalCents = toSettle.reduce((sum, o) => sum + (snapshotOf(o) ?? 0), 0)
    // La caja se valida ANTES de marcar nada: si el ingreso en efectivo no se
    // puede asentar, el lote entero espera (todo o nada en la tx).
    let cashRegister: { id: string } | null = null
    if (input.settled && input.recordCashIn && totalCents > 0) {
      // El lote puede juntar órdenes de varias sucursales: el ingreso cae en
      // la caja indicada o en la base de quien liquida, con lock de fila.
      const me = await actor(tx, actorId, "admin", businessId)
      cashRegister = await openRegister(tx, input.branchId ?? me.homeBranchId, businessId)
    }
    const settledAt = input.settled ? new Date() : null
    const settled: { orderId: string; amountCents: number | null }[] = []
    for (const order of toSettle) {
      const amountCents = snapshotOf(order)
      await tx.repairOrder.update({ where: { id: order.id }, data: { convenioSettledAt: settledAt, convenioSettledAmountCents: amountCents, version: { increment: 1 } } })
      // Un solo evento por orden marcada — el historial de cada folio cuenta
      // su propia liquidación aunque el cobro fue en lote.
      await tx.repairEvent.create({ data: { businessId, orderId: order.id, actorId, type: "NOTE", detail: settleEventDetail(input.settled, side, amountCents), isPublic: false } })
      settled.push({ orderId: order.id, amountCents })
    }
    if (cashRegister) {
      const folio = await folioFormatter(tx, [businessId])
      const allyNames = new Set(toSettle.map(o => o.originBusiness?.name ?? o.originBusinessName ?? null).filter((name): name is string => Boolean(name)))
      await convenioCashIn(tx, {
        businessId, actorId, registerId: cashRegister.id, totalCents,
        allyLabel: [...allyNames].join(", ") || "aliado",
        folios: toSettle.map(o => folio(businessId, o.number)),
      })
    }
    return { settled, skipped, totalCents, side }
  })
}
