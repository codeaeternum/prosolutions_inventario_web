import type { PrismaClient, RepairStatus } from "@prisma/client"
import { z } from "zod"
import { BusinessError, actor, operationKeySchema, transaction } from "./operations"
import { createRepair } from "./workshop"
import { formatFolio, parseFolioDigits, repairLabels } from "../workshop-labels"

/**
 * Vínculo captador → taller reparador ("Telcel trae → nosotros reparamos").
 *
 * `resolveRepairPartner` es la resolución compartida del taller asociado:
 * lee SystemSettings["repair_partner_business_id"] DEL negocio captador y
 * valida que el reparador exista, esté activo, tenga sucursal de intake y
 * personal staff habilitado (el actor de la operación en su tenant).
 *
 * `delegateRepairToPartner` es la delegación SALIENTE: el captador ya creó su
 * orden local en el módulo taller y luego decide mandarla al reparador. Crea
 * la orden ESPEJO en el tenant reparador (createRepair con origen = captador)
 * y marca la local como EXTERNAL_LAB delegada.
 *
 * IMPORTANTE — la espejo y la marca local NO son atómicas entre sí: son dos
 * operaciones secuenciales en dos tenants (cada una con su propio commit).
 * La idempotencia cubre el hueco: si la espejo se creó pero la marca local
 * falló, el reintento la reconoce por delegatedFromOrderId (o por la llave
 * determinista de la operación espejo) y solo completa la marca.
 */

export const REPAIR_PARTNER_KEY = "repair_partner_business_id"

// Cierres que ya no admiten delegación: la orden no puede salir hacia el
// taller una vez entregada o cerrada (con o sin reparación).
const DELEGATION_CLOSED_STATUSES: readonly RepairStatus[] = ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"]

/** Datos mínimos de la espejo que la delegación necesita (folio + estado). */
type MirrorRow = { id: string; number: number; businessId: string; status: RepairStatus }
const mirrorSelect = { id: true, number: true, businessId: true, status: true } as const

/**
 * Resuelve el taller reparador configurado para `businessId` (el captador).
 * Lanza BusinessError con los mismos mensajes que el intake de aliados:
 * sin configuración (400), taller inactivo (400), sin sucursal/staff (409).
 * `opts.missingMessage` permite al canal de delegación pedir la configuración
 * con sus propias palabras sin cambiar el contrato del intake aliado.
 */
export async function resolveRepairPartner(db: PrismaClient, businessId: string, opts?: { missingMessage?: string }) {
  const link = await db.systemSettings.findUnique({
    where: { businessId_key: { businessId, key: REPAIR_PARTNER_KEY } },
    select: { value: true },
  })
  const repairerBusinessId = link?.value?.trim()
  if (!repairerBusinessId) {
    throw new BusinessError(opts?.missingMessage ?? "Este negocio no tiene taller asociado configurado", 400, "PARTNER_NOT_CONFIGURED")
  }
  const [partnerBusiness, repairerBusiness, branch, repairerActor] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { name: true } }),
    db.business.findUnique({ where: { id: repairerBusinessId }, select: { name: true, isActive: true } }),
    // Sucursal de intake del reparador: su primera sucursal activa (el equipo
    // llega físicamente después; el taller lo reubica si hace falta).
    db.branch.findFirst({ where: { businessId: repairerBusinessId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    // Actor del recibo de operación: la operación exige un usuario staff
    // (ADMIN/EMPLOYEE) DEL tenant reparador. El primer staff habilitado del
    // taller funge como actor; la captura real queda en createdById/eventos.
    db.user.findFirst({ where: { businessId: repairerBusinessId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } }, orderBy: { createdAt: "asc" }, select: { id: true } }),
  ])
  if (!repairerBusiness?.isActive) throw new BusinessError("El taller asociado no está disponible.", 400)
  if (!branch) throw new BusinessError("El taller asociado no tiene una sucursal activa para recibir equipos.", 409)
  if (!repairerActor) throw new BusinessError("El taller asociado no tiene personal habilitado para registrar la orden.", 409)
  return { partnerBusiness, repairerBusinessId, repairerBusiness, branch, repairerActor }
}

