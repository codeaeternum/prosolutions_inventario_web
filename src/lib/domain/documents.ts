import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { actor, amount, BusinessError, cents, itemsSchema, mergeItems, operation, operationKeySchema, releaseStock, resolveBranch, takeStock } from "./operations"
import { checkSalePayments, commitSale, METHOD_MAP, METHODS, paymentInput, refund, settlePayments, settleSalePayments, type MethodInput, type SettledPayment } from "./sales"
import { collectLowStockIds, syncLowStockAlerts } from "../low-stock"

// Documentos vivos del mostrador sobre el mismo modelo Sale:
//   RETAIL/WORKSHOP en DRAFT  → venta suspendida (sin stock ni dinero)
//   QUOTE en DRAFT            → cotización con vigencia
//   LAYAWAY en OPEN           → apartado: stock comprometido, anticipo y saldo
// El kind de BusinessOperation ("SALE_DOCUMENT*" ) distingue estos folios de
// la venta directa ("SALE") en la auditoría de reintentos.

const parkSchema = z.object({
  idempotencyKey: operationKeySchema,
  items: itemsSchema,
  kind: z.enum(["RETAIL", "WORKSHOP", "LAYAWAY", "QUOTE"]),
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  note: z.string().trim().max(500).optional(),
  expiresAt: z.iso.datetime().optional(),
  payments: z.array(paymentInput).min(1).max(6).optional(),
})

const checkoutSchema = z.object({
  saleId: z.string().min(1),
  idempotencyKey: operationKeySchema,
  payments: z.array(paymentInput).min(1).max(6).optional(),
  paymentMethod: METHODS.optional(),
  // Descuento autorizado al cobrar, en centavos sobre el total de catálogo.
  // El motivo es obligatorio cuando el descuento es > 0 (rastro forense).
  discountCents: z.number().int().min(0).max(100000000).optional(),
  discountReason: z.string().trim().min(3).max(200).optional(),
}).refine(v => Boolean(v.payments) !== Boolean(v.paymentMethod), "Envía payments o paymentMethod.")
  .refine(v => !v.discountCents || Boolean(v.discountReason), "Captura el motivo del descuento.")

// El abono de apartado nunca es CREDITO: fiar sobre un apartado sería deuda
// sin entrega de mercancía ni saldo cobrado.
const abonoInput = z.object({
  method: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA"]),
  amount: z.number().positive().max(1000000).optional(), // omitido en pago único = liquidar el saldo
  reference: z.string().trim().max(200).optional(),
})
const paySchema = z.object({
  saleId: z.string().min(1),
  idempotencyKey: operationKeySchema,
  payments: z.array(abonoInput).min(1).max(6),
})

const cancelSchema = z.object({
  saleId: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: operationKeySchema,
})

