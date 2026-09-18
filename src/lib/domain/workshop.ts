import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, openRegister, operation, operationKeySchema, registerCashCents } from "./operations"
import { linkCustomerByPhone } from "./customers"
import { repairDeliverableStages, repairFolio, repairLabels, repairNextStages } from "../workshop-labels"
import { orderTotalCents } from "../workshop-money"

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
  // Anticipo cobrado en recepción; con caja abierta genera su asiento de caja.
  advance: z.object({ amountCents: moneyCents, method: paymentMethod }).optional(),
})
async function registerPayment(tx: Prisma.TransactionClient, args: {
  orderId: string; orderNumber: number; branchId: string; actorId: string; businessId: string
  amountCents: number; method: "CASH" | "CARD" | "TRANSFER"; purpose: "ADVANCE" | "ABONO" | "SETTLEMENT"; note?: string
}) {
  // Cobrar en efectivo exige caja abierta (misma regla que el reembolso): sin
  // asiento de caja el cobro quedaría fuera del corte del turno. Tarjeta y
  // transferencia no pasan por caja y pueden cobrarse sin ella.
  let register: { id: string } | null = null
  if (args.method === "CASH") {
    const registers = await tx.cashRegister.findMany({ where: { status: "OPEN", branchId: args.branchId, businessId: args.businessId }, take: 2 })
    if (registers.length !== 1) throw new BusinessError(registers.length ? "Hay más de una caja abierta en la sucursal; requiere revisión." : "Abre la caja antes de cobrar en efectivo.", 409, "REGISTER_REQUIRED")
    register = registers[0]
  }
  const payment = await tx.payment.create({ data: { businessId: args.businessId, repairOrderId: args.orderId, purpose: args.purpose, method: args.method, amount: args.amountCents / 100, createdById: args.actorId, notes: args.note ?? null } })
  if (register) {
    const movement = await tx.cashMovement.create({ data: { businessId: args.businessId, registerId: register.id, userId: args.actorId, type: "IN", amount: args.amountCents / 100, description: `Taller OT-${String(args.orderNumber).padStart(6, "0")} · ${args.purpose === "ADVANCE" ? "anticipo" : args.purpose === "SETTLEMENT" ? "liquidación" : "abono"}`, referenceType: "REPAIR_PAYMENT", referenceId: payment.id } })
    await tx.payment.update({ where: { id: payment.id }, data: { cashMovementId: movement.id } })
  }
  return { payment }
}
export async function createRepair(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const { idempotencyKey, promisedAt, scheduledAt, functionalConditions, advance, ...input } = createSchema.parse(raw)
  return operation(db, { key: idempotencyKey, actorId, businessId, kind: "REPAIR_CREATE", permission: "staff", payload: { ...input, promisedAt, scheduledAt, functionalConditions, advance } }, async tx => {
    const branch = await tx.branch.findFirst({ where: { id: input.intakeBranchId, isActive: true, businessId } })
    if (!branch) throw new BusinessError("Selecciona una sucursal activa.")
    if (input.assignedToId && !await tx.user.findFirst({ where: { id: input.assignedToId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] }, businessId } })) throw new BusinessError("La persona asignada no está habilitada.")
    // FK al directorio de clientes cuando el teléfono capturado empata con una
    // cuenta CUSTOMER del negocio (primero el principal, luego el alterno).
    // Sin match la orden queda con customerId null y la 360 la cubre por teléfono.
    const customerId = await linkCustomerByPhone(tx, businessId, input.customerPhone)
      ?? await linkCustomerByPhone(tx, businessId, input.customerPhoneAlt)
    const order = await tx.repairOrder.create({ data: { ...input, businessId, customerId, customerPhoneAlt: input.customerPhoneAlt || null, functionalConditions: functionalConditions?.join(",") ?? null, currentBranchId: branch.id, createdById: actorId, promisedAt: promisedAt ? new Date(promisedAt) : null, scheduledAt: scheduledAt ? new Date(scheduledAt) : null } })
    await tx.repairEvent.create({ data: { businessId, actorId, orderId: order.id, type: "RECEIVED", detail: `Recepción en ${branch.name}.`, isPublic: true } })
    if (order.quoteCents !== null) await tx.repairEvent.create({ data: { businessId, actorId, orderId: order.id, type: "QUOTE", detail: `Presupuesto estimado en recepción: ${(order.quoteCents / 100).toFixed(2)} MXN.`, isPublic: true } })
    if (advance && advance.amountCents > 0) {
      await registerPayment(tx, { orderId: order.id, orderNumber: order.number, branchId: branch.id, actorId, businessId, amountCents: advance.amountCents, method: advance.method, purpose: "ADVANCE" })
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: order.id, type: "PAYMENT", detail: `Anticipo ${(advance.amountCents / 100).toFixed(2)} MXN (${advance.method}).` } })
    }
    return { order }
  })
}
/** Mueve inventario de la sucursal actual de la orden por una refacción vinculada
 *  al catálogo: OUT al autorizarse/agregarse, RETURN al retirarse estando autorizada.
 *  Respeta el invariante de stock no negativo (CHECK en BranchStock y Product):
 *  si no alcanzan las existencias descuenta lo que hay y el detalle de la orden
 *  documenta el faltante — la pieza pudo montarse antes de catalogarse.
 *  Devuelve el resultado del movimiento, o null si la refacción no está vinculada. */
