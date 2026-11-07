import type { PrismaClient, RepairStatus } from "@prisma/client"
import { DELEGATION_CLOSED_STATUSES } from "./delegation"
import { repairLabels } from "../workshop-labels"

/**
 * Reconciliación de la delegación cross-tenant (captador → taller reparador).
 *
 * `delegateRepairToPartner` NO es atómico: crea la orden espejo en el tenant
 * reparador (su propio commit) y después marca la local en otro commit. La
 * idempotencia cubre el reintento amable, pero si nadie reintenta, el hueco
 * queda para siempre: espejo creada + local sin marcar, marca local + espejo
 * perdida, o ambos lados vivos en estados divergentes.
 *
 * Este barrido DETECTA divergencias — no repara: tocar vínculos o estados
 * financieros/operativos de OTRO tenant a ciegas empeoraría el problema. Por
 * cada hallazgo devuelve un issue y deja un RepairEvent privado de alerta en
 * la orden afectada (deduplicado 24 h por `RECONCILE_TAG`), para que un humano
 * decida: reintentar la delegación desde el detalle, pedir al taller que
 * cierre la espejo, o corregir el vínculo a mano.
 *
 * Corre a diario desde el cron del bot (04:35) y bajo demanda por
 * GET /api/cron/reconcile-delegations — misma lógica, distinto cliente Prisma.
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** Prefijo del evento de alerta: sirve para no repetir el mismo aviso a diario. */
const RECONCILE_TAG = "[delegation-reconcile]"
/** Ventana de deduplicación de las alertas en la bitácora de cada orden. */
const ANNOTATE_WINDOW_MS = DAY_MS

export type DelegationIssueKind =
  /** Local marcada como enviada al taller, pero la espejo no existe. */
  | "MIRROR_MISSING"
  /** La espejo existe pero su delegatedFromOrderId no apunta a esta local. */
  | "MIRROR_UNLINKED"
  /** La espejo vive en un tenant distinto al de delegatedToBusinessId. */
  | "TENANT_MISMATCH"
  /** Espejo creada con vínculo inverso, pero la origen jamás quedó marcada
   *  (delegatedOrderId = null): el hueco exacto entre los dos commits. */
  | "ORIGIN_UNMARKED"
  /** La origen está marcada, pero apunta a OTRA espejo (duplicado o repunteo). */
  | "DUPLICATE_MIRROR"
  /** delegatedFromOrderId apunta a una orden origen inexistente. */
  | "MIRROR_ORPHAN"
  /** Un lado ya está en estado terminal y el otro sigue abierto sin
   *  movimiento desde hace más de `staleDays` (en cualquier dirección). */
  | "STATUS_DIVERGENT"

export interface DelegationIssue {
  kind: DelegationIssueKind
  /** Orden sobre la que se asienta la alerta (la que un humano debe revisar). */
  orderId: string
  /** Tenant dueño de `orderId` — el que tiene que actuar. */
  businessId: string
  detail: string
}

export interface DelegationReconcileResult {
  /** Vínculos examinados: locales marcadas + espejos con vínculo inverso. */
  checked: number
  /** Alertas nuevas escritas como RepairEvent privado (dedupe 24 h). */
  annotated: number
  issues: DelegationIssue[]
}

export interface ReconcileOptions {
  /** Días sin movimiento para considerar divergente un lado que sigue
   *  abierto cuando el otro ya cerró. Default: DELEGATION_RECONCILE_STALE_DAYS
   *  o 7 (clamp 1–90). */
  staleDays?: number
  /** false = solo reportar (modo seco, p. ej. `?dry=1` del endpoint). */
  annotate?: boolean
}

/** Días de gracia del barrido por env; default 7, clamp 1–90. */
export function delegationReconcileStaleDays(): number {
  const n = Number(process.env.DELEGATION_RECONCILE_STALE_DAYS)
  return Number.isFinite(n) ? Math.min(90, Math.max(1, Math.trunc(n))) : 7
}

const isTerminal = (status: RepairStatus) => DELEGATION_CLOSED_STATUSES.includes(status)
const label = (status: RepairStatus) => repairLabels[status]

// Campos necesarios en ambos sentidos del vínculo (local→espejo→origen).
const linkSelect = {
  id: true,
  businessId: true,
  number: true,
  status: true,
  createdById: true,
  delegatedOrderId: true,
  delegatedToBusinessId: true,
  delegatedFromOrderId: true,
  updatedAt: true,
} as const