const listSchema = z.object({
  status: z.enum(["DRAFT", "OPEN", "COMPLETED", "VOIDED"]).optional(),
  kind: z.enum(["RETAIL", "WORKSHOP", "LAYAWAY", "QUOTE"]).optional(),
  customerId: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

/** Crea un documento vivo del mostrador: suspensión (DRAFT), cotización (DRAFT con vigencia) o apartado (OPEN con stock y anticipo). */
export async function parkDocument(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = parkSchema.parse(raw)
  const items = mergeItems(input.items)
  // Reglas por tipo: el apartado es de un cliente concreto, la cotización
  // necesita vigencia y el anticipo solo existe en el apartado.
  if (input.kind === "LAYAWAY" && !input.customerId) throw new BusinessError("Un apartado necesita el cliente que lo aparta.")
  if (input.kind === "QUOTE" && !input.expiresAt) throw new BusinessError("La cotización necesita su fecha de vigencia.")
  if (input.payments?.length && input.kind !== "LAYAWAY") throw new BusinessError("Solo el apartado registra anticipo; suspensión y cotización cobran al confirmarse.")
  const payments = input.payments ?? []
  if (payments.some(p => p.method === "CREDITO")) throw new BusinessError("El anticipo de un apartado no puede ser a crédito.")
  checkSalePayments(payments, input.customerId)
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new BusinessError("La vigencia debe ser una fecha futura.")
  if (input.kind === "QUOTE" && expiresAt!.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) throw new BusinessError("La vigencia de una cotización no puede pasar de 90 días.")
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE_DOCUMENT", permission: "staff", payload: { ...input, items } }, async tx => {
    const seller = await actor(tx, actorId, "staff", businessId)
    const branch = await resolveBranch(tx, input.branchId ?? seller.homeBranchId, businessId)
    const customer = input.customerId ? await actor(tx, input.customerId, "customer", businessId) : null

    // Precio prometido: snapshot del servidor al momento de crear el
    // documento (mayoreo para talleres y clientes STORE/TECHNICIAN). El
    // cliente nunca dicta el precio — checkout cobra exactamente esto.
    const wholesale = input.kind === "WORKSHOP" || customer?.customerType === "STORE" || customer?.customerType === "TECHNICIAN"
    const lines = []
    let totalCents = 0
    for (const item of items) {
      // El apartado compromete stock al nacer; los DRAFT solo verifican que
      // la pieza existe y está activa para fotografiar su precio.
      const product = input.kind === "LAYAWAY"
        ? (await takeStock(tx, { productId: item.productId, quantity: item.quantity, branchId: branch.id, businessId })).product
        : await tx.product.findFirst({ where: { id: item.productId, businessId } })
      if (!product || !product.isActive) throw new BusinessError("El producto ya no está disponible.", 409)
      const unitCents = cents(wholesale ? product.wholesalePrice : product.retailPrice)
      const lineCents = unitCents * item.quantity
      cents(amount(lineCents))
      lines.push({ item, product, unitCents, lineCents })
      totalCents += lineCents
    }
    const total = amount(totalCents)

    // Un anticipo único sin monto se interpreta como el total y siempre se
    // rechaza: si lo liquida completo es una venta, no un apartado.
    const settled: SettledPayment[] = payments.map(p => ({
      method: p.method, reference: p.reference,
      cents: payments.length === 1 && p.amount === undefined ? totalCents : cents(p.amount!, true),
    }))
    const anticipoCents = settled.reduce((sum, p) => sum + p.cents, 0)
    if (anticipoCents >= totalCents) throw new BusinessError("Un apartado debe quedar con saldo; si lo liquida completo cobra como venta.", 409)

    const sale = await tx.sale.create({ data: {
      businessId, total, kind: input.kind, branchId: branch.id, sellerId: actorId,
      customerId: customer?.id ?? null, expiresAt, note: input.note ?? null,
      status: input.kind === "LAYAWAY" ? "OPEN" : "DRAFT",
    } })

    const quantity = items.reduce((sum, item) => sum + item.quantity, 0)
    if (input.kind !== "LAYAWAY") {
      // Suspensión/cotización: renglones snapshot y nada más — el stock y el
      // dinero se mueven recién al confirmar el documento (checkoutDocument).
      const saleItems = []
      for (const line of lines) {
        saleItems.push(await tx.saleItem.create({ data: {
          businessId, saleId: sale.id, productId: line.product.id, quantity: line.item.quantity,
          unitPrice: amount(line.unitCents), totalPrice: amount(line.lineCents),
        } }))
      }
      return { sale, items: saleItems, payments: [], movements: [], quantity, total, kind: sale.kind, paid: 0, balance: total }
    }

    const committed = await commitSale(tx, {
      sale, businessId, actorId, branchId: branch.id, customerId: customer?.id ?? null,
      lines: lines.map(line => ({ productId: line.product.id, quantity: line.item.quantity, unitCents: line.unitCents, lineCents: line.lineCents })),
      payments: settled, reason: `Apartado V-${sale.number}`,
    })
    return { sale, items: committed.items, payments: committed.payments, movements: committed.movements, quantity, total, kind: sale.kind, paid: amount(anticipoCents), balance: amount(totalCents - anticipoCents) }
  })
  // Solo el apartado movió stock; suspensión y cotización no tocan inventario.
  if (result.sale.kind === "LAYAWAY") await syncLowStockAlerts(db, businessId, collectLowStockIds(items))
  return result
}

