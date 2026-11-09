import type { Prisma, PrismaClient, RepairStatus } from "@prisma/client"
import { z } from "zod"
import { BusinessError, openRegister, operation, operationKeySchema, registerCashCents } from "./operations"
import { recordAudit } from "../audit"
import { linkCustomerByPhone } from "./customers"
import { nextOrderNumber } from "./tenant-sequence"
import { syncLowStockAlerts } from "../low-stock"
import { DEFAULT_FOLIO_DIGITS, DEFAULT_WARRANTY_DAYS, DEFAULT_WARRANTY_MAX_CYCLES, MAX_WARRANTY_DAYS, MAX_WARRANTY_MAX_CYCLES, ORDER_FOLIO_DIGITS_KEY, WARRANTY_DAYS_KEY, WARRANTY_MAX_CYCLES_KEY, parseFolioDigits, repairDeliverableStages, repairFolio, repairLabels, repairNextStages } from "../workshop-labels"
import { orderHeldCents, orderTotalCents } from "../workshop-money"
import { newQuoteToken, newTrackingToken, quoteExpiry, rotatedUploadToken, uploadTokenFields } from "../workshop-tokens"
import { encryptAccessValue } from "../device-secret"
import { normalizePhone } from "../utils"

// Los totales de dinero del taller viven en ../workshop-money (módulo puro,
// lo comparten rutas API y componentes). Se re-exportan para que el dominio
// siga siendo el punto de importación único.
export { approvedParts, approvedPartsTotal, orderTotalCents, orderHeldCents, orderBalanceCents, orderOverpaidCents } from "../workshop-money"

const text = z.string().trim().min(1).max(500)
const optionalText = z.string().trim().max(500).optional()
const moneyCents = z.number().int().min(0).max(100000000)
const paymentMethod = z.enum(["CASH", "CARD", "TRANSFER"])
const conditionFlag = z.enum(["ENCENDIDO", "APAGADO", "MOJADO", "MANIPULADO", "ROTO", "INCOMPLETO"])
const createSchema = z.object({
  idempotencyKey: operationKeySchema, customerName: text,
  customerPhone: z.string().trim().min(7).max(30).regex(/^[+\d\s()-]+$/),
  customerPhoneAlt: z.string().trim().max(30).regex(/^[+\d\s()-]+$/).optional().or(z.literal("")),
  equipmentType: text, brand: optionalText, model: optionalText, serialNumber: optionalText,
  equipmentColor: optionalText,
  deviceAccessType: z.enum(["NONE", "PATTERN", "PIN", "PASSWORD"]).optional(),
  deviceAccessValue: z.string().trim().max(100).optional(),
  accessories: optionalText, intakeCondition: optionalText, reportedIssue: text,
  // Servicio elegido del catálogo al recibir (opcional; el detalle libre va en reportedIssue).
  serviceName: optionalText,
  functionalConditions: z.array(conditionFlag).max(6).optional(),
  aesthetics: z.enum(["BUENO", "REGULAR", "MALO"]).optional(),
  location: z.string().trim().max(80).optional(),
  intakeBranchId: z.string().min(1), assignedToId: z.string().min(1).optional(),
  promisedAt: z.iso.datetime().optional(),
  scheduledAt: z.iso.datetime().optional(),
  // Firma del cliente en PNG base64 (data URL), capturada en recepción.
  signatureData: z.string().max(300000).regex(/^data:image\/png;base64,/).optional(),
  // Presupuesto estimado declarado en recepción (sin diagnóstico aún).
  quoteCents: moneyCents.optional(),
  // Taller aliado que captó el equipo ("Telcel trae → nosotros reparamos"):
  // originBusinessId liga el tenant cuando el aliado tiene cuenta (intake
  // /api/workshop/partner); originBusinessName/originContact quedan como
  // texto cuando se registra de mostrador. partnerPriceCents es el precio
  // convenio que se cobra al aliado — dato interno: la cotización al
  // cliente final sigue su flujo normal (approvedQuoteCents queda null).
  originBusinessId: z.string().optional(),
  originBusinessName: z.string().trim().max(80).optional(),
  originContact: z.string().trim().max(120).optional(),
  partnerPriceCents: moneyCents.optional(),
  // Anticipo cobrado en recepción; con caja abierta genera su asiento de caja.
  advance: z.object({ amountCents: moneyCents, method: paymentMethod }).optional(),
})
/** Formato completo del folio (prefijo `order_prefix` + dígitos) en UNA
 *  consulta con el cliente de la operación para no salir de la transacción —
 *  mismo patrón que warranty_days. Lo usan los textos que el dominio imprime
 *  (movimientos de caja, eventos): sin él saldrían "OT-" aunque el negocio
 *  use otro prefijo. Ajuste ausente/inválido o lectura fallida caen al
 *  default: el asiento no se bloquea por ello. */
async function folioFormatOf(tx: Prisma.TransactionClient, businessId: string): Promise<{ digits: number; prefix: string | null }> {
  try {
    const rows = await tx.systemSettings.findMany({ where: { businessId, key: { in: ["order_prefix", ORDER_FOLIO_DIGITS_KEY] } }, select: { key: true, value: true } })
    return {
      digits: parseFolioDigits(rows.find((r) => r.key === ORDER_FOLIO_DIGITS_KEY)?.value),
      prefix: rows.find((r) => r.key === "order_prefix")?.value ?? null,
    }
  } catch { return { digits: DEFAULT_FOLIO_DIGITS, prefix: null } }
}
/** Cómo acredita el cliente la recepción (SystemSettings
 *  `repair_signature_mode`): "canvas" (firma digital, default), "ticket"
 *  (línea de firma en el comprobante impreso) o "pin" (confirma con la
 *  terminación telefónica — jamás se guarda el pin). Lectura con el cliente
 *  de la operación; cualquier falla cae a "canvas". */
async function signatureModeOf(tx: Prisma.TransactionClient, businessId: string): Promise<"canvas" | "ticket" | "pin"> {
  try {
    const row = await tx.systemSettings.findUnique({ where: { businessId_key: { businessId, key: "repair_signature_mode" } }, select: { value: true } })
    return row?.value === "ticket" || row?.value === "pin" ? row.value : "canvas"
  } catch { return "canvas" }
}
/** Días de garantía del negocio (SystemSettings `warranty_days`, default 30,
 *  tope MAX_WARRANTY_DAYS). Fuente única: la misma cifra fija la ventana de
 *  reclamo tras cada entrega (warrantyEligibleUntil) y la vigencia del ciclo
 *  abierto al reingresar por garantía (warrantyUntil). */
async function warrantyDaysOf(tx: Prisma.TransactionClient, businessId: string): Promise<number> {
  const setting = await tx.systemSettings.findUnique({ where: { businessId_key: { businessId, key: WARRANTY_DAYS_KEY } }, select: { value: true } })
  const configured = Number.parseInt(setting?.value ?? "", 10)
  return configured >= 1 && configured <= MAX_WARRANTY_DAYS ? configured : DEFAULT_WARRANTY_DAYS
}
/** Tope de reingresos por garantía por orden (SystemSettings
 *  `warranty_max_cycles`, default 3). Agotado el contador la orden ya no
 *  reabre por garantía — la vía correcta es dar de alta una orden nueva;
 *  aplica parejo, sin excepción de administrador. */
async function warrantyMaxCyclesOf(tx: Prisma.TransactionClient, businessId: string): Promise<number> {
  const setting = await tx.systemSettings.findUnique({ where: { businessId_key: { businessId, key: WARRANTY_MAX_CYCLES_KEY } }, select: { value: true } })
  const configured = Number.parseInt(setting?.value ?? "", 10)
  return configured >= 1 && configured <= MAX_WARRANTY_MAX_CYCLES ? configured : DEFAULT_WARRANTY_MAX_CYCLES
}
async function registerPayment(tx: Prisma.TransactionClient, args: {
  orderId: string; orderNumber: number; branchId: string; actorId: string; businessId: string
  amountCents: number; method: "CASH" | "CARD" | "TRANSFER"; purpose: "ADVANCE" | "ABONO" | "SETTLEMENT"; note?: string
  // Folio externo del cobro (autorización de terminal / clave SPEI). En pagos
  // de taller `reference` está libre — la ligadura con reservas solo aplica a
  // Payment de Sale con purpose RESERVATION (domain/reservations).
  reference?: string
}) {
  // Cobrar en efectivo exige caja abierta en la sucursal del cobro (misma
  // regla que el reembolso) y con el lock de fila de openRegister — sin
  // asiento de caja el cobro quedaría fuera del corte del turno. Tarjeta y
  // transferencia no pasan por caja y pueden cobrarse sin ella.
  let register: { id: string } | null = null
  if (args.method === "CASH") {
    register = await openRegister(tx, args.branchId, args.businessId)
  }
  const payment = await tx.payment.create({ data: { businessId: args.businessId, repairOrderId: args.orderId, purpose: args.purpose, method: args.method, amount: args.amountCents / 100, reference: args.reference ?? null, createdById: args.actorId, notes: args.note ?? null } })
  if (register) {
    const fmt = await folioFormatOf(tx, args.businessId)
    const movement = await tx.cashMovement.create({ data: { businessId: args.businessId, registerId: register.id, userId: args.actorId, type: "IN", amount: args.amountCents / 100, description: `Taller ${repairFolio(args.orderNumber, fmt.digits, fmt.prefix)} · ${args.purpose === "ADVANCE" ? "anticipo" : args.purpose === "SETTLEMENT" ? "liquidación" : "abono"}`, referenceType: "REPAIR_PAYMENT", referenceId: payment.id } })
    await tx.payment.update({ where: { id: payment.id }, data: { cashMovementId: movement.id } })
  }
  return { payment }
}
/** Opciones del alta de orden. `recordedById`: quién capturó la orden cuando
 *  difiere del actor de la operación — el intake de taller aliado
 *  (/api/workshop/partner) corre con un usuario staff DEL taller reparador
 *  (la operación exige actor del mismo tenant), pero "Recibió"/actor de los
 *  eventos registra al usuario del negocio aliado que captó el equipo: es la
 *  auditoría real de quién lo registró. `privateNote`: nota interna del
 *  canal (p. ej. notas del aliado) — nunca sale en el rastreo público. */