/** Folio impreso con el order_prefix/order_folio_digits del tenant dueño de
 *  la orden indicada — la espejo se imprime con los ajustes del reparador y
 *  el folio local con los del captador. */
async function folioOf(db: PrismaClient, businessId: string, number: number): Promise<string> {
  const [prefix, digits] = await Promise.all([
    db.systemSettings.findUnique({ where: { businessId_key: { businessId, key: "order_prefix" } }, select: { value: true } }).catch(() => null),
    db.systemSettings.findUnique({ where: { businessId_key: { businessId, key: "order_folio_digits" } }, select: { value: true } }).catch(() => null),
  ])
  return formatFolio(prefix?.value, number, parseFolioDigits(digits?.value))
}

async function mirrorFolioOf(db: PrismaClient, mirror: MirrorRow | null): Promise<string | null> {
  if (!mirror) return null
  return folioOf(db, mirror.businessId, mirror.number)
}

// Telegram interpreta el mensaje como HTML (parse_mode HTML): un "<" o "&" en
// el nombre del taller/folio invalidaría el envío, así que se escapan.
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/**
 * Sincronización espejo → origen: cuando el taller reparador cambia la etapa
 * de una orden ESPEJO (delegatedFromOrderId != null, ver updateRepair), el
 * tenant captador se entera por tres vías:
 *  1) evento privado NOTE en SU orden local (la que quedó EXTERNAL_LAB) —
 *     queda en la bitácora del detalle de la orden que el captador opera;
 *  2) SSE al staff del captador (sendNotificationToStaff con SU businessId);
 *  3) Telegram a los admins del captador.
 *
 * El actor del evento NO puede ser el staff del taller (otro tenant): se
 * asienta el createdById de la orden origen —quien la delegó—, que es un
 * usuario existente del propio negocio y cumple la FK no nula de RepairEvent.
 *
 * Si la espejo llegó a un estado terminal se sugiere el cierre, pero la orden
 * local jamás se cierra sola: el captador decide y la cierra desde su detalle.
 *
 * DISEÑO: corre POST-COMMIT del updateRepair del taller, fuera de su
 * transacción y en best-effort total — cualquier fallo (BD, SSE, Telegram) se
 * registra con console.error y no se propaga: la espejo ya quedó actualizada
 * y el aviso es secundario. Se importa perezoso desde workshop.ts (import
 * estático crearía un ciclo delegation ↔ workshop).
 */