/** Convierte un DRAFT (suspensión o cotización) en venta COMPLETED cobrando con los precios snapshot. */
export async function checkoutDocument(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = checkoutSchema.parse(raw)
  const payments = input.payments ?? [{ method: input.paymentMethod! }]
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE_DOCUMENT_CHECKOUT", permission: "staff", payload: input }, async tx => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId } })
    if (!sale || sale.businessId !== businessId) throw new BusinessError("Documento no encontrado.", 404)
    if (sale.status !== "DRAFT") throw new BusinessError("El documento ya no está pendiente de cobro.", 409)
    // Por construcción un apartado nunca es DRAFT; la guardia evita que un
    // dato inconsistente se cobre por la caja de venta en vez de por abonos.
    if (sale.kind === "LAYAWAY") throw new BusinessError("Los apartados se liquidan por abonos, no por este cobro.", 409)
    if (sale.kind === "QUOTE" && sale.expiresAt && sale.expiresAt.getTime() < Date.now()) throw new BusinessError("La cotización venció.", 410)
    // El cliente del documento (si lo tiene) es quien autoriza el CREDITO.
    checkSalePayments(payments, sale.customerId)
    const totalCents = cents(sale.total)
    // Descuento autorizado al cobrar: sale.total conserva el precio de
    // catálogo y los pagos cuadran contra total − descuento. El cobro nunca
    // queda en $0 — eso sería cortesía/cancelación, otro flujo.
    const discountCents = input.discountCents ?? 0
    if (discountCents >= totalCents) throw new BusinessError("El descuento no puede cubrir el total del cobro.", 409)
    if (discountCents > 0) {
      // Regla por rol: el EMPLOYEE descuenta hasta 10% del total; un monto
      // mayor necesita al ADMIN (sin tope). Otros roles no llegan — el
      // permission "staff" de la operación ya los filtró.
      const me = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } })
      if (me?.role === "EMPLOYEE" && discountCents * 10 > totalCents) {
        throw new BusinessError("Los empleados pueden descontar hasta 10%; pide autorización al administrador.", 403)
      }
    }
    const discountReason = discountCents > 0 ? input.discountReason ?? null : null
    const payableCents = totalCents - discountCents
    const settled = settleSalePayments(payments, payableCents)
    const saleItems = await tx.saleItem.findMany({ where: { saleId: sale.id } })
    // El precio prometido es el snapshot del renglón; aquí solo se compromete
    // el stock que el DRAFT nunca apartó.
    for (const item of saleItems) {
      await takeStock(tx, { productId: item.productId, quantity: item.quantity, branchId: sale.branchId, businessId })
    }
    const committed = await commitSale(tx, {
      sale, businessId, actorId, branchId: sale.branchId, customerId: sale.customerId,
      lines: saleItems.map(item => ({ saleItemId: item.id, productId: item.productId, quantity: item.quantity, unitCents: cents(item.unitPrice), lineCents: cents(item.totalPrice) })),
      payments: settled, reason: `Venta V-${sale.number}`,
    })
    // Guardia de concurrencia: solo un checkout puede sellar el DRAFT — el
    // descuento autorizado queda persistido en el mismo flip atómico.
    const changed = await tx.sale.updateMany({ where: { id: sale.id, status: "DRAFT" }, data: { status: "COMPLETED", discountCents, discountReason } })
    if (changed.count !== 1) throw new BusinessError("El documento cambió durante la operación; reintenta.", 409)
    return {
      sale: { ...sale, status: "COMPLETED" as const, discountCents, discountReason },
      items: committed.items, payments: committed.payments, movements: committed.movements,
      quantity: saleItems.reduce((sum, item) => sum + item.quantity, 0), total: sale.total, kind: sale.kind,
      // Folio y desglose del descuento en el recibo: la bitácora y la alerta
      // de operación sensible (operation-alerts) los leen de aquí.
      number: sale.number, discountCents, discountReason, payableCents,
    }
  })
  await syncLowStockAlerts(db, businessId, collectLowStockIds(result.items))
  return result
}

/** Registra un abono sobre un apartado OPEN; al cubrir el saldo el documento se liquida a COMPLETED. */
export async function payDocument(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = paySchema.parse(raw)
  if (input.payments.length > 1 && input.payments.some(p => p.amount === undefined)) throw new BusinessError("En un pago dividido cada medio debe traer su monto.")
  if (input.payments.some(p => p.method === "TRANSFERENCIA" && !p.reference)) throw new BusinessError("Captura la referencia de cada transferencia.")
  return operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE_DOCUMENT_PAYMENT", permission: "staff", payload: input }, async tx => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId } })
    if (!sale || sale.businessId !== businessId) throw new BusinessError("Documento no encontrado.", 404)
    if (sale.kind !== "LAYAWAY" || sale.status !== "OPEN") throw new BusinessError("Solo los apartados vivos admiten abonos.", 409)
    const confirmed = await tx.payment.findMany({ where: { saleId: sale.id, status: "CONFIRMED" } })
    const totalCents = cents(sale.total)
    const paidCents = confirmed.reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
    const balanceCents = totalCents - paidCents
    // Un abono único sin monto liquida el saldo restante ("cobra lo que falta").
    const settled: SettledPayment[] = input.payments.map(p => ({
      method: p.method, reference: p.reference,
      cents: input.payments.length === 1 && p.amount === undefined ? balanceCents : cents(p.amount!, true),
    }))
    const incomingCents = settled.reduce((sum, p) => sum + p.cents, 0)
    if (incomingCents <= 0) throw new BusinessError("El abono debe ser mayor a cero.", 409)
    if (incomingCents > balanceCents) throw new BusinessError(`El abono supera el saldo del apartado (${amount(balanceCents)}).`, 409)
    const created = await settlePayments(tx, {
      sale, businessId, actorId, branchId: sale.branchId, customerId: sale.customerId,
      payments: settled, description: `Abono apartado V-${sale.number}`,
    })
    const completed = incomingCents === balanceCents
    if (completed) {
      // Guardia de concurrencia: solo un abono sella la liquidación.
      const changed = await tx.sale.updateMany({ where: { id: sale.id, status: "OPEN" }, data: { status: "COMPLETED" } })
      if (changed.count !== 1) throw new BusinessError("El documento cambió durante la operación; reintenta.", 409)
    }
    return { sale: { ...sale, status: completed ? "COMPLETED" as const : "OPEN" as const }, payments: created, paid: amount(paidCents + incomingCents), balance: amount(balanceCents - incomingCents), completed }
  })
}