export async function createRepair(db: PrismaClient, actorId: string, businessId: string, raw: unknown, opts?: { recordedById?: string; privateNote?: string }) {
  const { idempotencyKey, promisedAt, scheduledAt, functionalConditions, advance, ...input } = createSchema.parse(raw)
  const recorderId = opts?.recordedById ?? actorId
  return operation(db, { key: idempotencyKey, actorId, businessId, kind: "REPAIR_CREATE", permission: "staff", payload: { ...input, promisedAt, scheduledAt, functionalConditions, advance } }, async tx => {
    const branch = await tx.branch.findFirst({ where: { id: input.intakeBranchId, isActive: true, businessId } })
    if (!branch) throw new BusinessError("Selecciona una sucursal activa.")
    if (input.assignedToId && !await tx.user.findFirst({ where: { id: input.assignedToId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] }, businessId } })) throw new BusinessError("La persona asignada no está habilitada.")
    // Origen aliado ligado por tenant: debe ser OTRO negocio real. Sin la
    // validación un id basura rompe la FK originBusinessId (P2003 → 500) y
    // apuntar al propio negocio crea una auto-referencia sin sentido.
    if (input.originBusinessId) {
      if (input.originBusinessId === businessId) throw new BusinessError("El negocio de origen no puede ser el mismo negocio.", 400)
      if (!await tx.business.findUnique({ where: { id: input.originBusinessId }, select: { id: true } })) throw new BusinessError("El negocio de origen no existe.", 400)
    }
    // FK al directorio de clientes cuando el teléfono capturado empata con una
    // cuenta CUSTOMER del negocio (primero el principal, luego el alterno).
    // Sin match la orden queda con customerId null y la 360 la cubre por teléfono.
    const customerId = await linkCustomerByPhone(tx, businessId, input.customerPhone)
      ?? await linkCustomerByPhone(tx, businessId, input.customerPhoneAlt)
    // uploadTokenFields fija el uploadToken con caducidad: el QR del sticker
    // ya no es un enlace público permanente (ver lib/workshop-tokens).
    // El dato de desbloqueo se guarda cifrado en reposo (AES-256-GCM, ver
    // lib/device-secret): llega en claro desde recepción y solo se descifra
    // con auditoría (reveal=1 de la ficha, hoja de taller impresa).
    // El resultado de la operación se persiste como recibo idempotente
    // (BusinessOperation.response) y además vuelve en la respuesta POST:
    // omitir las firmas (~300 KB en base64) y el desbloqueo cifrado evita
    // duplicar datos pesados/sensibles que nadie consume de esta respuesta —
    // la ficha los sirve aparte con ?signatures=1 / ?reveal=1.
    // trackingToken: credencial UUID para el rastreo público — el link que se
    // comparte ya no lleva folio + dígitos del teléfono (enumerable). No rota
    // al entregar a propósito: el cliente puede revisar su historial después.
    // El folio es POR NEGOCIO: nextOrderNumber() lo reserva desde
    // BusinessCounter dentro de esta misma tx serializable — un rollback
    // devuelve el número sin quemarlo (domain/tenant-sequence).
    const number = await nextOrderNumber(tx, businessId)
    const order = await tx.repairOrder.create({ data: { ...input, number, ...uploadTokenFields(), quoteToken: newQuoteToken(), trackingToken: newTrackingToken(), deviceAccessValue: input.deviceAccessValue ? encryptAccessValue(input.deviceAccessValue) : input.deviceAccessValue, businessId, customerId, customerPhoneAlt: input.customerPhoneAlt || null, customerPhoneNormalized: normalizePhone(input.customerPhone) || null, customerPhoneAltNormalized: normalizePhone(input.customerPhoneAlt) || null, functionalConditions: functionalConditions?.join(",") ?? null, currentBranchId: branch.id, createdById: recorderId, promisedAt: promisedAt ? new Date(promisedAt) : null, scheduledAt: scheduledAt ? new Date(scheduledAt) : null }, omit: { signatureData: true, deliverySignatureData: true, deviceAccessValue: true } })
    // Sin firma digital capturada, el evento asienta la forma alternativa de
    // confirmación configurada: "pin" = terminación telefónica (el pin nunca
    // se persiste); "ticket" = firma en el comprobante impreso.
    const signatureMode = input.signatureData ? "canvas" : await signatureModeOf(tx, businessId)
    const signatureNote =
      signatureMode === "pin" ? " Confirmó con terminación telefónica."
      : signatureMode === "ticket" ? " Firma del cliente en el ticket impreso."
      : ""
    await tx.repairEvent.create({ data: { businessId, actorId: recorderId, orderId: order.id, type: "RECEIVED", detail: `Recepción en ${branch.name}.${signatureNote}`, isPublic: true } })
    // Origen aliado queda en bitácora privada: el nombre del negocio que captó
    // y el convenio no se publican en el seguimiento del cliente.
    if (input.originBusinessName) await tx.repairEvent.create({ data: { businessId, actorId: recorderId, orderId: order.id, type: "NOTE", detail: `Captado por ${input.originBusinessName}${order.partnerPriceCents != null ? ` · convenio ${(order.partnerPriceCents / 100).toFixed(2)} MXN` : ""}`, isPublic: false } })
    if (opts?.privateNote) await tx.repairEvent.create({ data: { businessId, actorId: recorderId, orderId: order.id, type: "NOTE", detail: opts.privateNote, isPublic: false } })
    if (order.quoteCents !== null) await tx.repairEvent.create({ data: { businessId, actorId: recorderId, orderId: order.id, type: "QUOTE", detail: `Presupuesto estimado en recepción: ${(order.quoteCents / 100).toFixed(2)} MXN.`, isPublic: true } })
    if (advance && advance.amountCents > 0) {
      await registerPayment(tx, { orderId: order.id, orderNumber: order.number, branchId: branch.id, actorId, businessId, amountCents: advance.amountCents, method: advance.method, purpose: "ADVANCE" })
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: order.id, type: "PAYMENT", detail: `Anticipo ${(advance.amountCents / 100).toFixed(2)} MXN (${advance.method}).` } })
    }
    return { order }
  })
}
/** Mueve inventario por una refacción vinculada al catálogo: OUT al
 *  autorizarse/agregarse, RETURN al retirarse estando autorizada. El OUT
 *  descuenta de la sucursal origen registrada en la pieza
 *  (part.sourceBranchId — el almacén de refacciones puede surtir órdenes de
 *  otras sucursales) o de la sucursal actual de la orden cuando no hay origen;
 *  el RETURN repone en la sucursal donde ocurrió el OUT.
 *  Respeta el invariante de stock no negativo (CHECK en BranchStock y Product):
 *  si no alcanzan las existencias descuenta lo que hay y el detalle de la orden
 *  documenta el faltante — la pieza pudo montarse antes de catalogarse.
 *  Devuelve el resultado del movimiento, o null si la refacción no está vinculada. */
