import type { PrismaClient, RepairStatus } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema } from "./operations"
import { formatFolio, parseFolioDigits } from "../workshop-labels"

/**
 * Cuentas del convenio B2B entre talleres asociados (órdenes espejo).
 *
 * Dos caras del mismo vínculo, siempre desde el tenant actual:
 *  - porPagar (lado captador): mis órdenes con delegatedOrderId — el trabajo
 *    vive en la espejo del taller reparador y partnerPriceCents es lo que él
 *    me cobra. convenioSettledAt = "ya le pagué".
 *  - porCobrar (lado reparador): mis órdenes con originBusinessId o
 *    delegatedFromOrderId — yo reparo lo que el captador trajo.
 *    convenioSettledAt = "ya me pagó".
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
}

/** Agregado puro: pendiente = exigible y sin saldar con precio convenio;
 *  saldado suma lo ya marcado pagado (cualquier status — pagado es pagado);
 *  unpricedPending cuenta las exigibles sin precio convenio capturado. */
export function convenioTotals(rows: ConvenioTotalsRow[]) {
  let pendingCents = 0, settledCents = 0, unpricedPending = 0
  for (const row of rows) {
    if (row.convenioSettledAt) { settledCents += row.partnerPriceCents ?? 0; continue }
    if (!row.chargeable) continue
    if (row.partnerPriceCents == null) { unpricedPending++; continue }
    pendingCents += row.partnerPriceCents
  }
  return { pendingCents, settledCents, unpricedPending }
}

/** Folio con los ajustes de cada tenant involucrado, leídos una sola vez. */
async function folioFormatter(db: PrismaClient, businessIds: string[]) {
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
        delegatedToBusiness: { select: { name: true } },
      },
    }),
    // Lado reparador: órdenes mías captadas por un negocio aliado (intake
    // aliado o espejo de una delegación saliente del captador).
    db.repairOrder.findMany({
      where: { businessId, OR: [{ originBusinessId: { not: null } }, { delegatedFromOrderId: { not: null } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true, number: true, status: true, createdAt: true, convenioSettledAt: true,
        partnerPriceCents: true, originContact: true, originBusinessName: true,
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
      // En la espejo de una delegación, originContact guarda el folio local del
      // captador; en el intake aliado es el texto de "quién lo trajo".
      originFolio: order.originContact,
      captorName: order.originBusiness?.name ?? order.originBusinessName ?? null,
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
  idempotencyKey: operationKeySchema,
})

/**
 * Marca/desmarca la cuenta del convenio en una orden PROPIA. Cada lado salda
 * su propia orden (el captador la origen, el reparador la espejo): el otro
 * tenant ve su marca independiente. Solo admin — es la bitácora de dinero
 * entre negocios, misma clase de decisión que un REFUND.
 */
export async function settleConvenio(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = settleSchema.parse(raw)
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "CONVENIO_SETTLE", permission: "admin", payload: input }, async tx => {
    const order = await tx.repairOrder.findFirst({ where: { id: input.orderId, businessId } })
    if (!order) throw new BusinessError("Orden no encontrada.", 404)
    const side = order.delegatedOrderId ? "pagar" : (order.originBusinessId || order.delegatedFromOrderId) ? "cobrar" : null
    if (!side) throw new BusinessError("La orden no pertenece a un convenio entre talleres.", 409)
    // Toggle idempotente: pedir el estado que ya tiene no reescribe nada.
    if ((order.convenioSettledAt != null) === input.settled) {
      return { orderId: order.id, convenioSettledAt: order.convenioSettledAt, side }
    }
    const settledAt = input.settled ? new Date() : null
    await tx.repairOrder.update({ where: { id: order.id }, data: { convenioSettledAt: settledAt, version: { increment: 1 } } })
    const detail = input.settled
      ? side === "pagar"
        ? "Convenio saldado: se registró el pago al taller asociado."
        : "Convenio saldado: se registró el pago del negocio captador."
      : "Convenio reabierto: la cuenta vuelve a quedar pendiente."
    await tx.repairEvent.create({ data: { businessId, orderId: order.id, actorId, type: "NOTE", detail, isPublic: false } })
    return { orderId: order.id, convenioSettledAt: settledAt, side }
  })
}