type LinkRow = {
  id: string
  businessId: string
  number: number
  status: RepairStatus
  createdById: string
  delegatedOrderId: string | null
  delegatedToBusinessId: string | null
  delegatedFromOrderId: string | null
  updatedAt: Date
}

export async function reconcileDelegations(
  db: PrismaClient,
  opts: ReconcileOptions = {},
): Promise<DelegationReconcileResult> {
  const staleDays = opts.staleDays ?? delegationReconcileStaleDays()
  const annotate = opts.annotate !== false
  const now = Date.now()
  const cutoff = new Date(now - staleDays * DAY_MS)
  const issues: DelegationIssue[] = []
  const issue = (kind: DelegationIssueKind, order: LinkRow, detail: string) =>
    issues.push({ kind, orderId: order.id, businessId: order.businessId, detail })

  // Locales con marca de delegación (delegatedOrderId es el vínculo;
  // delegatedToBusinessId sin vínculo es una marca incompleta) y espejos con
  // vínculo inverso (delegatedFromOrderId).
  const [locals, mirrors] = await Promise.all([
    db.repairOrder.findMany({
      where: { OR: [{ delegatedOrderId: { not: null } }, { delegatedToBusinessId: { not: null } }] },
      select: linkSelect,
    }),
    db.repairOrder.findMany({
      where: { delegatedFromOrderId: { not: null } },
      select: linkSelect,
    }),
  ])

  // Resolución por lote: espejos apuntadas por las locales y orígenes
  // apuntadas por las espejos (pueden no existir — justo lo que se busca).
  const mirrorIds = [...new Set(locals.map(o => o.delegatedOrderId).filter((v): v is string => !!v))]
  const originIds = [...new Set(mirrors.map(o => o.delegatedFromOrderId).filter((v): v is string => !!v))]
  const [mirrorRows, originRows] = await Promise.all([
    mirrorIds.length ? db.repairOrder.findMany({ where: { id: { in: mirrorIds } }, select: linkSelect }) : Promise.resolve([]),
    originIds.length ? db.repairOrder.findMany({ where: { id: { in: originIds } }, select: linkSelect }) : Promise.resolve([]),
  ])
  const orderById = new Map<string, LinkRow>()
  for (const row of [...locals, ...mirrors, ...mirrorRows, ...originRows] as LinkRow[]) {
    orderById.set(row.id, row)
  }

  // ── Sentido local → espejo ────────────────────────────────────────────────
  for (const local of locals) {
    const ref = `#${local.number} (${local.id})`
    if (!local.delegatedOrderId) {
      // delegatedToBusinessId quedó pero el vínculo no: marca incompleta —
      // imposible por el updateMany atómico salvo escritura manual/bug viejo.
      issue("MIRROR_MISSING", local, `Orden ${ref} marcada con taller asociado (${local.delegatedToBusinessId}) pero sin orden espejo ligada (delegatedOrderId vacío). Marca incompleta: revisar a mano.`)
      continue
    }
    const mirror = orderById.get(local.delegatedOrderId)
    if (!mirror) {
      // La espejo no existe: commit de la espejo revertido, borrada, o un id
      // escrito a mano. La local cree que está delegada y nadie trabaja en ella.
      issue("MIRROR_MISSING", local, `Orden ${ref} delegada a tenant ${local.delegatedToBusinessId ?? "?"} pero su espejo ${local.delegatedOrderId} no existe. Reintentar la delegación o reabrir la orden local.`)
      continue
    }
    if (local.delegatedToBusinessId && mirror.businessId !== local.delegatedToBusinessId) {
      issue("TENANT_MISMATCH", local, `Orden ${ref} dice delegar a tenant ${local.delegatedToBusinessId} pero la espejo #${mirror.number} (${mirror.id}) vive en ${mirror.businessId}. El vínculo apunta a otro negocio.`)
    }
    if (mirror.delegatedFromOrderId !== local.id) {
      // El update del vínculo inverso corre fuera de la tx y se tolera su
      // fallo (console.warn en delegation.ts) — si nunca se escribió, la
      // idempotencia 2 no ve la espejo y un reintento crearía una segunda.
      issue("MIRROR_UNLINKED", local, `Orden ${ref} apunta a la espejo #${mirror.number} (${mirror.id}), pero esa orden tiene delegatedFromOrderId=${mirror.delegatedFromOrderId ?? "null"}. Reescribir el vínculo inverso o la delegación duplicará la espejo al reintentar.`)
    }
    // Divergencia de estados: un lado cerró y el otro sigue abierto sin
    // movimiento — el aviso post-commit pudo fallar o nadie actuó.
    if (isTerminal(local.status) && !isTerminal(mirror.status) && mirror.updatedAt.getTime() < cutoff.getTime()) {
      issue("STATUS_DIVERGENT", local, `Orden ${ref} está ${label(local.status)} pero la espejo #${mirror.number} sigue ${label(mirror.status)} en el taller sin moverse desde ${mirror.updatedAt.toISOString().slice(0, 10)} (> ${staleDays}d). Pedir al taller que la cierre o cancelarla allá.`)
    }
    if (!isTerminal(local.status) && isTerminal(mirror.status) && local.updatedAt.getTime() < cutoff.getTime()) {
      issue("STATUS_DIVERGENT", local, `Orden ${ref} sigue ${label(local.status)} pero la espejo #${mirror.number} ya quedó ${label(mirror.status)} hace más de ${staleDays}d en el taller. Cerrar la local desde su detalle.`)
    }
  }

  // ── Sentido espejo → origen ───────────────────────────────────────────────
  for (const mirror of mirrors) {
    const ref = `#${mirror.number} (${mirror.id})`
    const origin = mirror.delegatedFromOrderId ? orderById.get(mirror.delegatedFromOrderId) : null
    if (!origin) {
      // Espejo sin origen: la local fue borrada o el id quedó apuntando a
      // nada. La alerta va en la espejo (la origen no existe para el evento).
      issue("MIRROR_ORPHAN", mirror, `Orden espejo ${ref} referencia la orden origen ${mirror.delegatedFromOrderId} que no existe. Verificar con el negocio captador y cancelarla si no hay equipo que regresar.`)
      continue
    }
    if (origin.delegatedOrderId !== mirror.id) {
      if (!origin.delegatedOrderId) {
        // EL hueco entre commits: la espejo commiteó y la marca local falló
        // sin que nadie reintentara. El captador ve su orden "normal" y el
        // taller tiene el trabajo. Reintentar desde el detalle la completa.
        issue("ORIGIN_UNMARKED", origin, `La orden espejo ${ref} existe en el taller asociado, pero la origen #${origin.number} (${origin.id}) nunca quedó marcada como delegada (delegatedOrderId vacío). Reintentar «Enviar a taller asociado» desde el detalle la reconoce y solo completa la marca — no duplica.`)
      } else {
        // La origen apunta a OTRA espejo: duplicado real o repunteo manual.
        // La alerta va en la espejo sobrante — es la que no es reconocida.
        issue("DUPLICATE_MIRROR", mirror, `Orden espejo ${ref} dice venir de #${origin.number} (${origin.id}), pero esa origen apunta a otra espejo ${origin.delegatedOrderId}. Hay más de una espejo para la misma delegación: conservar la ligada y cancelar esta.`)
      }
    }
  }

  // Alertas en bitácora: un RepairEvent privado por orden con hallazgo, con
  // dedupe de 24 h (mismo TAG) para que el cron diario no inunde el detalle.
  let annotated = 0
  if (annotate && issues.length > 0) {
    const orderIds = [...new Set(issues.map(i => i.orderId))]
    const recent = await db.repairEvent.findMany({
      where: {
        orderId: { in: orderIds },
        type: "NOTE",
        detail: { startsWith: RECONCILE_TAG },
        createdAt: { gte: new Date(now - ANNOTATE_WINDOW_MS) },
      },
      select: { orderId: true },
    })
    const alreadyAlerted = new Set(recent.map(r => r.orderId))
    for (const item of issues) {
      if (alreadyAlerted.has(item.orderId)) continue
      const target = orderById.get(item.orderId)
      if (!target) continue
      try {
        // actorId = quien capturó la orden (createdById): usuario real del
        // tenant que satisface la FK — mismo criterio que el aviso
        // espejo→origen de delegation.ts.
        await db.repairEvent.create({
          data: {
            businessId: item.businessId,
            orderId: item.orderId,
            actorId: target.createdById,
            type: "NOTE",
            detail: `${RECONCILE_TAG} ${item.kind}: ${item.detail} (revisión manual requerida — el barrido no corrige datos)`,
            isPublic: false,
          },
        })
        annotated++
        alreadyAlerted.add(item.orderId)
      } catch (error) {
        // La alerta es secundaria: un evento que no se puede escribir no
        // debe abortar el barrido — el issue igual regresa en la lista.
        console.warn(`[delegation-reconcile] no se pudo anotar ${item.orderId}:`, error)
      }
    }
  }

  return { checked: locals.length + mirrors.length, annotated, issues }
}