/** Anula un documento vivo: DRAFT solo se sella; apartado OPEN repone stock y reembolsa lo cobrado. */
export async function cancelDocument(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = cancelSchema.parse(raw)
  const touchedProductIds = new Set<string>()
  const result = await operation(db, { key: input.idempotencyKey, actorId, businessId, kind: "SALE_DOCUMENT_CANCEL", permission: "staff", payload: input }, async tx => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true, payments: true } })
    if (!sale || sale.businessId !== businessId) throw new BusinessError("Documento no encontrado.", 404)
    if (sale.status === "DRAFT") {
      // El DRAFT nunca movió stock ni dinero: anularlo es solo sellarlo.
      const changed = await tx.sale.updateMany({ where: { id: sale.id, status: "DRAFT" }, data: { status: "VOIDED" } })
      if (changed.count !== 1) throw new BusinessError("El documento cambió durante la operación; reintenta.", 409)
      return { saleId: sale.id, number: sale.number, kind: sale.kind }
    }
    if (sale.status === "VOIDED") throw new BusinessError("El documento ya está anulado.", 409)
    if (sale.status === "COMPLETED") throw new BusinessError("El documento ya está cobrado; usa la anulación de venta.", 409)
    if (sale.kind !== "LAYAWAY") throw new BusinessError("Este documento no admite cancelación.", 409)
    // Apartado vivo: regresa la mercancía comprometida a su sucursal.
    for (const item of sale.items) {
      const pending = item.quantity - item.returnedQuantity
      if (pending <= 0) continue
      await releaseStock(tx, { productId: item.productId, quantity: pending, branchId: sale.branchId, businessId })
      touchedProductIds.add(item.productId)
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } })
      await tx.inventoryMovement.create({ data: {
        businessId, productId: item.productId, userId: actorId, type: "IN", quantity: pending,
        previousStock: product.stock - pending, newStock: product.stock,
        reason: `Cancelación apartado V-${sale.number}: ${input.reason}`, businessVersion: 1, branchId: sale.branchId, saleId: sale.id,
      } })
    }
    // Reembolsa por cada medio solo su NETO (anticipo/abonos − ya devuelto),
    // igual que la anulación de una venta cobrada.
    const paidMethods = [...new Set(sale.payments.filter(p => p.status === "CONFIRMED" && p.amount > 0).map(p => p.method))]
    for (const method of paidMethods) {
      const channel = (Object.keys(METHOD_MAP) as MethodInput[]).find(k => METHOD_MAP[k] === method)!
      const netCents = sale.payments.filter(p => p.method === method).reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
      if (netCents > 0) await refund(tx, { saleId: sale.id, actorId, businessId, branchId: sale.branchId, customerId: sale.customerId, refundCents: netCents, channel, note: `Cancelación apartado V-${sale.number}: ${input.reason}` })
      await tx.payment.updateMany({ where: { saleId: sale.id, method, status: "CONFIRMED" }, data: { status: "VOIDED" } })
    }
    const changed = await tx.sale.updateMany({ where: { id: sale.id, status: "OPEN" }, data: { status: "VOIDED" } })
    if (changed.count !== 1) throw new BusinessError("El documento cambió durante la operación; reintenta.", 409)
    return { saleId: sale.id, number: sale.number, kind: sale.kind }
  })
  await syncLowStockAlerts(db, businessId, [...touchedProductIds])
  return result
}

/** Bandeja de documentos del mostrador: lectura directa con saldo computado, sin recibo de operación. */
export async function listDocuments(db: PrismaClient, businessId: string, raw: unknown = {}) {
  const filters = listSchema.parse(raw ?? {})
  const rows = await db.sale.findMany({
    where: {
      businessId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
    },
    include: {
      items: { select: { id: true, quantity: true, product: { select: { name: true, barcode: true } } } },
      customer: { select: { id: true, name: true, phone: true } },
      payments: { where: { status: "CONFIRMED" }, select: { method: true, amount: true } },
      seller: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 50,
  })
  return rows.map(sale => {
    const paid = sale.payments.reduce((sum, p) => sum + p.amount, 0)
    return { ...sale, itemCount: sale.items.reduce((sum, item) => sum + item.quantity, 0), paid, balance: sale.total - paid }
  })
}