export async function notifyOriginOfMirrorUpdate(
  db: PrismaClient,
  args: { mirrorBusinessId: string; mirrorNumber: number; originOrderId: string; fromStatus: RepairStatus; toStatus: RepairStatus },
): Promise<void> {
  try {
    const origin = await db.repairOrder.findUnique({
      where: { id: args.originOrderId },
      select: { id: true, businessId: true, number: true, createdById: true },
    })
    if (!origin) return
    const [mirrorFolio, originFolio, repairer] = await Promise.all([
      folioOf(db, args.mirrorBusinessId, args.mirrorNumber),
      folioOf(db, origin.businessId, origin.number),
      db.business.findUnique({ where: { id: args.mirrorBusinessId }, select: { name: true } }),
    ])
    const partnerName = repairer?.name?.trim() || "El taller asociado"
    const fromLabel = repairLabels[args.fromStatus]
    const toLabel = repairLabels[args.toStatus]
    // Estado terminal en el taller: el captador decide el cierre de su orden
    // local (entregada si el trabajo terminó, cancelada en el resto).
    const terminal = DELEGATION_CLOSED_STATUSES.includes(args.toStatus)
    const closingHint = terminal ? ` Puedes cerrar la orden local como ${args.toStatus === "DELIVERED" ? "entregada" : "cancelada"} desde su detalle.` : ""
    await db.repairEvent.create({
      data: {
        businessId: origin.businessId,
        orderId: origin.id,
        actorId: origin.createdById,
        type: "NOTE",
        detail: `El taller asociado actualizó la orden ${mirrorFolio}: ${fromLabel} → ${toLabel}.${closingHint}`,
        isPublic: false,
      },
    })
    try {
      // Import perezoso: el módulo del stream vive en una ruta (tira de
      // api-auth/next-auth) y solo debe cargarse cuando de verdad hay aviso —
      // un fallo aquí queda cubierto por el mismo best-effort.
      const { sendNotificationToStaff } = await import("@/app/api/notifications/stream/route")
      await sendNotificationToStaff({
        type: "delegation_update",
        title: "El taller asociado actualizó una orden",
        message: `${partnerName}: ${originFolio} → ${toLabel}.${closingHint}`,
        data: { orderId: origin.id, folio: originFolio, status: toLabel, statusKey: args.toStatus, mirrorFolio, partnerName },
      }, origin.businessId)
    } catch (error) {
      console.error("[delegation] aviso SSE al captador falló:", error)
    }
    try {
      // Igual que el SSE: lib/telegram tira de lib/prisma (exige DATABASE_URL
      // al importar), así que solo se carga cuando hay aviso que enviar.
      const { sendTelegramToUsers } = await import("../telegram")
      await sendTelegramToUsers(
        origin.businessId,
        `🔧 <b>${escapeHtml(partnerName)}</b>: orden ${escapeHtml(originFolio)} ahora está <b>${escapeHtml(toLabel)}</b>${terminal ? `. Puedes cerrarla como ${args.toStatus === "DELIVERED" ? "entregada" : "cancelada"} desde su detalle.` : ""}`,
        { role: "ADMIN" },
      )
    } catch (error) {
      console.error("[delegation] aviso Telegram al captador falló:", error)
    }
  } catch (error) {
    // Best-effort total: ni la BD ni los canales de aviso pueden tumbar el
    // updateRepair ya confirmado que disparó la sincronización.
    console.error("[delegation] notifyOriginOfMirrorUpdate falló:", error)
  }
}

const delegateSchema = z.object({
  // Precio convenio que el taller cobra al captador (dato interno de la espejo).
  partnerPriceCents: z.number().int().min(0).max(100000000).optional(),
  // Nota interna para el taller — viaja como evento privado de la espejo.
  note: z.string().trim().max(500).optional(),
  idempotencyKey: operationKeySchema.optional(),
})