async function syncPartStock(tx: Prisma.TransactionClient, args: {
  order: { number: number; currentBranchId: string }
  part: { id: string; productId: string | null; description: string; qty: number; unitPriceCents: number; sourceBranchId?: string | null }
  actorId: string; businessId: string; type: "OUT" | "RETURN"
  // Set opcional donde se registra el productId tocado: el llamador lo usa para
  // sincronizar la alerta de stock bajo post-commit (fuera de esta transacción).
  touched?: Set<string>
}): Promise<{ deducted: number; stock: number } | null> {
  const { order, part, actorId, businessId, type } = args
  if (!part.productId) return null
  args.touched?.add(part.productId)
  const productId = part.productId
  const folioFmt = await folioFormatOf(tx, businessId)
  const folio = repairFolio(order.number, folioFmt.digits, folioFmt.prefix)
  if (type === "RETURN") {
    // Se repone solo lo que realmente se descontó (los movimientos OUT de esta
    // refacción, identificados por su id en `notes`) menos lo ya repuesto —
    // así un segundo RETURN por la misma refacción no duplica existencias.
    // El id va anclado al patrón completo "Refacción OT <id> ·" (el formato
    // con el que SIEMPRE se escriben estos movimientos): a diferencia de
    // contains (%…%), el LIKE 'prefijo%' puede aprovechar índice y ni barre
    // la descripción ni confunde un id que sea prefijo de otro
    // (…OT abc · ≠ …OT abcXYZ ·).
    const partRef = `Refacción OT ${part.id} ·`
    const outs = await tx.inventoryMovement.findMany({ where: { businessId, productId, type: "OUT", notes: { startsWith: partRef } }, select: { quantity: true, branchId: true } })
    const returned = await tx.inventoryMovement.aggregate({ where: { businessId, productId, type: "RETURN", notes: { startsWith: partRef } }, _sum: { quantity: true } })
    const returnQty = outs.reduce((sum, movement) => sum + movement.quantity, 0) - (returned._sum.quantity ?? 0)
    if (returnQty <= 0) return { deducted: 0, stock: 0 }
    // La reposición va a la sucursal donde ocurrió el OUT (la orden pudo
    // moverse de sucursal después del descuento).
    const returnBranchId = outs.find(movement => movement.branchId !== null)?.branchId ?? order.currentBranchId
    await tx.branchStock.upsert({
      where: { productId_branchId: { productId, branchId: returnBranchId } },
      create: { businessId, productId, branchId: returnBranchId, quantity: returnQty },
      update: { quantity: { increment: returnQty } },
    })
    const product = await tx.product.update({ where: { id: productId, businessId }, data: { stock: { increment: returnQty } } })
    await tx.inventoryMovement.create({ data: { businessId, type: "RETURN", quantity: returnQty, previousStock: product.stock - returnQty, newStock: product.stock, productId, branchId: returnBranchId, userId: actorId, reason: `Devolución refacción ${folio}`, notes: `Refacción OT ${part.id} · ${part.description}`, unitPrice: part.unitPriceCents / 100, totalPrice: (part.unitPriceCents * returnQty) / 100, businessVersion: 1 } })
    return { deducted: returnQty, stock: product.stock }
  }
  // OUT: el CHECK quantity >= 0 no admite negativos — se toma solo lo disponible.
  // La sucursal que surte es la registrada en la refacción o, sin ella, la
  // sucursal actual de la orden; el movimiento guarda la sucursal real y el
  // RETURN la sigue aunque la orden se mueva después.
  // Invariante Product.stock = Σ BranchStock: ambos descuentan la MISMA
  // cantidad, así que el tope es el mínimo entre la sucursal y el total
  // cacheado (si ya venían desfasados, no se profundiza el desfase).
  const sourceBranchId = part.sourceBranchId ?? order.currentBranchId
  const stockRow = await tx.branchStock.findUnique({ where: { productId_branchId: { productId, branchId: sourceBranchId } } })
  const branchAvailable = Math.max(0, stockRow?.quantity ?? 0)
  const productRow = await tx.product.findUnique({ where: { id: productId, businessId }, select: { stock: true } })
  const productAvailable = Math.max(0, productRow?.stock ?? 0)
  const deduct = Math.min(part.qty, branchAvailable, productAvailable)
  if (deduct <= 0) return { deducted: 0, stock: productAvailable }
  const taken = await tx.branchStock.updateMany({ where: { productId, branchId: sourceBranchId, quantity: { gte: deduct } }, data: { quantity: { decrement: deduct } } })
  if (taken.count !== 1) return { deducted: 0, stock: productAvailable } // el stock cambió en paralelo; el evento no afirma descuento
  const product = await tx.product.update({ where: { id: productId, businessId }, data: { stock: { decrement: deduct } } })
  await tx.inventoryMovement.create({ data: { businessId, type: "OUT", quantity: deduct, previousStock: product.stock + deduct, newStock: product.stock, productId, branchId: sourceBranchId, userId: actorId, reason: `Taller ${folio}`, notes: `Refacción OT ${part.id} · ${part.description}`, unitPrice: part.unitPriceCents / 100, totalPrice: (part.unitPriceCents * deduct) / 100, businessVersion: 1 } })
  return { deducted: deduct, stock: product.stock }
}
/** Sufijo de evento con el resultado del movimiento de inventario vinculado. */
const stockNote = (result: { deducted: number; stock: number } | null, qty: number) =>
  result === null ? ""
    : result.deducted <= 0 ? " — sin existencias en la sucursal; no se descontó inventario"
    : ` — stock quedó en ${result.stock}${result.deducted < qty ? ` (faltan ${qty - result.deducted} sin existencias registradas)` : ""}`
/** La orden se cierra sin cobrar refacciones (cancelación, "no quedó" o
 *  entrega sin reparación): las piezas APPROVED regresan al stock — solo se
 *  repone lo descontado y no repuesto antes, así es seguro repetirlo — y las
 *  APPROVED/REQUESTED quedan REJECTED con la razón en decisionNote.
 *  Devuelve fragmentos de texto para el detalle del evento. */
async function releaseOrderParts(tx: Prisma.TransactionClient, args: {
  order: { id: string; number: number; currentBranchId: string }
  parts: ReadonlyArray<{ id: string; productId: string | null; description: string; qty: number; unitPriceCents: number; status: string }>
  actorId: string; businessId: string; note: string
  touched?: Set<string>
}): Promise<string[]> {
  const tail: string[] = []
  const released: string[] = []
  for (const part of args.parts.filter(row => row.status === "APPROVED")) {
    const result = await syncPartStock(tx, { order: args.order, part, actorId: args.actorId, businessId: args.businessId, type: "RETURN", touched: args.touched })
    if (result && result.deducted > 0) released.push(`${result.deducted} × ${part.description}`)
  }
  if (released.length) tail.push(`Refacciones liberadas a inventario: ${released.join(", ")}.`)
  const rejected = await tx.repairPart.updateMany({
    where: { orderId: args.order.id, status: { in: ["APPROVED", "REQUESTED"] } },
    data: { status: "REJECTED", decidedById: args.actorId, decidedAt: new Date(), decisionNote: args.note },
  })
  if (rejected.count > 0) tail.push(`${rejected.count} refacción(es) marcadas como no cobradas.`)
  return tail
}
/** Estados terminales para el ciclo de refacciones: la orden ya no admite
 *  agregar ni autorizar piezas (CANCELLED/DELIVERED ya las bloquean por el
 *  cierre general; NOT_AUTHORIZED/NOT_REPAIRED son cierres sin reparación). */
