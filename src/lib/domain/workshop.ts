import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema } from "./operations"
import { repairNextStages, repairLabels } from "../workshop-labels"

const text = z.string().trim().min(1).max(500)
const optionalText = z.string().trim().max(500).optional()
const moneyCents = z.number().int().min(0).max(100000000)
const paymentMethod = z.enum(["CASH", "CARD", "TRANSFER"])
const conditionFlag = z.enum(["ENCENDIDO", "APAGADO", "MOJADO", "MANIPULADO", "ROTO", "INCOMPLETO"])
const createSchema = z.object({
  idempotencyKey: operationKeySchema, customerName: text,
  customerPhone: z.string().trim().min(7).max(30).regex(/^[+\d\s()-]+$/),
  equipmentType: text, brand: optionalText, model: optionalText, serialNumber: optionalText,
  equipmentColor: optionalText,
  deviceAccessType: z.enum(["NONE", "PATTERN", "PIN", "PASSWORD"]).optional(),
  deviceAccessValue: z.string().trim().max(100).optional(),
  accessories: optionalText, intakeCondition: optionalText, reportedIssue: text,
  functionalConditions: z.array(conditionFlag).max(6).optional(),
  aesthetics: z.enum(["BUENO", "REGULAR", "MALO"]).optional(),
  location: z.string().trim().max(80).optional(),
  intakeBranchId: z.string().min(1), assignedToId: z.string().min(1).optional(),
  promisedAt: z.iso.datetime().optional(),
  scheduledAt: z.iso.datetime().optional(),
  // Anticipo cobrado en recepción; con caja abierta genera su asiento de caja.
  advance: z.object({ amountCents: moneyCents, method: paymentMethod }).optional(),
})
async function registerPayment(tx: Prisma.TransactionClient, args: {
  orderId: string; orderNumber: number; branchId: string; actorId: string
  amountCents: number; method: "CASH" | "CARD" | "TRANSFER"; purpose: "ADVANCE" | "ABONO" | "SETTLEMENT"; note?: string
}) {
  const payment = await tx.payment.create({ data: { repairOrderId: args.orderId, purpose: args.purpose, method: args.method, amount: args.amountCents / 100, createdById: args.actorId, notes: args.note ?? null } })
  let cashNote = ""
  if (args.method === "CASH") {
    const register = await tx.cashRegister.findFirst({ where: { status: "OPEN", branchId: args.branchId }, orderBy: { openedAt: "desc" } })
    if (register) {
      const movement = await tx.cashMovement.create({ data: { registerId: register.id, userId: args.actorId, type: "IN", amount: args.amountCents / 100, description: `Taller OT-${String(args.orderNumber).padStart(6, "0")} · ${args.purpose === "ADVANCE" ? "anticipo" : args.purpose === "SETTLEMENT" ? "liquidación" : "abono"}`, referenceType: "REPAIR_PAYMENT", referenceId: payment.id } })
      await tx.payment.update({ where: { id: payment.id }, data: { cashMovementId: movement.id } })
    } else cashNote = " Sin caja abierta en la sucursal: quedó documentado sin asiento de caja."
  }
  return { payment, cashNote }
}
export async function createRepair(db: PrismaClient, actorId: string, raw: unknown) {
  const { idempotencyKey, promisedAt, scheduledAt, functionalConditions, advance, ...input } = createSchema.parse(raw)
  return operation(db, { key: idempotencyKey, actorId, kind: "REPAIR_CREATE", permission: "admin", payload: { ...input, promisedAt, scheduledAt, functionalConditions, advance } }, async tx => {
    const branch = await tx.branch.findFirst({ where: { id: input.intakeBranchId, isActive: true } })
    if (!branch) throw new BusinessError("Selecciona una sucursal activa.")
    if (input.assignedToId && !await tx.user.findFirst({ where: { id: input.assignedToId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } } })) throw new BusinessError("La persona asignada no está habilitada.")
    const order = await tx.repairOrder.create({ data: { ...input, functionalConditions: functionalConditions?.join(",") ?? null, currentBranchId: branch.id, createdById: actorId, promisedAt: promisedAt ? new Date(promisedAt) : null, scheduledAt: scheduledAt ? new Date(scheduledAt) : null } })
    await tx.repairEvent.create({ data: { actorId, orderId: order.id, type: "RECEIVED", detail: `Recepción en ${branch.name}.` } })
    if (advance && advance.amountCents > 0) {
      const { cashNote } = await registerPayment(tx, { orderId: order.id, orderNumber: order.number, branchId: branch.id, actorId, amountCents: advance.amountCents, method: advance.method, purpose: "ADVANCE" })
      await tx.repairEvent.create({ data: { actorId, orderId: order.id, type: "PAYMENT", detail: `Anticipo ${(advance.amountCents / 100).toFixed(2)} MXN (${advance.method}).${cashNote}` } })
    }
    return { order }
  })
}
const actionSchema = z.object({
  idempotencyKey: operationKeySchema, expectedVersion: z.number().int().min(1),
  action: z.enum(["NOTE", "QUOTE", "APPROVE", "STATUS", "TRANSFER", "ASSIGN", "PART_ADD", "PART_REMOVE", "PAYMENT", "SETTLE_DELIVER", "PLAN"]),
  detail: z.string().trim().min(1).max(2000).optional(), status: z.enum(Object.keys(repairLabels) as [keyof typeof repairLabels, ...Array<keyof typeof repairLabels>]).optional(),
  quoteCents: moneyCents.optional(), branchId: z.string().min(1).optional(), assignedToId: z.string().min(1).optional(),
  partId: z.string().min(1).optional(), partDescription: z.string().trim().min(1).max(200).optional(),
  partQty: z.number().int().min(1).max(999).default(1),
  partCostCents: moneyCents.default(0), partPriceCents: moneyCents.default(0),
  partProductId: z.string().min(1).optional(),
  noteIsPublic: z.boolean().default(false),
  paymentCents: moneyCents.optional(), paymentMethod: paymentMethod.optional(),
  scheduledAt: z.iso.datetime().nullable().optional(), location: z.string().trim().max(80).nullable().optional(),
})
const detailRequiredActions: readonly string[] = ["NOTE", "QUOTE", "APPROVE", "STATUS", "TRANSFER", "ASSIGN", "SETTLE_DELIVER"]
export async function updateRepair(db: PrismaClient, actorId: string, id: string, raw: unknown) {
  const input = actionSchema.parse(raw)
  if (detailRequiredActions.includes(input.action) && !input.detail) throw new BusinessError("Describe el detalle de la acción.")
  return operation(db, { key: input.idempotencyKey, actorId, kind: "REPAIR_UPDATE", permission: "admin", payload: { id, ...input } }, async tx => {
    const order = await tx.repairOrder.findUnique({ where: { id } })
    if (!order) throw new BusinessError("Orden no encontrada.", 404)
    if (order.version !== input.expectedVersion) throw new BusinessError("Otra persona actualizó esta orden. Recarga para ver el cambio antes de continuar.", 409)
    const reopeningToWarranty = order.status === "DELIVERED" && input.action === "STATUS" && input.status === "WARRANTY"
    if (order.status === "CANCELLED" || (order.status === "DELIVERED" && !reopeningToWarranty)) throw new BusinessError("La orden está cerrada. El historial se conserva.", 409)
    const data: Parameters<typeof tx.repairOrder.update>[0]["data"] = { version: { increment: 1 } }
    let detail = input.detail ?? ""
    let eventType: string = input.action
    let eventPublic = false
    if (input.action === "QUOTE") {
      if (!["DIAGNOSIS", "WAITING_APPROVAL"].includes(order.status) || input.quoteCents === undefined) throw new BusinessError("Registra el diagnóstico e importe antes de solicitar autorización.", 409)
      Object.assign(data, { diagnosis: input.detail, quoteCents: input.quoteCents, approvedQuoteCents: null, quoteApprovedAt: null, status: "WAITING_APPROVAL" })
      detail = `Presupuesto ${(input.quoteCents / 100).toFixed(2)} MXN. ${input.detail}`
    } else if (input.action === "APPROVE") {
      if (order.status !== "WAITING_APPROVAL" || order.quoteCents === null) throw new BusinessError("No hay presupuesto pendiente de autorizar.", 409)
      Object.assign(data, { approvedQuoteCents: order.quoteCents, quoteApprovedAt: new Date(), status: "IN_REPAIR" })
      detail = `Autorización registrada por el operador para ${(order.quoteCents / 100).toFixed(2)} MXN. ${input.detail}`
    } else if (input.action === "STATUS") {
      if (!input.status || !repairNextStages[order.status].includes(input.status)) throw new BusinessError("El cambio de estado no corresponde a la etapa actual.", 409)
      data.status = input.status
      if (input.status === "READY") data.qualityCheck = input.detail
      if (input.status === "DELIVERED") data.deliveredTo = input.detail
      detail = `${repairLabels[order.status]} → ${repairLabels[input.status]}. ${input.detail}`
    } else if (input.action === "ASSIGN") {
      const assignee = input.assignedToId ? await tx.user.findFirst({ where: { id: input.assignedToId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } } }) : null
      if (!assignee) throw new BusinessError("Selecciona una persona habilitada.")
      data.assignedToId = assignee.id
      detail = `Responsable: ${assignee.name}. ${input.detail}`
    } else if (input.action === "TRANSFER") {
      const branch = input.branchId ? await tx.branch.findFirst({ where: { id: input.branchId, isActive: true } }) : null
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
      const { cashNote } = await registerPayment(tx, { orderId: id, orderNumber: order.number, branchId: order.currentBranchId, actorId, amountCents: input.paymentCents, method: input.paymentMethod, purpose: "ABONO", note: input.detail })
      eventType = "PAYMENT"
      detail = `Abono ${(input.paymentCents / 100).toFixed(2)} MXN (${input.paymentMethod}).${cashNote} ${input.detail ?? ""}`.trim()
    } else if (input.action === "SETTLE_DELIVER") {
      if (!repairNextStages[order.status].includes("DELIVERED")) throw new BusinessError("La orden aún no está lista para entregarse.", 409)
      const paid = (await tx.payment.aggregate({ _sum: { amount: true }, where: { repairOrderId: id, status: "CONFIRMED" } }))._sum.amount ?? 0
      const quoted = order.approvedQuoteCents ?? order.quoteCents ?? 0
      const balanceCents = Math.max(0, quoted - Math.round(paid * 100))
      if (balanceCents > 0 && !input.paymentMethod) throw new BusinessError(`Restan ${(balanceCents / 100).toFixed(2)} MXN por cobrar. Selecciona el método.`, 409)
      if (balanceCents > 0) {
        const { cashNote } = await registerPayment(tx, { orderId: id, orderNumber: order.number, branchId: order.currentBranchId, actorId, amountCents: balanceCents, method: input.paymentMethod!, purpose: "SETTLEMENT", note: input.detail })
        detail = `Liquidado ${(balanceCents / 100).toFixed(2)} MXN (${input.paymentMethod}).${cashNote} Entrega a: ${input.detail}`
      } else detail = `Sin saldo pendiente. Entrega a: ${input.detail}`
      Object.assign(data, { status: "DELIVERED", deliveredTo: input.detail })
      eventType = "PAYMENT"
    } else if (input.action === "PART_ADD") {
      if (!input.partDescription) throw new BusinessError("Describe la refacción.")
      if (input.partProductId && !await tx.product.findUnique({ where: { id: input.partProductId } })) throw new BusinessError("El producto seleccionado no existe.")
      const part = await tx.repairPart.create({ data: { orderId: id, productId: input.partProductId ?? null, description: input.partDescription, qty: input.partQty, unitCostCents: input.partCostCents, unitPriceCents: input.partPriceCents, createdById: actorId } })
      eventType = "PART"
      detail = `Refacción agregada: ${part.qty} × ${part.description} — ${(part.unitPriceCents / 100).toFixed(2)} MXN`
    } else if (input.action === "PART_REMOVE") {
      const part = input.partId ? await tx.repairPart.findFirst({ where: { id: input.partId, orderId: id } }) : null
      if (!part) throw new BusinessError("La refacción no pertenece a esta orden.", 404)
      await tx.repairPart.delete({ where: { id: part.id } })
      eventType = "PART"
      detail = `Refacción retirada: ${part.description}`
    } else if (input.action === "NOTE") {
      eventPublic = input.noteIsPublic
    }
    const result = await tx.repairOrder.updateMany({ where: { id, version: input.expectedVersion }, data })
    if (result.count !== 1) throw new BusinessError("La orden cambió durante la operación.", 409)
    await tx.repairEvent.create({ data: { actorId, orderId: id, type: eventType, detail, isPublic: eventPublic } })
    return { order: await tx.repairOrder.findUniqueOrThrow({ where: { id } }) }
  })
}