export async function delegateRepairToPartner(db: PrismaClient, actorId: string, businessId: string, orderId: string, raw?: unknown) {
  const input = delegateSchema.parse(raw ?? {})
  const order = await db.repairOrder.findFirst({ where: { id: orderId, businessId } })
  if (!order) throw new BusinessError("Orden no encontrada.", 404)

  // Idempotencia 1: la orden ya quedó delegada — devolver la misma espejo
  // sin duplicar. Se consulta el nombre del taller por delegatedToBusinessId
  // (no por la config actual: el vínculo pudo cambiar después).
  if (order.delegatedOrderId) {
    const [mirror, delegatedTo] = await Promise.all([
      db.repairOrder.findUnique({ where: { id: order.delegatedOrderId }, select: mirrorSelect }),
      order.delegatedToBusinessId ? db.business.findUnique({ where: { id: order.delegatedToBusinessId }, select: { name: true } }) : null,
    ])
    return {
      delegated: true, alreadyDelegated: true, mirrorOrderId: order.delegatedOrderId,
      mirrorFolio: await mirrorFolioOf(db, mirror), mirrorStatus: mirror?.status ?? null,
      partnerName: delegatedTo?.name ?? null,
    }
  }
  if (DELEGATION_CLOSED_STATUSES.includes(order.status)) {
    throw new BusinessError("La orden está cerrada; ya no se puede enviar al taller asociado.", 409)
  }

  const partner = await resolveRepairPartner(db, businessId, { missingMessage: "Configura tu taller asociado en Configuración" })
  const partnerName = partner.repairerBusiness.name
  // Folio local con los ajustes del captador: viaja como originContact de la
  // espejo ("quién la trajo" = la orden local que la originó).
  const localFolio = await folioOf(db, businessId, order.number)

  // Idempotencia 2: la espejo ya existe en el tenant reparador (un intento
  // anterior la creó pero la marca local no confirmó) — se reusa y solo se
  // completa la marca, sin crear una segunda orden.
  let mirror: MirrorRow | null = await db.repairOrder.findFirst({
    where: { businessId: partner.repairerBusinessId, delegatedFromOrderId: order.id },
    select: mirrorSelect,
  })
  if (!mirror) {
    const created = await createRepair(db, partner.repairerActor.id, partner.repairerBusinessId, {
      // Llave determinista por orden local: un reintento con la MISMA llave
      // devuelve la misma espejo aunque el vínculo inverso no se haya escrito.
      idempotencyKey: `delegate-${order.id}${input.idempotencyKey ? `-${input.idempotencyKey}` : ""}`.slice(0, 160),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      equipmentType: order.equipmentType,
      brand: order.brand ?? undefined,
      model: order.model ?? undefined,
      serialNumber: order.serialNumber ?? undefined,
      reportedIssue: order.reportedIssue,
      intakeBranchId: partner.branch.id,
      originBusinessId: businessId,
      originBusinessName: partner.partnerBusiness?.name?.trim() || undefined,
      originContact: localFolio,
      partnerPriceCents: input.partnerPriceCents,
      // recordedById = el staff del captador que delegó: él es la auditoría
      // real de quién envió el equipo (el actor de la operación es staff del
      // reparador por exigencia del dominio).
    }, { recordedById: actorId, privateNote: `Delegada desde ${localFolio}${input.note ? ` — ${input.note}` : ""}` })
    mirror = created.order
    // Vínculo inverso espejo→local (delegatedFromOrderId): habilita la
    // idempotencia 2 de arriba. Va en un update aparte — si falla no se
    // aborta: la marca local (delegatedOrderId) queda como fuente de verdad
    // y el reintento ya no duplica.
    await db.repairOrder.update({ where: { id: mirror.id }, data: { delegatedFromOrderId: order.id } })
      .catch(error => { console.warn("delegation: no se pudo escribir delegatedFromOrderId en la espejo", error) })
  }

  const mirrorFolio = await mirrorFolioOf(db, mirror)
  // Marca local + bitácora privada, en una transacción del tenant captador.
  // El where exige delegatedOrderId null y estado no cerrado: si otra
  // delegación ganó la carrera (o la orden se cerró entretanto) count = 0 y
  // se resuelve abajo como éxito idempotente o conflicto.
  const marked = await transaction(db, async tx => {
    await actor(tx, actorId, "staff", businessId)
    const updated = await tx.repairOrder.updateMany({
      where: { id: order.id, businessId, delegatedOrderId: null, status: { notIn: [...DELEGATION_CLOSED_STATUSES] } },
      data: {
        status: "EXTERNAL_LAB",
        delegatedToBusinessId: partner.repairerBusinessId,
        delegatedOrderId: mirror.id,
        delegatedAt: new Date(),
        version: { increment: 1 },
      },
    })
    if (updated.count !== 1) return false
    await tx.repairEvent.create({ data: { businessId, actorId, orderId: order.id, type: "NOTE", detail: `Enviada a taller asociado ${partnerName} (folio ${mirrorFolio}).`, isPublic: false } })
    return true
  })
  if (!marked) {
    // La orden cambió en paralelo: si quedó delegada por otro intento es el
    // mismo éxito; si no, algo la movió (cierre, edición) y se reintenta.
    const fresh = await db.repairOrder.findUnique({ where: { id: order.id }, select: { delegatedOrderId: true } })
    if (!fresh?.delegatedOrderId) throw new BusinessError("La orden cambió durante la delegación. Reintenta.", 409)
    const winner = await db.repairOrder.findUnique({ where: { id: fresh.delegatedOrderId }, select: mirrorSelect })
    return {
      delegated: true, alreadyDelegated: true, mirrorOrderId: fresh.delegatedOrderId,
      mirrorFolio: await mirrorFolioOf(db, winner), mirrorStatus: winner?.status ?? null, partnerName,
    }
  }
  return { delegated: true, alreadyDelegated: false, mirrorOrderId: mirror.id, mirrorFolio, mirrorStatus: mirror.status, partnerName }
}