const PART_CLOSED_STATUSES: readonly string[] = ["NOT_AUTHORIZED", "NOT_REPAIRED", "CANCELLED", "DELIVERED"]
// Reparación en curso: una refacción que llega a APPROVED en estas etapas con
// la cotización ya autorizada cambia el total que el cliente firmó — la orden
// vuelve a WAITING_APPROVAL para re-autorización. No aplica en RECEIVED /
// DIAGNOSIS / WAITING_APPROVAL (la cotización aún no se autoriza: el cliente
// verá el total con la pieza al decidir) ni en terminales (PART_CLOSED_STATUSES
// ya bloquea el ciclo de refacciones antes). WARRANTY cuenta como "en curso":
// el reingreso puede necesitar piezas nuevas y el público las anuncia como
// con costo — "garantía sin costo" solo cubre la misma reparación.
const PART_REAUTH_STAGES: readonly string[] = ["IN_REPAIR", "WAITING_PARTS", "EXTERNAL_LAB", "QUALITY_CHECK", "READY", "WARRANTY"]
// Orden delegada al taller asociado (delegatedOrderId, ver domain/delegation):
// el trabajo vive en la orden espejo del tenant reparador y el cobro al
// cliente se hace por POS — la orden local ya no admite movimientos de dinero
// ni de stock (PART_REQUEST incluido: pedir refacciones aquí no las surte
// nadie). Las transiciones STATUS (incluido CANCELLED) siguen abiertas.
// ÚNICA excepción: REFUND sobre una delegada YA CERRADA (PART_CLOSED_STATUSES)
// — devolver el excedente no toca stock ni etapa, solo libera dinero retenido;
// delegar con anticipo vigente se rechaza en delegateRepairToPartner, pero
// órdenes anteriores al candado (o un cobro colado por carrera) pueden quedar
// con saldo a favor del cliente.
const DELEGATED_BLOCKED_ACTIONS: readonly string[] = ["PART_ADD", "PART_REQUEST", "PART_DECIDE", "PART_REMOVE", "PAYMENT", "SETTLE_DELIVER", "REFUND"]
const actionSchema = z.object({
  idempotencyKey: operationKeySchema, expectedVersion: z.number().int().min(1),
  // PART_ADD se conserva como alias del cliente actual; ambos crean la refacción
  // con flujo de autorización (PART_REQUEST).
  // ROTATE_UPLOAD_TOKEN regenera el link público de evidencias del sticker
  // (solo admin): el QR/enlace anterior muere en el lookup por token.
  action: z.enum(["NOTE", "QUOTE", "APPROVE", "STATUS", "TRANSFER", "ASSIGN", "PART_REQUEST", "PART_ADD", "PART_DECIDE", "PART_REMOVE", "PAYMENT", "SETTLE_DELIVER", "PLAN", "DIAGNOSTIC_FEE", "REFUND", "ROTATE_UPLOAD_TOKEN"]),
  detail: z.string().trim().min(1).max(2000).optional(), status: z.enum(Object.keys(repairLabels) as [keyof typeof repairLabels, ...Array<keyof typeof repairLabels>]).optional(),
  quoteCents: moneyCents.optional(), diagnosticFeeCents: moneyCents.optional(), branchId: z.string().min(1).optional(), assignedToId: z.string().min(1).optional(),
  partId: z.string().min(1).optional(), partDescription: z.string().trim().min(1).max(200).optional(),
  approve: z.boolean().optional(),
  partQty: z.number().int().min(1).max(999).default(1),
  // Importes de la refacción: opcionales — en PART_ADD/PART_REQUEST el
  // ausente queda en 0; en PART_DECIDE el ausente conserva el valor que el
  // técnico pidió (el admin solo corrige lo que envía).
  partCostCents: moneyCents.optional(), partPriceCents: moneyCents.optional(),
  partProductId: z.string().min(1).optional(),
  // Sucursal que surte la pieza (almacén de refacciones); sin ella se descuenta
  // de la sucursal actual de la orden. Se valida al crear la refacción.
  sourceBranchId: z.string().min(1).optional(),
  noteIsPublic: z.boolean().default(false),
  paymentCents: moneyCents.optional(), paymentMethod: paymentMethod.optional(),
  // Folio externo del cobro (SPEI/autorización); obligatorio en TRANSFER —
  // espejo de la regla de ventas (sales.ts): sin folio la transferencia no
  // se puede rastrear contra el estado de cuenta.
  paymentReference: z.string().trim().min(1).max(200).optional(),
  scheduledAt: z.iso.datetime().nullable().optional(), location: z.string().trim().max(80).nullable().optional(),
  // PLAN también fija/actualiza la fecha promesa de entrega (null la borra).
  promisedAt: z.iso.datetime().nullable().optional(),
  // Entrega estructurada (SETTLE_DELIVER): quién recoge el equipo — puede ser
  // un familiar o empleado distinto al titular —, su identificación opcional
  // (INE/licencia) y su firma en PNG base64, aparte de la de recepción.
  deliveredTo: z.string().trim().min(2).max(80).optional(),
  deliveredToDoc: z.string().trim().max(40).optional(),
  deliverySignatureData: z.string().max(300000).regex(/^data:image\/png;base64,/).optional(),
  // En órdenes captadas por aliado (originBusinessName/originBusinessId) el
  // equipo puede entregarse al ALIADO (PARTNER) en lugar del cliente final:
  // solo cambia el asiento del evento — el estado y el cobro no se alteran.
  deliveredToParty: z.enum(["CUSTOMER", "PARTNER"]).optional(),
  // Precio convenio editable post-recepción (hoy solo se captura al intake):
  // nullable para poder limpiarlo; el cambio deja un NOTE privado.
  partnerPriceCents: moneyCents.nullable().optional(),
})
// STATUS quedó fuera: el detalle del evento es la transición misma
// ("Recibido → En diagnóstico."), así que el avance de etapa no exige texto.
const detailRequiredActions: readonly string[] = ["NOTE", "QUOTE", "APPROVE", "TRANSFER", "ASSIGN", "REFUND"]
export async function updateRepair(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  if (detailRequiredActions.includes(input.action) && !input.detail) throw new BusinessError("Describe el detalle de la acción.")
  // REFUND es salida de dinero: solo admin (alineado con cash.ts, que exige
  // ADMIN para el OUT manual). ROTATE_UPLOAD_TOKEN revoca el QR público del
  // sticker: también es solo admin. El resto de acciones son de mostrador.
  const adminOnlyActions: readonly string[] = ["REFUND", "ROTATE_UPLOAD_TOKEN"]
  // Productos cuyo stock mueven las refacciones de esta acción (OUT/RETURN):
  // syncPartStock los registra y la alerta se sincroniza post-commit.
  const touchedProductIds = new Set<string>()
  // Si la orden es ESPEJO de una delegación (delegatedFromOrderId) y la etapa
  // cambió —por STATUS o por cualquier acción que mueva status—, el tenant
  // captador se avisa post-commit (notifyOriginOfMirrorUpdate en delegation).
  // Colección mutable como touchedProductIds: un `let` reasignado dentro del
  // callback no conserva el estrechamiento de tipos tras el await.
  const mirrorStatusSync: { originOrderId: string; fromStatus: RepairStatus; toStatus: RepairStatus; mirrorNumber: number }[] = []
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "REPAIR_UPDATE", permission: adminOnlyActions.includes(input.action) ? "admin" : "staff", payload: { id, ...input } }, async tx => {
    // La lectura de trabajo tampoco arrastra las firmas (~300 KB c/u): ninguna
    // regla del update las consulta — solo se reescriben (SETTLE_DELIVER).
    const order = await tx.repairOrder.findUnique({ where: { id }, omit: { signatureData: true, deliverySignatureData: true, deviceAccessValue: true } })
    if (!order || order.businessId !== businessId) throw new BusinessError("Orden no encontrada.", 404)
    if (order.version !== input.expectedVersion) throw new BusinessError("Otra persona actualizó esta orden. Recarga para ver el cambio antes de continuar.", 409)
    const reopeningToWarranty = order.status === "DELIVERED" && input.action === "STATUS" && input.status === "WARRANTY"
    // REFUND es la única acción permitida en órdenes cerradas: devolver un
    // anticipo no reabre el historial ni altera el estado.
    if ((order.status === "CANCELLED" || (order.status === "DELIVERED" && !reopeningToWarranty)) && input.action !== "REFUND") throw new BusinessError("La orden está cerrada. El historial se conserva.", 409)
    // Guard de delegada: la espejo en el tenant reparador es quien mueve
    // refacciones y cobra la reparación; aquí solo queda el seguimiento.
    // REFUND pasa únicamente con la delegada ya en un cierre
    // (PART_CLOSED_STATUSES): devolver el excedente al cliente no toca
    // stock ni etapa — libera dinero que quedó retenido al cerrar.
    if (order.delegatedOrderId && DELEGATED_BLOCKED_ACTIONS.includes(input.action)
      && !(input.action === "REFUND" && PART_CLOSED_STATUSES.includes(order.status))) {
      throw new BusinessError("La orden fue delegada al taller asociado; cobra al cliente por POS y gestiona el trabajo en el portal aliado.", 409)
    }
    const data: Parameters<typeof tx.repairOrder.update>[0]["data"] = { version: { increment: 1 } }
    // Precio convenio capturado/corregido post-recepción: viaja con cualquier
    // acción (un NOTE basta). El cambio queda en NOTE privado aparte — la
    // bitácora de dinero entre negocios no se edita en silencio.
    const partnerPriceChanged = input.partnerPriceCents !== undefined && input.partnerPriceCents !== order.partnerPriceCents
    if (partnerPriceChanged) data.partnerPriceCents = input.partnerPriceCents
    let detail = input.detail ?? ""
    let eventType: string = input.action
    let eventPublic = false
    // Cierre STATUS→DELIVERED de una orden delegada: nombre del taller que
    // recibe, para el asiento privado de constancia (ver el bloque STATUS).
    let delegatedDeliveryTo: string | null = null
    // Solicitudes de refacción rechazadas por el cierre delegado — viaja al
    // detalle del evento STATUS junto a la transición.
    let delegatedPartsDropped = 0
    // Dinero retenido por la orden: cobros CONFIRMED menos reembolsos
    // (filas REFUNDED con amount negativo, misma convención que ventas).
    // La suma se hace por fila en centavos (orderHeldCents): un aggregate
    // _sum de Float pesos acumulaba el error binario ANTES de redondear,
    // así que con varios pagos el saldo/excedente podía moverse un centavo.
    const heldCents = async () => orderHeldCents(
      await tx.payment.findMany({ where: { repairOrderId: id, status: { in: ["CONFIRMED", "REFUNDED"] } }, select: { amount: true, status: true } }),
    )
    const orderParts = () => tx.repairPart.findMany({ where: { orderId: id }, select: { id: true, productId: true, description: true, qty: true, unitCostCents: true, unitPriceCents: true, status: true } })
    // Ciclo de refacciones cerrado en estados terminales (incluye los cierres
    // sin reparación, que el bloqueo general de cerradas no alcanza): no se
    // agregan ni se autorizan piezas sobre una orden que ya no se cobra así.
    if (["PART_REQUEST", "PART_ADD", "PART_DECIDE"].includes(input.action) && PART_CLOSED_STATUSES.includes(order.status)) {
      throw new BusinessError("La orden está cerrada; las refacciones ya no se pueden agregar ni resolver.", 409)
    }
    // Re-autorización del cliente: una refacción con cargo que llega a
    // APPROVED (PART_ADD de admin o PART_DECIDE) cuando la cotización ya fue
    // autorizada —o cuando NO hay autorización vigente pero la orden ya está
    // en trabajo— cambiaría el total entregado sin que el cliente lo viera.
    // La orden vuelve a WAITING_APPROVAL, el link público muestra el nuevo
    // total y su vigencia se reinicia. El aviso público se emite al final
    // junto al evento PART privado (que lleva el detalle de la pieza). Si la
    // orden YA esperaba re-autorización solo se renueva la vigencia — sin
    // duplicar el aviso.
    let partReauthNotice = false
    const onPartApproved = (part: { qty: number; unitPriceCents: number }) => {
      const inWorkStage = PART_REAUTH_STAGES.includes(order.status)
      const reauth = order.quoteApprovedAt !== null && inWorkStage
      const pendingDecision = order.status === "WAITING_APPROVAL"
      // Pieza CON cargo aprobada en pleno trabajo SIN autorización vigente
      // —ni una cotización ya autorizada (quoteApprovedAt) ni una
      // presentada esperando decisión (WAITING_APPROVAL)—: cobraría
      // refacciones que el cliente jamás autorizó. Es la ruta sin
      // cotización del hueco original: EXTERNAL_LAB→READY sin QUOTE, o un
      // reingreso de garantía con la autorización limpia. Se dispara la
      // MISMA re-autorización: la orden vuelve a WAITING_APPROVAL y el
      // total (mano de obra + piezas) queda pendiente de decisión.
      // Piezas gratuitas no exigen nada — no cambian el cobro.
      const unauthorizedCharge = inWorkStage && order.quoteApprovedAt === null && part.qty * part.unitPriceCents > 0
      if (!reauth && !pendingDecision && !unauthorizedCharge) return
      const expires = quoteExpiry()
      Object.assign(data, { quoteExpiresAt: expires, quoteTokenExpiresAt: expires })
      if (reauth || unauthorizedCharge) {
        Object.assign(data, { quoteApprovedAt: null, status: "WAITING_APPROVAL" })
        partReauthNotice = true
      }
    }
    if (input.action === "QUOTE") {
      if (!["DIAGNOSIS", "WAITING_APPROVAL"].includes(order.status) || input.quoteCents === undefined) throw new BusinessError("Registra el diagnóstico e importe antes de solicitar autorización.", 409)
      // El documento promete "Válida por 15 días": la vigencia se fija al
      // (re)presentar la cotización y el link público muere con ella.
      const expires = quoteExpiry()
      // Al (re)presentar la cotización se ROTA el quoteToken: el link que el
      // cliente recibe corresponde a ESTA presentación — cualquier copia del
      // enlace anterior (un WhatsApp viejo reenviado, un sticker) muere aquí.
      Object.assign(data, { diagnosis: input.detail, quoteCents: input.quoteCents, approvedQuoteCents: null, quoteApprovedAt: null, status: "WAITING_APPROVAL", quoteExpiresAt: expires, quoteToken: newQuoteToken(), quoteTokenExpiresAt: expires })
      detail = `Presupuesto ${(input.quoteCents / 100).toFixed(2)} MXN. ${input.detail}`
      eventPublic = true
    } else if (input.action === "APPROVE") {
      if (order.status !== "WAITING_APPROVAL" || order.quoteCents === null) throw new BusinessError("No hay presupuesto pendiente de autorizar.", 409)
      Object.assign(data, { approvedQuoteCents: order.quoteCents, quoteApprovedAt: new Date(), status: "IN_REPAIR" })
      detail = `Autorización registrada por el operador para ${(order.quoteCents / 100).toFixed(2)} MXN. ${input.detail}`
      eventPublic = true
    } else if (input.action === "STATUS") {
      // DELIVERED no es destino válido de STATUS: la entrega física solo
      // ocurre por SETTLE_DELIVER, que cobra el saldo y cierra refacciones.
      // Orden delegada (delegatedOrderId): la local es solo referencia — el
      // trabajo y el cobro de reparación viven en la espejo del taller
      // asociado — así que sus ÚNICOS destinos por STATUS son los cierres
      // DELIVERED/CANCELLED (de otro modo quedaría abierta para siempre).
      // Moverla a etapas de trabajo la dejaría zombie: el status diría
      // IN_REPAIR/READY mientras las acciones de dinero/stock siguen
      // bloqueadas por DELEGATED_BLOCKED_ACTIONS.
      const allowedStatuses: readonly string[] = order.delegatedOrderId
        ? ["DELIVERED", "CANCELLED"]
        : repairNextStages[order.status]
      if (!input.status || !allowedStatuses.includes(input.status)) throw new BusinessError("El cambio de estado no corresponde a la etapa actual.", 409)
      data.status = input.status
      if (order.delegatedOrderId && input.status === "DELIVERED") {
        // Cierre de una delegada CON constancia de entrega — la única vía de
        // entrega que no pasa por SETTLE_DELIVER. Quien "recoge" el equipo es
        // el taller asociado (la entrega física al cliente la hace él desde
        // el portal aliado): se asienta su nombre de negocio como receptor y
        // al staff local como quien entregó, misma auditoría que la entrega
        // normal. El QR del sticker muere como en cualquier entrega y se
        // limpia la vigencia de garantía si quedara una abierta.
        const partner = order.delegatedToBusinessId
          ? await tx.business.findUnique({ where: { id: order.delegatedToBusinessId }, select: { name: true } })
          : null
        delegatedDeliveryTo = partner?.name?.trim() || "Taller asociado"
        // La entrega abre la ventana de reclamo de garantía igual que
        // SETTLE_DELIVER — aunque el trabajo lo hizo el taller asociado,
        // frente al cliente la responsable es la orden local.
        const warrantyDays = await warrantyDaysOf(tx, businessId)
        // Solicitudes de refacción que quedaron pendientes (anteriores a la
        // delegación) no pueden colgar tras el cierre: la orden cerrada ya
        // no admite PART_DECIDE — se rechazan aquí (nunca descontaron stock).
        delegatedPartsDropped = (await tx.repairPart.updateMany({
          where: { orderId: id, status: "REQUESTED" },
          data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionNote: "La orden se entregó al taller asociado; la solicitud quedó sin resolver." },
        })).count
        Object.assign(data, rotatedUploadToken(), { warrantyUntil: null, warrantyEligibleUntil: new Date(Date.now() + warrantyDays * 24 * 60 * 60 * 1000), deliveredTo: delegatedDeliveryTo, deliveredById: actorId })
      }
      if (input.status === "READY") data.qualityCheck = input.detail ?? null
      // El detalle es opcional: sin texto del staff el evento conserva solo
      // la transición ("Etapa anterior → Etapa nueva.").
      detail = `${repairLabels[order.status]} → ${repairLabels[input.status]}.${input.detail ? ` ${input.detail}` : ""}`
      if (delegatedPartsDropped > 0) detail = `${detail} ${delegatedPartsDropped} solicitud(es) de refacción pendientes se rechazaron con la entrega.`
      // El cambio de etapa es el progreso que ve el cliente en seguimiento;
      // el texto libre del staff va después del punto y se trunca al publicar.
      eventPublic = true
      if (input.status === "WARRANTY") {
        // Tope de ciclos de garantía: warrantyCount ya cuenta los reingresos
        // previos (se incrementa abajo en el mismo update). Agotado el tope —
        // SystemSettings `warranty_max_cycles` del negocio, default 3 — la
        // salida correcta es una orden NUEVA: aplica parejo y se evalúa ANTES
        // que la ventana vencida de abajo, que sí admite override de admin
        // (darle ese mensaje a un empleado cuando la orden ya llegó al tope
        // lo mandaría a pedir una autorización que igual va a fallar).
        const maxCycles = await warrantyMaxCyclesOf(tx, businessId)
        if (order.warrantyCount >= maxCycles) {
          throw new BusinessError(`La orden alcanzó el máximo de reingresos por garantía (${maxCycles}). Crea una orden nueva.`, 409)
        }
        // La ventana para reclamar garantía se fija en CADA entrega
        // (warrantyEligibleUntil — SETTLE_DELIVER y el cierre delegado la
        // renuevan como now + warranty_days). Vencida, un empleado de
        // mostrador no puede reabrir la orden por su cuenta: exige ADMIN.
        // Órdenes entregadas antes del campo quedan null y no las aplica.
        if (order.warrantyEligibleUntil && order.warrantyEligibleUntil.getTime() < Date.now()) {
          const me = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } })
          if (me?.role !== "ADMIN") {
            throw new BusinessError("La garantía ya venció; solicita autorización de un administrador para reabrir la orden.", 409)
          }
        }
        // Reingreso por garantía (solo desde DELIVERED, ver repairNextStages):
        // abre un ciclo con vigencia — warranty_days del negocio en
        // SystemSettings (default 30) — y cuenta las entradas a garantía.
        // El ciclo cierra cuando la orden vuelve a entregarse por
        // SETTLE_DELIVER (ahí warrantyUntil se limpia).
        const until = new Date(Date.now() + (await warrantyDaysOf(tx, businessId)) * 24 * 60 * 60 * 1000)
        // closedWithoutRepair se limpia al reabrir: con la marca en true
        // orderTotalCents seguiría cobrando solo el diagnóstico en la segunda
        // entrega y las refacciones del ciclo de garantía saldrían gratis.
        // Si la garantía también cierra sin reparación (WARRANTY→NOT_REPAIRED
        // →SETTLE_DELIVER), la marca vuelve a true y se liberan las piezas.
        Object.assign(data, { warrantyUntil: until, warrantyCount: { increment: 1 }, closedWithoutRepair: false })
        detail = `${repairLabels[order.status]} → ${repairLabels[input.status]}. Garantía ${order.warrantyCount + 1} — válida hasta ${until.toLocaleDateString("es-MX", { dateStyle: "medium" })}.${input.detail ? ` ${input.detail}` : ""}`
      }
      if (input.status === "CANCELLED" || input.status === "NOT_REPAIRED") {
        // Cierre sin cobrar refacciones: las APPROVED regresan al stock y
        // todas quedan REJECTED — una cancelada ya no admite PART_REMOVE, así
        // que sin esta reposición el inventario quedaría descontado para
        // siempre. En NOT_AUTHORIZED la liberación ocurre al entregar.
        const tail = await releaseOrderParts(tx, { order, parts: await orderParts(), actorId, businessId, note: input.status === "CANCELLED" ? "La orden se canceló; no se cobra." : "La orden se cerró sin reparación; no se cobra.", touched: touchedProductIds })
        if (tail.length) detail = `${detail} ${tail.join(" ")}`
      }
      if (input.status === "CANCELLED") {
        // La cancelación rota el token de evidencias: el QR del sticker que
        // quedó en el equipo/cliente muere (404) y deja de ser una puerta
        // trasera permanente. NOT_REPAIRED no rota aquí — la orden sigue
        // abierta hasta la entrega (SETTLE_DELIVER) y el sticker todavía
        // sirve para documentar el estado en que sale el equipo.
        Object.assign(data, rotatedUploadToken())
        if (order.delegatedOrderId) {
          // La espejo vive en OTRO tenant: cancelar la local no la alcanza.
          // El aviso queda en el evento para que el staff la cierre a mano
          // en el portal aliado si corresponde.
          detail = `${detail} Aviso: la orden espejo sigue activa en el taller asociado — su cierre se gestiona por separado en el portal aliado.`
        }
      }
    } else if (input.action === "ASSIGN") {
      const assignee = input.assignedToId ? await tx.user.findFirst({ where: { id: input.assignedToId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] }, businessId } }) : null
      if (!assignee) throw new BusinessError("Selecciona una persona habilitada.")
      data.assignedToId = assignee.id
      detail = `Responsable: ${assignee.name}. ${input.detail}`
    } else if (input.action === "TRANSFER") {
      const branch = input.branchId ? await tx.branch.findFirst({ where: { id: input.branchId, isActive: true, businessId } }) : null
      if (!branch || branch.id === order.currentBranchId) throw new BusinessError("Selecciona una sucursal destino distinta y activa.")
      data.currentBranchId = branch.id
      detail = `Ubicación actualizada a ${branch.name}. ${input.detail}`
    } else if (input.action === "PLAN") {
      const when = input.scheduledAt === undefined ? undefined : input.scheduledAt === null ? null : new Date(input.scheduledAt)
      const promised = input.promisedAt === undefined ? undefined : input.promisedAt === null ? null : new Date(input.promisedAt)
      if (when === undefined && promised === undefined && input.location === undefined) throw new BusinessError("Define la fecha programada, la fecha promesa o la locación.")
      if (when !== undefined) data.scheduledAt = when
      if (promised !== undefined) data.promisedAt = promised
      if (input.location !== undefined) data.location = input.location || null
      const pieces = [
        when ? `reparación programada para ${when.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}` : "",
        promised ? `entrega prometida para ${promised.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}` : promised === null ? "fecha promesa eliminada" : "",
        input.location ? `locación ${input.location}` : "",
      ].filter(Boolean)
      detail = `Plan actualizado: ${pieces.join(", ")}. ${input.detail ?? ""}`.trim()
      eventType = "NOTE"
    } else if (input.action === "PAYMENT") {
      if (input.paymentCents === undefined || input.paymentCents <= 0) throw new BusinessError("Indica el monto del abono.")
      if (!input.paymentMethod) throw new BusinessError("Selecciona el método de cobro.")
      // Sobrepago silencioso: un abono no puede superar el saldo pendiente
      // (total de la orden — mano de obra + refacciones autorizadas, o el
      // cargo de diagnóstico en cierres sin reparación — menos lo retenido).
      const pendingCents = orderTotalCents(order, await orderParts()) - await heldCents()
      if (input.paymentCents > pendingCents) throw new BusinessError(`El abono excede el saldo pendiente de ${(Math.max(0, pendingCents) / 100).toFixed(2)} MXN.`, 409)
      if (input.paymentMethod === "TRANSFER" && !input.paymentReference) throw new BusinessError("Captura la referencia de la transferencia.")
      await registerPayment(tx, { orderId: id, orderNumber: order.number, branchId: order.currentBranchId, actorId, businessId, amountCents: input.paymentCents, method: input.paymentMethod, purpose: "ABONO", note: input.detail, reference: input.paymentReference })
      eventType = "PAYMENT"
      detail = `Abono ${(input.paymentCents / 100).toFixed(2)} MXN (${input.paymentMethod}). ${input.detail ?? ""}`.trim()
    } else if (input.action === "REFUND") {
      if (input.paymentCents === undefined || input.paymentCents <= 0) throw new BusinessError("Indica el monto a devolver.")
      if (!input.paymentMethod) throw new BusinessError("Selecciona el método de devolución.")
      // Misma regla que el cobro (PAYMENT/SETTLE_DELIVER): la devolución por
      // transferencia exige su folio SPEI — sin él no se rastrea contra el
      // estado de cuenta ni se concilia la salida.
      if (input.paymentMethod === "TRANSFER" && !input.paymentReference) throw new BusinessError("Captura la referencia de la transferencia.")
      // Reembolso de anticipo/excedente (p. ej. al cancelar o al entregar sin
      // reparación): solo es devolvable lo cobrado de más sobre el total —
      // el dinero que aún se debe no es reembolsable. Se registra como pago
      // negativo con status REFUNDED, igual que las devoluciones de ventas.
      const refundableCents = await heldCents() - orderTotalCents(order, await orderParts())
      if (input.paymentCents > refundableCents) throw new BusinessError(`La devolución excede lo cobrado de más (${(Math.max(0, refundableCents) / 100).toFixed(2)} MXN).`, 409)
      const payment = await tx.payment.create({ data: { businessId, repairOrderId: id, purpose: "REFUND", method: input.paymentMethod, amount: -input.paymentCents / 100, status: "REFUNDED", reference: input.paymentReference ?? null, createdById: actorId, notes: input.detail ?? null } })
      // Reembolso por tarjeta sin folio de la terminal: el asiento no
      // concilia contra el estado de cuenta. El panel de reembolso aún no
      // captura el folio (TRANSFER sí lo exige arriba), así que no se
      // bloquea — el hueco queda visible en la bitácora.
      if (input.paymentMethod === "CARD" && !input.paymentReference) {
        const warnFmt = await folioFormatOf(tx, businessId)
        await recordAudit(tx, {
          businessId, actorId,
          action: "REFUND_NO_REFERENCE",
          entity: "payment",
          entityId: payment.id,
          entityName: `Orden ${repairFolio(order.number, warnFmt.digits, warnFmt.prefix)}`,
          summary: `Reembolso por tarjeta de ${(input.paymentCents / 100).toFixed(2)} MXN sin folio de la terminal — el asiento no concilia contra el estado de cuenta.`,
        })
      }
      if (input.paymentMethod === "CASH") {
        const register = await openRegister(tx, order.currentBranchId, businessId)
        // Igual que las devoluciones de venta: la caja no queda en negativo —
        // si no alcanza el efectivo se rechaza antes de registrar la salida.
        const availableCents = await registerCashCents(tx, register.id)
        if (input.paymentCents > availableCents) throw new BusinessError("El efectivo en caja no alcanza para esta devolución.", 409)
        const refundFmt = await folioFormatOf(tx, businessId)
        const movement = await tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: "OUT", amount: input.paymentCents / 100, description: `Taller ${repairFolio(order.number, refundFmt.digits, refundFmt.prefix)} · reembolso`, referenceType: "REPAIR_REFUND", referenceId: payment.id } })
        await tx.payment.update({ where: { id: payment.id }, data: { cashMovementId: movement.id } })
      }
      eventType = "PAYMENT"
      detail = `Reembolso ${(input.paymentCents / 100).toFixed(2)} MXN (${input.paymentMethod}). ${input.detail}`
    } else if (input.action === "SETTLE_DELIVER") {
      // Única vía de entrega: cobra el saldo y cierra las refacciones. Las
      // etapas entregables viven en repairDeliverableStages (STATUS nunca
      // llega a DELIVERED por sí solo).
      if (!repairDeliverableStages.includes(order.status)) throw new BusinessError("La orden aún no está lista para entregarse.", 409)
      // Constancia de entrega: el receptor es dato propio (no el detalle libre)
      // porque quien recoge puede no ser el titular — familiar, empleado, etc.
      if (!input.deliveredTo) throw new BusinessError("Indica el nombre de quien recoge el equipo.")
      const recipientLabel = input.deliveredToDoc ? `${input.deliveredTo} · ID: ${input.deliveredToDoc}` : input.deliveredTo
      // Entrega al ALIADO captador (deliveredToParty "PARTNER"): en órdenes
      // de convenio el equipo puede regresar al negocio que lo trajo — él lo
      // entrega a su cliente. Solo cambia el asiento del evento; el estado,
      // el cobro y la constancia (deliveredTo/firma) siguen igual.
      const isPartnerOrigin = order.originBusinessName != null || order.originBusinessId != null
      const partnerRecipient = input.deliveredToParty === "PARTNER" && isPartnerOrigin
        ? (order.originBusinessName
            ?? (order.originBusinessId
              ? (await tx.business.findUnique({ where: { id: order.originBusinessId }, select: { name: true } }))?.name
              : null))
        : null
      const deliveryClause = partnerRecipient ? `Entregado al aliado ${partnerRecipient}` : `Entrega a: ${recipientLabel}`
      const withoutRepair = order.status === "NOT_AUTHORIZED" || order.status === "NOT_REPAIRED"
      const parts = await orderParts()
      const held = await heldCents()
      // Total a cobrar: en cierres sin reparación solo el cargo de diagnóstico
      // (la cotización rechazada y sus refacciones no se cobran); en el resto
      // mano de obra + refacciones autorizadas.
      const totalCents = orderTotalCents(order, parts)
      const balanceCents = Math.max(0, totalCents - held)
      const overpaidCents = Math.max(0, held - totalCents)
      if (balanceCents > 0 && !input.paymentMethod) throw new BusinessError(`Restan ${(balanceCents / 100).toFixed(2)} MXN por cobrar. Selecciona el método.`, 409)
      if (balanceCents > 0 && input.paymentMethod === "TRANSFER" && !input.paymentReference) throw new BusinessError("Captura la referencia de la transferencia.")
      const tail: string[] = []
      if (withoutRepair) {
        // Las refacciones no se cobran: las APPROVED regresan al stock y
        // quedan REJECTED junto con las REQUESTED. Es idempotente — quien
        // llegó a NOT_REPAIRED por STATUS ya liberó su inventario ahí; esto
        // además cubre órdenes anteriores a esa regla.
        tail.push(...await releaseOrderParts(tx, { order, parts, actorId, businessId, note: "La orden se entregó sin reparación; no se cobra.", touched: touchedProductIds }))
      }
      // Solicitudes de refacción que quedaron sin resolver (REQUESTED) no
      // pueden colgar tras la entrega: la orden cerrada ya no admite
      // PART_DECIDE — se rechazan con la entrega misma. Nunca descontaron
      // stock, así que es solo el cambio de estado (en el cierre sin
      // reparación releaseOrderParts ya las cubrió: count 0).
      const droppedRequests = await tx.repairPart.updateMany({
        where: { orderId: id, status: "REQUESTED" },
        data: { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionNote: "La orden se entregó; la solicitud quedó sin resolver." },
      })
      if (droppedRequests.count > 0) tail.push(`${droppedRequests.count} solicitud(es) de refacción pendientes se rechazaron con la entrega.`)
      if (balanceCents > 0) {
        await registerPayment(tx, { orderId: id, orderNumber: order.number, branchId: order.currentBranchId, actorId, businessId, amountCents: balanceCents, method: input.paymentMethod!, purpose: "SETTLEMENT", note: input.detail, reference: input.paymentReference })
        detail = `${withoutRepair ? "Cargo de diagnóstico/revisión" : "Liquidado"} ${(balanceCents / 100).toFixed(2)} MXN (${input.paymentMethod}). ${deliveryClause}`
      } else detail = `Sin saldo pendiente. ${deliveryClause}`
      if (input.detail) detail = `${detail}. ${input.detail}`
      // Si el cliente pagó de más (anticipo mayor al cargo final) el excedente
      // queda documentado para registrar el reembolso con la acción REFUND.
      if (overpaidCents > 0) tail.push(`Excedente pendiente de devolver al cliente: ${(overpaidCents / 100).toFixed(2)} MXN.`)
      if (tail.length) detail = `${detail} ${tail.join(" ")}`
      // El cierre sin reparación persiste en closedWithoutRepair: el status
      // pasa a DELIVERED, pero el total de la orden sigue siendo solo el
      // cargo de diagnóstico (workshop-money) y el excedente es devolvible.
      Object.assign(data, {
        status: "DELIVERED",
        deliveredTo: input.deliveredTo,
        deliveredToDoc: input.deliveredToDoc || null,
        // La firma solo se reemplaza cuando llega una nueva: en la
        // re-entrega por garantía sin firma nueva NO se pisa la de la
        // entrega anterior — es la constancia legal de aquella entrega.
        ...(input.deliverySignatureData ? { deliverySignatureData: input.deliverySignatureData } : {}),
        // Auditoría de mostrador: quién del staff entregó el equipo.
        deliveredById: actorId,
        // El QR de evidencias impreso en el sticker del cliente muere con la
        // entrega: se rota el token (la orden conserva uno interno vigente).
        ...rotatedUploadToken(),
        // Si la orden reingresó por garantía, esta entrega cierra el ciclo:
        // la vigencia se limpia (warrantyCount conserva el historial) y la
        // VENTANA de reclamo se renueva — es el dato que el guard de
        // STATUS→WARRANTY consulta (warranty_days del negocio, default 30).
        warrantyUntil: null,
        warrantyEligibleUntil: new Date(Date.now() + (await warrantyDaysOf(tx, businessId)) * 24 * 60 * 60 * 1000),
        ...(withoutRepair ? { closedWithoutRepair: true } : {}),
      })
      eventType = "PAYMENT"
    } else if (input.action === "DIAGNOSTIC_FEE") {
      // Cargo por diagnóstico/revisión: lo único cobrable al entregar sin
      // reparación. Editable mientras la orden está en el cierre sin
      // reparación (antes de entregar queda bloqueada).
      if (order.status !== "NOT_AUTHORIZED" && order.status !== "NOT_REPAIRED") throw new BusinessError("El cargo por diagnóstico solo aplica a órdenes cerradas sin reparación.", 409)
      if (input.diagnosticFeeCents === undefined) throw new BusinessError("Indica el cargo por diagnóstico/revisión.")
      data.diagnosticFeeCents = input.diagnosticFeeCents
      detail = `Cargo por diagnóstico/revisión: ${(input.diagnosticFeeCents / 100).toFixed(2)} MXN.${input.detail ? ` ${input.detail}` : ""}`
    } else if (input.action === "PART_REQUEST" || input.action === "PART_ADD") {
      if (!input.partDescription) throw new BusinessError("Describe la refacción.")
      const partProduct = input.partProductId ? await tx.product.findFirst({ where: { id: input.partProductId, businessId } }) : null
      if (input.partProductId && !partProduct) throw new BusinessError("El producto seleccionado no existe.")
      // Un producto dado de baja no se liga a la orden ni descuenta stock —
      // misma barrera que takeStock del inventario.
      if (partProduct && !partProduct.isActive) throw new BusinessError("El producto seleccionado ya no está disponible.", 409)
      // Almacén de refacciones: la pieza puede salir de cualquier sucursal
      // activa del negocio. El OUT de inventario se registra contra esa
      // sucursal (syncPartStock) y la devolución lo sigue.
      const sourceBranch = input.sourceBranchId ? await tx.branch.findFirst({ where: { id: input.sourceBranchId, isActive: true, businessId } }) : null
      if (input.sourceBranchId && !sourceBranch) throw new BusinessError("La sucursal que surte no existe o está inactiva.", 404)
      const actorUser = await tx.user.findUnique({ where: { id: actorId } })
      const needsApproval = actorUser?.role === "EMPLOYEE"
      // Nace APPROVED (admin): queda estampada quién autorizó y cuándo —
      // misma auditoría que una resuelta por PART_DECIDE. Las REQUESTED
      // del técnico se estampan al decidirse.
      const part = await tx.repairPart.create({ data: { businessId, orderId: id, productId: input.partProductId ?? null, description: input.partDescription, qty: input.partQty, unitCostCents: input.partCostCents ?? 0, unitPriceCents: input.partPriceCents ?? 0, sourceBranchId: sourceBranch?.id ?? null, createdById: actorId, status: needsApproval ? "REQUESTED" : "APPROVED", ...(needsApproval ? {} : { decidedById: actorId, decidedAt: new Date() }) } })
      eventType = "PART"
      // Las creadas ya APPROVED (administrador) descuentan stock de inmediato;
      // las REQUESTED del técnico lo descuentan recién en PART_DECIDE.
      const addedStock = needsApproval ? null : await syncPartStock(tx, { order, part, actorId, businessId, type: "OUT", touched: touchedProductIds })
      const sourceNote = sourceBranch && sourceBranch.id !== order.currentBranchId ? ` · surte ${sourceBranch.name}` : ""
      detail = needsApproval
        ? `Refacción solicitada: ${part.qty} × ${part.description}${sourceNote} — pendiente de autorización`
        : `Refacción agregada: ${part.qty} × ${part.description}${sourceNote} — ${(part.unitPriceCents / 100).toFixed(2)} MXN${stockNote(addedStock, part.qty)}`
      // PART_ADD del admin nace APPROVED: mismo cambio de total que decide
      // PART_DECIDE — aplica la misma re-autorización del cliente.
      if (!needsApproval) onPartApproved(part)
    } else if (input.action === "PART_DECIDE") {
      const actorUser = await tx.user.findUnique({ where: { id: actorId } })
      if (actorUser?.role !== "ADMIN") throw new BusinessError("Solo el administrador autoriza refacciones.", 403)
      if (input.approve === undefined) throw new BusinessError("Indica si autorizas o rechazas la refacción.")
      const part = input.partId ? await tx.repairPart.findFirst({ where: { id: input.partId, orderId: id } }) : null
      if (!part) throw new BusinessError("La refacción no pertenece a esta orden.", 404)
      // Corrección de importes en la misma decisión: el técnico pidió la
      // pieza con un precio/costo estimado y el admin lo ajusta al resolver
      // (partPriceCents/partCostCents opcionales — el ausente conserva el
      // valor pedido). El evento documenta el cambio, que es la cifra real
      // que se cobra y con la que se evalúa la re-autorización.
      const correctedCost = input.partCostCents ?? part.unitCostCents
      const correctedPrice = input.partPriceCents ?? part.unitPriceCents
      const priceChanged = correctedCost !== part.unitCostCents || correctedPrice !== part.unitPriceCents
      const decided = await tx.repairPart.updateMany({
        where: { id: part.id, status: "REQUESTED" },
        data: input.approve
          ? { status: "APPROVED", decidedById: actorId, decidedAt: new Date(), unitCostCents: correctedCost, unitPriceCents: correctedPrice }
          : { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionNote: input.detail ?? null, unitCostCents: correctedCost, unitPriceCents: correctedPrice },
      })
      if (decided.count !== 1) throw new BusinessError("La refacción ya fue autorizada o rechazada.", 409)
      eventType = "PART"
      const corrected = { ...part, unitCostCents: correctedCost, unitPriceCents: correctedPrice }
      const decidedStock = input.approve ? await syncPartStock(tx, { order, part: corrected, actorId, businessId, type: "OUT", touched: touchedProductIds }) : null
      const correctionNote = priceChanged ? ` — precio corregido de ${(part.unitPriceCents / 100).toFixed(2)} a ${(correctedPrice / 100).toFixed(2)} MXN` : ""
      detail = input.approve
        ? `Refacción autorizada: ${part.qty} × ${part.description} — ${(correctedPrice / 100).toFixed(2)} MXN${correctionNote}${stockNote(decidedStock, part.qty)}`
        : `Refacción rechazada: ${part.qty} × ${part.description}${correctionNote}${input.detail ? `. ${input.detail}` : ""}`
      // Solo al autorizar: la pieza se vuelve cobrable y puede detonar la
      // re-autorización del cliente. Un rechazo no cambia el total.
      if (input.approve) onPartApproved(corrected)
    } else if (input.action === "PART_REMOVE") {
      const part = input.partId ? await tx.repairPart.findFirst({ where: { id: input.partId, orderId: id } }) : null
      if (!part) throw new BusinessError("La refacción no pertenece a esta orden.", 404)
      const actorUser = await tx.user.findUnique({ where: { id: actorId } })
      const isAdmin = actorUser?.role === "ADMIN"
      // REQUESTED solo la retira quien la pidió (el admin la resuelve con PART_DECIDE);
      // APPROVED/REJECTED solo las elimina el administrador.
      const allowed = part.status === "REQUESTED" ? part.createdById === actorId : isAdmin
      if (!allowed) throw new BusinessError(part.status === "REQUESTED" ? "Solo quien la solicitó puede retirarla; el administrador la autoriza o rechaza." : "Solo el administrador puede retirar una refacción autorizada o rechazada.", 403)
      await tx.repairPart.delete({ where: { id: part.id } })
      eventType = "PART"
      // Solo las APPROVED llegaron a descontar stock; REQUESTED/REJECTED nunca lo tocaron.
      const removedStock = part.status === "APPROVED" ? await syncPartStock(tx, { order, part, actorId, businessId, type: "RETURN", touched: touchedProductIds }) : null
      detail = `Refacción retirada: ${part.description}${stockNote(removedStock, part.qty)}`
    } else if (input.action === "ROTATE_UPLOAD_TOKEN") {
      // Regeneración manual del link público de evidencias (solo admin): si
      // el QR del sticker se extravió o se difundió, el token nuevo mata el
      // enlace anterior en el lookup por uploadToken y reinicia la vigencia.
      Object.assign(data, rotatedUploadToken())
      eventType = "NOTE"
      detail = `Se regeneró el link de evidencias.${input.detail ? ` ${input.detail}` : ""}`
    } else if (input.action === "NOTE") {
      eventPublic = input.noteIsPublic
    }
    // Órdenes históricas sin ligar (customerId null: anteriores a la FK o
    // recibidas antes del alta del cliente) se ligan al vuelo en cuanto el
    // teléfono empata con el directorio. No existe edición de customerPhone,
    // así que la re-liga solo ocurre aquí y al crear.
    if (order.customerId === null) {
      const linked = await linkCustomerByPhone(tx, businessId, order.customerPhone)
        ?? await linkCustomerByPhone(tx, businessId, order.customerPhoneAlt)
      if (linked) data.customerId = linked
    }
    const result = await tx.repairOrder.updateMany({ where: { id, businessId, version: input.expectedVersion }, data })
    if (result.count !== 1) throw new BusinessError("La orden cambió durante la operación.", 409)
    await tx.repairEvent.create({ data: { businessId, actorId, orderId: id, type: eventType, detail, isPublic: eventPublic } })
    if (partnerPriceChanged) {
      // Bitácora privada del precio convenio: de dónde a dónde quedó — la
      // cuenta B2B (convenio.ts) lee este campo al liquidar.
      const priceText = (v: number | null) => v == null ? "—" : `$${(v / 100).toFixed(2)}`
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: id, type: "NOTE", detail: `Precio convenio: ${priceText(order.partnerPriceCents)} → ${priceText(input.partnerPriceCents ?? null)} MXN`, isPublic: false } })
    }
    if (partReauthNotice) {
      // Aviso limpio para el cliente en seguimiento: el detalle de la pieza
      // quedó en el evento PART privado; aquí solo se comunica que la
      // cotización cambió y vuelve a esperar su autorización.
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: id, type: "NOTE", detail: "Se actualizó la cotización con una nueva refacción — esperando tu autorización.", isPublic: true } })
    }
    if (input.action === "SETTLE_DELIVER") {
      // La entrega queda como evento PAYMENT (privado: lleva montos y el nombre
      // del receptor). Este segundo evento limpio es el que el cliente ve en
      // seguimiento y el que marca "Entregado" en su timeline.
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: id, type: "STATUS", detail: `${repairLabels[order.status]} → ${repairLabels.DELIVERED}. Entrega registrada.`, isPublic: true } })
    }
    if (delegatedDeliveryTo) {
      // Constancia PRIVADA del handoff al taller asociado — el equivalente al
      // "Entrega a: …" del evento PAYMENT de SETTLE_DELIVER. El nombre del
      // negocio receptor no se publica en el seguimiento del cliente (el
      // evento STATUS público ya conserva la transición de etapa).
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: id, type: "NOTE", detail: `Entrega registrada: recibe ${delegatedDeliveryTo} (taller asociado).`, isPublic: false } })
    }
    // Igual que en createRepair: la orden devuelta es el recibo idempotente y
    // la respuesta POST/PATCH — sin firmas ni el desbloqueo cifrado.
    const updated = await tx.repairOrder.findUniqueOrThrow({ where: { id }, omit: { signatureData: true, deliverySignatureData: true, deviceAccessValue: true } })
    // Orden espejo: cualquier cambio de etapa se propaga al captador tras el
    // commit. Se captura aquí (dentro de la tx) para que un replay idempotente
    // de la operación —que no ejecuta este callback— no duplique el aviso.
    if (order.delegatedFromOrderId && updated.status !== order.status) {
      mirrorStatusSync.push({ originOrderId: order.delegatedFromOrderId, fromStatus: order.status, toStatus: updated.status, mirrorNumber: order.number })
    }
    return { order: updated }
  })
  // Post-commit: la alerta de stock bajo nunca corre dentro de la transacción.
  await syncLowStockAlerts(db, businessId, [...touchedProductIds])
  // Post-commit: espejo → origen. Import perezoso (delegation importa
  // createRepair de este módulo: un import estático sería circular) y el
  // helper es best-effort total — jamás revierte ni reporta el updateRepair.
  if (mirrorStatusSync.length > 0) {
    const { notifyOriginOfMirrorUpdate } = await import("./delegation")
    await notifyOriginOfMirrorUpdate(db, { mirrorBusinessId: businessId, ...mirrorStatusSync[0] })
  }
  return result
}