async function syncPartStock(tx: Prisma.TransactionClient, args: {
  order: { number: number; currentBranchId: string }
  part: { id: string; productId: string | null; description: string; qty: number; unitPriceCents: number }
  actorId: string; businessId: string; type: "OUT" | "RETURN"
}): Promise<{ deducted: number; stock: number } | null> {
  const { order, part, actorId, businessId, type } = args
  if (!part.productId) return null
  const productId = part.productId
  const folio = repairFolio(order.number)
  if (type === "RETURN") {
    // Se repone solo lo que realmente se descontó (los movimientos OUT de esta
    // refacción, identificados por su id en `notes`) menos lo ya repuesto —
    // así un segundo RETURN por la misma refacción no duplica existencias.
    const outs = await tx.inventoryMovement.findMany({ where: { businessId, productId, type: "OUT", notes: { contains: part.id } }, select: { quantity: true, branchId: true } })
    const returned = await tx.inventoryMovement.aggregate({ where: { businessId, productId, type: "RETURN", notes: { contains: part.id } }, _sum: { quantity: true } })
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
  // Invariante Product.stock = Σ BranchStock: ambos descuentan la MISMA
  // cantidad, así que el tope es el mínimo entre la sucursal y el total
  // cacheado (si ya venían desfasados, no se profundiza el desfase).
  const stockRow = await tx.branchStock.findUnique({ where: { productId_branchId: { productId, branchId: order.currentBranchId } } })
  const branchAvailable = Math.max(0, stockRow?.quantity ?? 0)
  const productRow = await tx.product.findUnique({ where: { id: productId, businessId }, select: { stock: true } })
  const productAvailable = Math.max(0, productRow?.stock ?? 0)
  const deduct = Math.min(part.qty, branchAvailable, productAvailable)
  if (deduct <= 0) return { deducted: 0, stock: productAvailable }
  const taken = await tx.branchStock.updateMany({ where: { productId, branchId: order.currentBranchId, quantity: { gte: deduct } }, data: { quantity: { decrement: deduct } } })
  if (taken.count !== 1) return { deducted: 0, stock: productAvailable } // el stock cambió en paralelo; el evento no afirma descuento
  const product = await tx.product.update({ where: { id: productId, businessId }, data: { stock: { decrement: deduct } } })
  await tx.inventoryMovement.create({ data: { businessId, type: "OUT", quantity: deduct, previousStock: product.stock + deduct, newStock: product.stock, productId, branchId: order.currentBranchId, userId: actorId, reason: `Taller ${folio}`, notes: `Refacción OT ${part.id} · ${part.description}`, unitPrice: part.unitPriceCents / 100, totalPrice: (part.unitPriceCents * deduct) / 100, businessVersion: 1 } })
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
}): Promise<string[]> {
  const tail: string[] = []
  const released: string[] = []
  for (const part of args.parts.filter(row => row.status === "APPROVED")) {
    const result = await syncPartStock(tx, { order: args.order, part, actorId: args.actorId, businessId: args.businessId, type: "RETURN" })
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
const actionSchema = z.object({
  idempotencyKey: operationKeySchema, expectedVersion: z.number().int().min(1),
  // PART_ADD se conserva como alias del cliente actual; ambos crean la refacción
  // con flujo de autorización (PART_REQUEST).
  action: z.enum(["NOTE", "QUOTE", "APPROVE", "STATUS", "TRANSFER", "ASSIGN", "PART_REQUEST", "PART_ADD", "PART_DECIDE", "PART_REMOVE", "PAYMENT", "SETTLE_DELIVER", "PLAN", "DIAGNOSTIC_FEE", "REFUND"]),
  detail: z.string().trim().min(1).max(2000).optional(), status: z.enum(Object.keys(repairLabels) as [keyof typeof repairLabels, ...Array<keyof typeof repairLabels>]).optional(),
  quoteCents: moneyCents.optional(), diagnosticFeeCents: moneyCents.optional(), branchId: z.string().min(1).optional(), assignedToId: z.string().min(1).optional(),
  partId: z.string().min(1).optional(), partDescription: z.string().trim().min(1).max(200).optional(),
  approve: z.boolean().optional(),
  partQty: z.number().int().min(1).max(999).default(1),
  partCostCents: moneyCents.default(0), partPriceCents: moneyCents.default(0),
  partProductId: z.string().min(1).optional(),
  noteIsPublic: z.boolean().default(false),
  paymentCents: moneyCents.optional(), paymentMethod: paymentMethod.optional(),
  scheduledAt: z.iso.datetime().nullable().optional(), location: z.string().trim().max(80).nullable().optional(),
})
const detailRequiredActions: readonly string[] = ["NOTE", "QUOTE", "APPROVE", "STATUS", "TRANSFER", "ASSIGN", "SETTLE_DELIVER", "REFUND"]
export async function updateRepair(db: PrismaClient, actorId: string, businessId: string, id: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  if (detailRequiredActions.includes(input.action) && !input.detail) throw new BusinessError("Describe el detalle de la acción.")
  // REFUND es salida de dinero: solo admin (alineado con cash.ts, que exige
  // ADMIN para el OUT manual). El resto de acciones son de mostrador (staff).
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "REPAIR_UPDATE", permission: input.action === "REFUND" ? "admin" : "staff", payload: { id, ...input } }, async tx => {
    const order = await tx.repairOrder.findUnique({ where: { id } })
    if (!order || order.businessId !== businessId) throw new BusinessError("Orden no encontrada.", 404)
    if (order.version !== input.expectedVersion) throw new BusinessError("Otra persona actualizó esta orden. Recarga para ver el cambio antes de continuar.", 409)
    const reopeningToWarranty = order.status === "DELIVERED" && input.action === "STATUS" && input.status === "WARRANTY"
    // REFUND es la única acción permitida en órdenes cerradas: devolver un
    // anticipo no reabre el historial ni altera el estado.
    if ((order.status === "CANCELLED" || (order.status === "DELIVERED" && !reopeningToWarranty)) && input.action !== "REFUND") throw new BusinessError("La orden está cerrada. El historial se conserva.", 409)
    const data: Parameters<typeof tx.repairOrder.update>[0]["data"] = { version: { increment: 1 } }
    let detail = input.detail ?? ""
    let eventType: string = input.action
    let eventPublic = false
    // Dinero retenido por la orden: cobros CONFIRMED menos reembolsos
    // (filas REFUNDED con amount negativo, misma convención que ventas).
    const heldCents = async () => Math.round(((await tx.payment.aggregate({ _sum: { amount: true }, where: { repairOrderId: id, status: { in: ["CONFIRMED", "REFUNDED"] } } }))._sum.amount ?? 0) * 100)
    const orderParts = () => tx.repairPart.findMany({ where: { orderId: id }, select: { id: true, productId: true, description: true, qty: true, unitCostCents: true, unitPriceCents: true, status: true } })
    // Ciclo de refacciones cerrado en estados terminales (incluye los cierres
    // sin reparación, que el bloqueo general de cerradas no alcanza): no se
    // agregan ni se autorizan piezas sobre una orden que ya no se cobra así.
    if (["PART_REQUEST", "PART_ADD", "PART_DECIDE"].includes(input.action) && PART_CLOSED_STATUSES.includes(order.status)) {
      throw new BusinessError("La orden está cerrada; las refacciones ya no se pueden agregar ni resolver.", 409)
    }
    if (input.action === "QUOTE") {
      if (!["DIAGNOSIS", "WAITING_APPROVAL"].includes(order.status) || input.quoteCents === undefined) throw new BusinessError("Registra el diagnóstico e importe antes de solicitar autorización.", 409)
      Object.assign(data, { diagnosis: input.detail, quoteCents: input.quoteCents, approvedQuoteCents: null, quoteApprovedAt: null, status: "WAITING_APPROVAL" })
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
      if (!input.status || !repairNextStages[order.status].includes(input.status)) throw new BusinessError("El cambio de estado no corresponde a la etapa actual.", 409)
      data.status = input.status
      if (input.status === "READY") data.qualityCheck = input.detail
      detail = `${repairLabels[order.status]} → ${repairLabels[input.status]}. ${input.detail}`
      // El cambio de etapa es el progreso que ve el cliente en seguimiento;
      // el texto libre del staff va después del punto y se trunca al publicar.
      eventPublic = true
      if (input.status === "CANCELLED" || input.status === "NOT_REPAIRED") {
        // Cierre sin cobrar refacciones: las APPROVED regresan al stock y
        // todas quedan REJECTED — una cancelada ya no admite PART_REMOVE, así
        // que sin esta reposición el inventario quedaría descontado para
        // siempre. En NOT_AUTHORIZED la liberación ocurre al entregar.
        const tail = await releaseOrderParts(tx, { order, parts: await orderParts(), actorId, businessId, note: input.status === "CANCELLED" ? "La orden se canceló; no se cobra." : "La orden se cerró sin reparación; no se cobra." })
        if (tail.length) detail = `${detail} ${tail.join(" ")}`
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
      if (when === undefined && input.location === undefined) throw new BusinessError("Define la fecha programada o la locación.")
      if (when !== undefined) data.scheduledAt = when
      if (input.location !== undefined) data.location = input.location || null
      const pieces = [when ? `reparación programada para ${when.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}` : "", input.location ? `locación ${input.location}` : ""].filter(Boolean)
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
      await registerPayment(tx, { orderId: id, orderNumber: order.number, branchId: order.currentBranchId, actorId, businessId, amountCents: input.paymentCents, method: input.paymentMethod, purpose: "ABONO", note: input.detail })
      eventType = "PAYMENT"
      detail = `Abono ${(input.paymentCents / 100).toFixed(2)} MXN (${input.paymentMethod}). ${input.detail ?? ""}`.trim()
    } else if (input.action === "REFUND") {
      if (input.paymentCents === undefined || input.paymentCents <= 0) throw new BusinessError("Indica el monto a devolver.")
      if (!input.paymentMethod) throw new BusinessError("Selecciona el método de devolución.")
      // Reembolso de anticipo/excedente (p. ej. al cancelar o al entregar sin
      // reparación): solo es devolvable lo cobrado de más sobre el total —
      // el dinero que aún se debe no es reembolsable. Se registra como pago
      // negativo con status REFUNDED, igual que las devoluciones de ventas.
      const refundableCents = await heldCents() - orderTotalCents(order, await orderParts())
      if (input.paymentCents > refundableCents) throw new BusinessError(`La devolución excede lo cobrado de más (${(Math.max(0, refundableCents) / 100).toFixed(2)} MXN).`, 409)
      const payment = await tx.payment.create({ data: { businessId, repairOrderId: id, purpose: "REFUND", method: input.paymentMethod, amount: -input.paymentCents / 100, status: "REFUNDED", createdById: actorId, notes: input.detail ?? null } })
      if (input.paymentMethod === "CASH") {
        const register = await openRegister(tx, order.currentBranchId, businessId)
        // Igual que las devoluciones de venta: la caja no queda en negativo —
        // si no alcanza el efectivo se rechaza antes de registrar la salida.
        const availableCents = await registerCashCents(tx, register.id)
        if (input.paymentCents > availableCents) throw new BusinessError("El efectivo en caja no alcanza para esta devolución.", 409)
        const movement = await tx.cashMovement.create({ data: { businessId, registerId: register.id, userId: actorId, type: "OUT", amount: input.paymentCents / 100, description: `Taller OT-${String(order.number).padStart(6, "0")} · reembolso`, referenceType: "REPAIR_REFUND", referenceId: payment.id } })
        await tx.payment.update({ where: { id: payment.id }, data: { cashMovementId: movement.id } })
      }
      eventType = "PAYMENT"
      detail = `Reembolso ${(input.paymentCents / 100).toFixed(2)} MXN (${input.paymentMethod}). ${input.detail}`
    } else if (input.action === "SETTLE_DELIVER") {
      // Única vía de entrega: cobra el saldo y cierra las refacciones. Las
      // etapas entregables viven en repairDeliverableStages (STATUS nunca
      // llega a DELIVERED por sí solo).
      if (!repairDeliverableStages.includes(order.status)) throw new BusinessError("La orden aún no está lista para entregarse.", 409)
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
      const tail: string[] = []
      if (withoutRepair) {
        // Las refacciones no se cobran: las APPROVED regresan al stock y
        // quedan REJECTED junto con las REQUESTED. Es idempotente — quien
        // llegó a NOT_REPAIRED por STATUS ya liberó su inventario ahí; esto
        // además cubre órdenes anteriores a esa regla.
        tail.push(...await releaseOrderParts(tx, { order, parts, actorId, businessId, note: "La orden se entregó sin reparación; no se cobra." }))
      }
      if (balanceCents > 0) {
        await registerPayment(tx, { orderId: id, orderNumber: order.number, branchId: order.currentBranchId, actorId, businessId, amountCents: balanceCents, method: input.paymentMethod!, purpose: "SETTLEMENT", note: input.detail })
        detail = `${withoutRepair ? "Cargo de diagnóstico/revisión" : "Liquidado"} ${(balanceCents / 100).toFixed(2)} MXN (${input.paymentMethod}). Entrega a: ${input.detail}`
      } else detail = `Sin saldo pendiente. Entrega a: ${input.detail}`
      // Si el cliente pagó de más (anticipo mayor al cargo final) el excedente
      // queda documentado para registrar el reembolso con la acción REFUND.
      if (overpaidCents > 0) tail.push(`Excedente pendiente de devolver al cliente: ${(overpaidCents / 100).toFixed(2)} MXN.`)
      if (tail.length) detail = `${detail} ${tail.join(" ")}`
      // El cierre sin reparación persiste en closedWithoutRepair: el status
      // pasa a DELIVERED, pero el total de la orden sigue siendo solo el
      // cargo de diagnóstico (workshop-money) y el excedente es devolvible.
      Object.assign(data, { status: "DELIVERED", deliveredTo: input.detail, ...(withoutRepair ? { closedWithoutRepair: true } : {}) })
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
      if (input.partProductId && !await tx.product.findFirst({ where: { id: input.partProductId, businessId } })) throw new BusinessError("El producto seleccionado no existe.")
      const actorUser = await tx.user.findUnique({ where: { id: actorId } })
      const needsApproval = actorUser?.role === "EMPLOYEE"
      const part = await tx.repairPart.create({ data: { businessId, orderId: id, productId: input.partProductId ?? null, description: input.partDescription, qty: input.partQty, unitCostCents: input.partCostCents, unitPriceCents: input.partPriceCents, createdById: actorId, status: needsApproval ? "REQUESTED" : "APPROVED" } })
      eventType = "PART"
      // Las creadas ya APPROVED (administrador) descuentan stock de inmediato;
      // las REQUESTED del técnico lo descuentan recién en PART_DECIDE.
      const addedStock = needsApproval ? null : await syncPartStock(tx, { order, part, actorId, businessId, type: "OUT" })
      detail = needsApproval
        ? `Refacción solicitada: ${part.qty} × ${part.description} — pendiente de autorización`
        : `Refacción agregada: ${part.qty} × ${part.description} — ${(part.unitPriceCents / 100).toFixed(2)} MXN${stockNote(addedStock, part.qty)}`
    } else if (input.action === "PART_DECIDE") {
      const actorUser = await tx.user.findUnique({ where: { id: actorId } })
      if (actorUser?.role !== "ADMIN") throw new BusinessError("Solo el administrador autoriza refacciones.", 403)
      if (input.approve === undefined) throw new BusinessError("Indica si autorizas o rechazas la refacción.")
      const part = input.partId ? await tx.repairPart.findFirst({ where: { id: input.partId, orderId: id } }) : null
      if (!part) throw new BusinessError("La refacción no pertenece a esta orden.", 404)
      const decided = await tx.repairPart.updateMany({
        where: { id: part.id, status: "REQUESTED" },
        data: input.approve
          ? { status: "APPROVED", decidedById: actorId, decidedAt: new Date() }
          : { status: "REJECTED", decidedById: actorId, decidedAt: new Date(), decisionNote: input.detail ?? null },
      })
      if (decided.count !== 1) throw new BusinessError("La refacción ya fue autorizada o rechazada.", 409)
      eventType = "PART"
      const decidedStock = input.approve ? await syncPartStock(tx, { order, part, actorId, businessId, type: "OUT" }) : null
      detail = input.approve
        ? `Refacción autorizada: ${part.qty} × ${part.description} — ${(part.unitPriceCents / 100).toFixed(2)} MXN${stockNote(decidedStock, part.qty)}`
        : `Refacción rechazada: ${part.qty} × ${part.description}${input.detail ? `. ${input.detail}` : ""}`
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
      const removedStock = part.status === "APPROVED" ? await syncPartStock(tx, { order, part, actorId, businessId, type: "RETURN" }) : null
      detail = `Refacción retirada: ${part.description}${stockNote(removedStock, part.qty)}`
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
    if (input.action === "SETTLE_DELIVER") {
      // La entrega queda como evento PAYMENT (privado: lleva montos y el nombre
      // del receptor). Este segundo evento limpio es el que el cliente ve en
      // seguimiento y el que marca "Entregado" en su timeline.
      await tx.repairEvent.create({ data: { businessId, actorId, orderId: id, type: "STATUS", detail: `${repairLabels[order.status]} → ${repairLabels.DELIVERED}. Entrega registrada.`, isPublic: true } })
    }
    return { order: await tx.repairOrder.findUniqueOrThrow({ where: { id } }) }
  })
}
