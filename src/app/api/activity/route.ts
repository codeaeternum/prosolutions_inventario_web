import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { getBusinessSettingsMap } from "@/lib/settings"
import { formatFolio, parseFolioDigits, repairLabels } from "@/lib/workshop-labels"

/**
 * GET /api/activity — bitácora unificada "quién hizo qué" (solo ADMIN).
 *
 * Tres fuentes consultadas por separado y unidas en memoria por
 * (createdAt, id) descendente:
 *  - operation: recibos idempotentes de BusinessOperation (ventas, caja,
 *    compras, conteos, encargos, taller…). El JSON `response` guarda folios y
 *    totales del resultado; aquí se convierte en un resumen corto.
 *  - repair: RepairEvent de las órdenes de taller (estado, notas, cobros,
 *    refacciones). `detail` ya es texto humano y viaja tal cual.
 *  - audit: AuditEvent (altas/ediciones de catálogo, usuarios, ajustes) con
 *    `changes` antes/después. El modelo lo crea otro módulo en paralelo
 *    (prisma/schema.prisma + src/lib/audit.ts): mientras no exista en el
 *    cliente generado se accede con un cast laxo y la fuente se omite sin
 *    romper el feed; al regenerar (`npx prisma generate`) entra solo.
 *
 * Paginación: cursor compuesto `${createdAtISO}~${id}`. Cada fuente filtra
 * (createdAt, id) < cursor con el MISMO orden del merge y trae hasta `take`
 * filas; el merge ordena, aplica `q` sobre el texto ya construido y corta a
 * `take`. `nextCursor` solo se devuelve si la página quedó llena (si faltan
 * fuentes por agotar, la siguiente página lo resuelve). Con `q` activo se
 * leen hasta 200 filas por fuente (el texto se filtra post-mapeo porque en
 * operations vive dentro del JSON `response`, no en columnas).
 */

export type ActivityItem = {
  id: string
  source: "audit" | "operation" | "repair"
  actorId: string
  actorName: string
  actorRole: string
  /** kind o action cruda (iconos/filtros en el cliente). */
  action: string
  /** Etiqueta corta en español: "Venta", "Cambio de precio", "Estado de orden". */
  label: string
  /** "V-7 · $500.00" / "Pantalla iPhone 11: $500 → $450". */
  summary: string
  /** Solo audit: diff antes/después capturado por el módulo de auditoría. */
  changes?: { field: string; before: unknown; after: unknown }[]
  /** Folio o nombre visible de la entidad (V-7, OT-000123, "Pantalla iPhone 11"). */
  entityLabel?: string
  /** ISO 8601. */
  createdAt: string
}

// ---------------------------------------------------------------------------
// Etiquetas en español
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<string, string> = {
  SALE: "Venta",
  RETAIL: "Venta mostrador",
  SALE_DOCUMENT: "Documento mostrador",
  SALE_DOCUMENT_CHECKOUT: "Cobro mostrador",
  SALE_DOCUMENT_PAYMENT: "Abono a apartado",
  SALE_DOCUMENT_CANCEL: "Cancelación de documento",
  SALE_RETURN: "Devolución",
  SALE_VOID: "Anulación de venta",
  RESERVATION_CREATE: "Reserva",
  REPAIR_CREATE: "Orden de taller",
  REPAIR_UPDATE: "Orden de taller (edición)",
  PURCHASE_CREATE: "Orden de compra",
  PURCHASE_FROM_NEEDS: "Orden de compra desde encargos",
  PURCHASE_STATUS: "Orden de compra (estado)",
  SUPPLIER_PAYMENT: "Pago a proveedor",
  COUNT_CREATE: "Conteo físico",
  COUNT_ITEMS: "Conteo (captura)",
  COUNT_APPLY: "Conteo aplicado",
  COUNT_CANCEL: "Conteo cancelado",
  SHOPPING_ITEM_ADD: "Encargo",
  SHOPPING_ITEM_RESOLVE: "Encargo (resolución)",
  INVENTORY: "Movimiento de inventario",
  DEBT: "Cargo a crédito",
  CREDIT_DEBT: "Cargo a crédito",
  CREDIT_PAYMENT: "Abono de crédito",
  CONVENIO_SETTLE: "Convenio B2B",
  CASH_OPEN: "Apertura de caja",
  CASH_CLOSE: "Corte de caja",
  CASH_IN: "Entrada de efectivo",
  CASH_OUT: "Salida de efectivo",
  CASH_REQUEST: "Solicitud de gasto",
  CASH_REQUEST_DECIDE: "Decisión de gasto",
  PRODUCT_CREATE: "Alta de producto",
  BRANCH_CREATE: "Alta de sucursal",
  DEVICE_MODEL_UPSERT: "Modelo de dispositivo",
  WORKSHOP_SERVICE_CREATE: "Servicio de taller",
  WORKSHOP_SERVICE_SEED_SUGGESTED: "Servicios sugeridos",
  WORKSHOP_CONFIG_UPDATE: "Configuración de taller",
}

const KIND_PREFIX_LABELS: [string, string][] = [
  ["CASH_", "Movimiento de caja"],
  ["SALE_", "Venta"],
  ["PURCHASE_", "Orden de compra"],
  ["COUNT_", "Conteo"],
  ["SHOPPING_", "Encargo"],
  ["REPAIR_", "Taller"],
  ["RESERVATION_", "Reserva"],
  ["CREDIT_", "Crédito"],
]

function kindLabel(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind]
  for (const [prefix, label] of KIND_PREFIX_LABELS) {
    if (kind.startsWith(prefix)) return label
  }
  return kind
}

const REPAIR_EVENT_LABELS: Record<string, string> = {
  STATUS: "Estado de orden",
  NOTE: "Nota",
  PAYMENT: "Cobro de taller",
  PART: "Refacción",
  QUOTE: "Cotización",
  RECEIVED: "Recepción",
  PHOTO: "Foto",
  CONVENIO_SETTLE: "Convenio",
  APPROVE: "Autorización",
  ASSIGN: "Asignación",
  TRANSFER: "Traspaso de orden",
  PLAN: "Agenda",
  DIAGNOSTIC_FEE: "Cargo de diagnóstico",
  REFUND: "Reembolso",
  SETTLE_DELIVER: "Entrega",
  ROTATE_UPLOAD_TOKEN: "Seguridad",
}

const AUDIT_LABELS: Record<string, string> = {
  PRODUCT_CREATE: "Alta de producto",
  PRODUCT_UPDATE: "Edición de producto",
  USER_CREATE: "Alta de usuario",
  USER_UPDATE: "Edición de usuario",
  SETTINGS_UPDATE: "Configuración",
  CUSTOMER_UPDATE: "Cliente",
  BUSINESS_LOGO: "Logo",
}

const AUDIT_PREFIX_LABELS: [string, string][] = [
  ["SUPPLIER_", "Proveedor"],
  ["CATEGORY_", "Catálogo"],
  ["BRAND_", "Catálogo"],
  ["MODEL_", "Catálogo"],
  ["BRANCH_", "Sucursal"],
  ["PRODUCT_", "Producto"],
  ["USER_", "Usuario"],
  ["CUSTOMER_", "Cliente"],
  ["SETTINGS_", "Configuración"],
  ["BUSINESS_", "Configuración"],
]

/** Estados frecuentes en `response.status` (ventas, compras, conteos, encargos). */
const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completada",
  OPEN: "Abierta",
  CANCELLED: "Cancelada",
  VOIDED: "Anulada",
  DRAFT: "Borrador",
  ORDERED: "Pedida",
  RECEIVED: "Recibida",
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  APPLIED: "Aplicado",
  PURCHASED: "Comprado",
  CONFIRMED: "Confirmado",
}

// ---------------------------------------------------------------------------
// Lectura defensiva del JSON `response` de BusinessOperation
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>
const asRec = (v: unknown): Rec | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null)
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

/** Montos con 2 decimales y separador de miles: $1,234.56 */
const money = (v: number): string =>
  `$${v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const centsToMoney = (v: unknown): string | null => {
  const n = asNum(v)
  return n == null ? null : money(n / 100)
}
const pesosToMoney = (v: unknown): string | null => {
  const n = asNum(v)
  return n == null ? null : money(n)
}

function statusLabel(status: unknown): string | null {
  const s = asStr(status)
  if (!s) return null
  return STATUS_LABELS[s] ?? repairLabels[s as keyof typeof repairLabels] ?? s
}

/**
 * Convierte el `response` de una BusinessOperation en una línea corta.
 * Campos comunes: folio (ya formateado "OC-000123"/"CC-000001"), number →
 * folio por convención (ventas V-n, órdenes OT-*, conteos CC-*, compras OC-*),
 * total/totalCents → $ y status → "→ Estado". Fallback: `#<id8>`.
 */
function summarizeOperation(
  kind: string,
  raw: unknown,
  opId: string,
  folioFmt: { prefix: string; digits: number },
): { summary: string; entityLabel?: string } {
  const r = asRec(raw) ?? {}
  const sale = asRec(r.sale)
  const order = asRec(r.order)
  const purchase = asRec(r.purchase)
  const count = asRec(r.count)
  const payment = asRec(r.payment)
  const request = asRec(r.request)
  const item = asRec(r.item)
  const product = asRec(r.product)
  const branch = asRec(r.branch)
  const model = asRec(r.model)
  const service = asRec(r.service)

  const saleN = asNum(sale?.number)
  const topN = asNum(r.number)
  const orderN = asNum(order?.number)
  const countN = asNum(count?.number)
  const purchaseN = asNum(purchase?.number)
  const paymentPurchaseN = asNum(asRec(payment?.purchase)?.number)

  const folio =
    asStr(r.folio) ??
    (saleN != null ? `V-${saleN}` : null) ??
    (asStr(r.saleId) != null && topN != null ? `V-${topN}` : null) ??
    (orderN != null ? formatFolio(folioFmt.prefix, orderN, folioFmt.digits) : null) ??
    (countN != null ? `CC-${String(countN).padStart(6, "0")}` : null) ??
    (purchaseN != null ? `OC-${String(purchaseN).padStart(6, "0")}` : null) ??
    (paymentPurchaseN != null ? `OC-${String(paymentPurchaseN).padStart(6, "0")}` : null) ??
    (topN != null ? `V-${topN}` : null)

  const parts: string[] = folio ? [folio] : []
  let entityLabel: string | undefined = folio ?? undefined

  switch (kind) {
    case "SALE":
    case "RETAIL":
    case "SALE_DOCUMENT":
    case "SALE_DOCUMENT_CHECKOUT": {
      const total = asNum(r.total) ?? asNum(sale?.total)
      if (total != null) parts.push(money(total))
      break
    }
    case "SALE_DOCUMENT_PAYMENT": {
      const paid = asNum(r.paid)
      const balance = asNum(r.balance)
      if (paid != null) parts.push(`Abono ${money(paid)}`)
      if (balance != null) parts.push(`saldo ${money(balance)}`)
      break
    }
    case "SALE_RETURN": {
      const refunded = asNum(r.refunded)
      if (refunded != null) parts.push(`Reembolso ${money(refunded)}`)
      break
    }
    case "RESERVATION_CREATE": {
      const rows = Array.isArray(r.reservations) ? (r.reservations as unknown[]) : []
      const first = asRec(rows[0])
      const firstProduct = asStr(asRec(first?.product)?.name)
      if (rows.length === 1 && firstProduct) entityLabel = firstProduct
      if (rows.length > 0) parts.push(`${rows.length} artículo${rows.length === 1 ? "" : "s"}`)
      const total = asNum(r.total)
      if (total != null) parts.push(money(total))
      break
    }
    case "REPAIR_CREATE": {
      const customer = asStr(order?.customerName)
      const equipment = asStr(order?.equipmentType) ?? asStr(order?.serviceName)
      if (customer) parts.push(customer)
      if (equipment) parts.push(equipment)
      break
    }
    case "REPAIR_UPDATE": {
      const s = statusLabel(order?.status)
      if (s) parts.push(`→ ${s}`)
      break
    }
    case "PURCHASE_CREATE":
    case "PURCHASE_FROM_NEEDS": {
      const total = centsToMoney(purchase?.totalCents)
      if (total) parts.push(total)
      const supplier = asStr(asRec(purchase?.supplier)?.name)
      if (supplier) parts.push(supplier)
      break
    }
    case "PURCHASE_STATUS": {
      const s = statusLabel(r.status)
      if (s) parts.push(`→ ${s}`)
      const branchName = asStr(r.branchName)
      if (branchName) parts.push(branchName)
      break
    }
    case "SUPPLIER_PAYMENT": {
      const amount = centsToMoney(payment?.amountCents)
      if (amount) parts.push(amount)
      const supplier = asStr(asRec(payment?.supplier)?.name)
      if (supplier) parts.push(supplier)
      break
    }
    case "COUNT_ITEMS": {
      const saved = asNum(r.saved)
      if (saved != null) parts.push(`${saved} producto${saved === 1 ? "" : "s"} capturado${saved === 1 ? "" : "s"}`)
      break
    }
    case "COUNT_APPLY": {
      const adjustments = asNum(r.adjustments)
      if (adjustments != null) parts.push(`${adjustments} ajuste${adjustments === 1 ? "" : "s"}`)
      const branchName = asStr(r.branchName)
      if (branchName) parts.push(branchName)
      break
    }
    case "SHOPPING_ITEM_ADD": {
      const description = asStr(item?.description)
      const quantity = asNum(item?.quantity)
      if (description) parts.push(quantity != null && quantity > 1 ? `${description} ×${quantity}` : description)
      if (description) entityLabel = description
      break
    }
    case "SHOPPING_ITEM_RESOLVE": {
      const s = statusLabel(r.status)
      if (s) parts.push(s)
      break
    }
    case "INVENTORY": {
      const movements = Array.isArray(r.movements) ? (r.movements as unknown[]) : []
      if (movements.length > 0) parts.push(`${movements.length} movimiento${movements.length === 1 ? "" : "s"}`)
      const reason = asStr(asRec(movements[0])?.reason)
      if (reason) parts.push(reason.length > 80 ? `${reason.slice(0, 80)}…` : reason)
      break
    }
    case "DEBT":
    case "CREDIT_DEBT":
    case "CREDIT_PAYMENT": {
      const balance = asNum(r.creditBalance)
      if (balance != null) parts.push(`Saldo ${money(balance)}`)
      break
    }
    case "CONVENIO_SETTLE": {
      const side = asStr(r.side)
      if (side) parts.push(side === "pagar" ? "pago al taller asociado" : "cobro al captador")
      parts.push(r.convenioSettledAt == null ? "reabierto" : "saldado")
      break
    }
    case "CASH_OPEN": {
      const initial = pesosToMoney(r.initialAmount)
      if (initial) parts.push(`Fondo ${initial}`)
      break
    }
    case "CASH_CLOSE": {
      const final = pesosToMoney(r.finalAmount)
      if (final) parts.push(`Cierre ${final}`)
      const diff = asNum(r.differenceCents)
      if (diff != null && diff !== 0) parts.push(`dif. ${money(diff / 100)}`)
      break
    }
    case "CASH_IN":
    case "CASH_OUT": {
      const amount = pesosToMoney(r.amount)
      if (amount) parts.push(amount)
      const description = asStr(r.description)
      if (description) parts.push(description.length > 80 ? `${description.slice(0, 80)}…` : description)
      break
    }
    case "CASH_REQUEST":
    case "CASH_REQUEST_DECIDE": {
      const s = statusLabel(request?.status)
      if (kind === "CASH_REQUEST_DECIDE" && s) parts.push(s)
      const amount = centsToMoney(request?.amountCents)
      if (amount) parts.push(amount)
      const concept = asStr(request?.concept)
      if (concept) parts.push(concept)
      break
    }
    case "PRODUCT_CREATE": {
      const name = asStr(product?.name)
      if (name) {
        parts.push(name)
        entityLabel = name
      }
      const price = asNum(product?.retailPrice)
      if (price != null) parts.push(money(price))
      break
    }
    case "BRANCH_CREATE": {
      const name = asStr(branch?.name)
      if (name) {
        parts.push(name)
        entityLabel = name
      }
      break
    }
    case "DEVICE_MODEL_UPSERT": {
      const name = [asStr(model?.brand), asStr(model?.model)].filter(Boolean).join(" ")
      if (name) {
        parts.push(name)
        entityLabel = name
      }
      break
    }
    case "WORKSHOP_SERVICE_CREATE": {
      const name = asStr(service?.name)
      if (name) {
        parts.push(name)
        entityLabel = name
      }
      break
    }
    default: {
      // Kinds sin resumen propio: intenta el total y el estado genéricos.
      const total = pesosToMoney(r.total) ?? centsToMoney(r.totalCents)
      if (total) parts.push(total)
      const s = statusLabel(r.status)
      if (s) parts.push(`→ ${s}`)
    }
  }

  if (parts.length === 0) parts.push(`#${opId.slice(0, 8)}`)
  return { summary: parts.join(" · "), entityLabel }
}

// ---------------------------------------------------------------------------
// AuditEvent: forma pactada con src/lib/audit.ts (modelo aún en paralelo).
// Mientras no exista en el cliente Prisma, `auditDelegate` es undefined y la
// fuente simplemente no aporta filas.
// ---------------------------------------------------------------------------

type AuditRow = {
  id: string
  actorId: string
  action: string
  entity: string | null
  entityId: string | null
  entityName: string | null
  summary: string | null
  changes: unknown
  createdAt: Date
  actor: { id: string; name: string; role: string } | null
}

function parseChanges(raw: unknown): { field: string; before: unknown; after: unknown }[] {
  // Forma esperada: [{ field, before, after }]. Tolera { campo: {before,after} }
  // y { campo: valor } por si el módulo guarda otro layout.
  if (Array.isArray(raw)) {
    return raw
      .map(entry => {
        const rec = asRec(entry)
        const field = asStr(rec?.field)
        return field ? { field, before: rec?.before, after: rec?.after } : null
      })
      .filter((c): c is { field: string; before: unknown; after: unknown } => c !== null)
  }
  const rec = asRec(raw)
  if (!rec) return []
  return Object.entries(rec).map(([field, v]) => {
    const pair = asRec(v)
    return pair && ("before" in pair || "after" in pair)
      ? { field, before: pair.before, after: pair.after }
      : { field, before: undefined, after: v }
  })
}

const formatValue = (v: unknown): string => {
  if (v == null) return "—"
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—"
  if (typeof v === "boolean") return v ? "sí" : "no"
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v)
  } catch {
    return "—"
  }
}

function auditLabelOf(action: string, changes: { field: string }[]): string {
  if (action === "PRODUCT_UPDATE" && changes.some(c => /price|cost|amount/i.test(c.field))) {
    return "Cambio de precio"
  }
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action]
  for (const [prefix, label] of AUDIT_PREFIX_LABELS) {
    if (action.startsWith(prefix)) return label
  }
  return "Auditoría"
}

function auditItem(row: AuditRow): ActivityItem {
  const changes = parseChanges(row.changes)
  const entityLabel = asStr(row.entityName) ?? asStr(row.entity) ?? undefined
  let summary = asStr(row.summary)
  if (!summary) {
    // Sin summary guardado: "<entidad>: <campo>: antes → después" del primer cambio.
    const first = changes[0]
    const before = first ? asNum(first.before) : null
    const after = first ? asNum(first.after) : null
    const detail =
      changes.length === 1 && first && /price|cost|amount/i.test(first.field) && before != null && after != null
        ? `${money(before)} → ${money(after)}`
        : first
          ? `${first.field}: ${formatValue(first.before)} → ${formatValue(first.after)}`
          : null
    summary = [entityLabel, detail].filter(Boolean).join(": ") || row.action
  }
  return {
    id: row.id,
    source: "audit",
    actorId: row.actorId,
    actorName: row.actor?.name ?? "—",
    actorRole: row.actor?.role ?? "—",
    action: row.action,
    label: auditLabelOf(row.action, changes),
    summary,
    changes: changes.length > 0 ? changes : undefined,
    entityLabel,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Mapeo de las otras dos fuentes
// ---------------------------------------------------------------------------

type ActorLite = { id: string; name: string; role: string } | null

function operationItem(
  row: { id: string; actorId: string; kind: string; response: unknown; createdAt: Date; actor: ActorLite },
  folioFmt: { prefix: string; digits: number },
): ActivityItem {
  const { summary, entityLabel } = summarizeOperation(row.kind, row.response, row.id, folioFmt)
  return {
    id: row.id,
    source: "operation",
    actorId: row.actorId,
    actorName: row.actor?.name ?? "—",
    actorRole: row.actor?.role ?? "—",
    action: row.kind,
    label: kindLabel(row.kind),
    summary,
    entityLabel,
    createdAt: row.createdAt.toISOString(),
  }
}

function repairItem(
  row: { id: string; actorId: string; type: string; detail: string; createdAt: Date; actor: ActorLite; order: { number: number } | null },
  folioFmt: { prefix: string; digits: number },
): ActivityItem {
  return {
    id: row.id,
    source: "repair",
    actorId: row.actorId,
    actorName: row.actor?.name ?? "—",
    actorRole: row.actor?.role ?? "—",
    action: row.type,
    label: REPAIR_EVENT_LABELS[row.type] ?? "Taller",
    summary: row.detail,
    entityLabel: row.order ? formatFolio(folioFmt.prefix, row.order.number, folioFmt.digits) : undefined,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

/** `to`/`from` con fecha corta "YYYY-MM-DD" = día local completo (borde start/end). */
function parseDateParam(raw: string | null, edge: "start" | "end"): Date | null {
  const value = raw?.trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${edge === "end" ? "23:59:59.999" : "00:00:00.000"}`)
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Cursor `${createdAtISO}~${id}`; un cursor malformado se ignora (primera página). */
function parseCursor(raw: string | null): { at: Date; id: string } | null {
  const sep = raw?.indexOf("~") ?? -1
  if (!raw || sep <= 0) return null
  const at = new Date(raw.slice(0, sep))
  const id = raw.slice(sep + 1)
  if (Number.isNaN(at.getTime()) || !id) return null
  return { at, id }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const sp = new URL(req.url).searchParams
    const actorId = sp.get("actorId")?.trim() || null
    const sourceParam = sp.get("source")?.trim()
    const source: ActivityItem["source"] | null =
      sourceParam === "audit" || sourceParam === "operation" || sourceParam === "repair" ? sourceParam : null
    const q = sp.get("q")?.trim() || null
    const takeParam = Number(sp.get("take") ?? "50")
    const take = Math.min(100, Math.max(1, Number.isFinite(takeParam) ? Math.trunc(takeParam) : 50))
    const from = parseDateParam(sp.get("from"), "start")
    const to = parseDateParam(sp.get("to"), "end")
    const cursor = parseCursor(sp.get("cursor"))

    // Con `q` el filtro corre sobre el resumen ya construido (en operations el
    // texto vive dentro del JSON `response`), así que se lee el tope por fuente.
    const perSource = q ? 200 : take

    // Where compartido por las tres fuentes (todas tienen businessId, actorId,
    // createdAt e id). Estructuralmente asignable a cada *WhereInput de Prisma.
    const baseWhere: {
      businessId: string
      actorId?: string
      createdAt?: { gte?: Date; lte?: Date }
      OR?: ({ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } })[]
    } = {
      businessId,
      ...(actorId ? { actorId } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
        : {}),
    }
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }]
    const actorSelect = { select: { id: true, name: true, role: true } }

    // AuditEvent: cast laxo hasta que el modelo exista en el cliente generado.
    const auditDelegate = (
      prisma as unknown as { auditEvent?: { findMany(args: Rec): Promise<AuditRow[]> } }
    ).auditEvent

    const [operations, repairs, audits, staff, folioSettings] = await Promise.all([
      !source || source === "operation"
        ? prisma.businessOperation.findMany({
            where: baseWhere,
            orderBy,
            take: perSource,
            include: { actor: actorSelect },
          })
        : Promise.resolve([]),
      !source || source === "repair"
        ? prisma.repairEvent.findMany({
            where: baseWhere,
            orderBy,
            take: perSource,
            include: { actor: actorSelect, order: { select: { number: true } } },
          })
        : Promise.resolve([]),
      (!source || source === "audit") && auditDelegate
        ? auditDelegate.findMany({
            where: baseWhere,
            orderBy,
            take: perSource,
            include: { actor: actorSelect },
          })
        : Promise.resolve([]),
      // Filtro "por empleado" del cliente: staff activo del negocio.
      prisma.user.findMany({
        where: { businessId, role: { in: ["ADMIN", "EMPLOYEE"] }, status: "APPROVED" },
        select: { id: true, name: true, role: true },
      }),
      // Folio de taller con el prefijo/dígitos configurados (order_prefix,
      // order_folio_digits); llaves ausentes caen al default OT-000000.
      getBusinessSettingsMap(businessId, ["order_prefix", "order_folio_digits"]).catch(() => new Map<string, string>()),
    ])
    const folioFmt = {
      prefix: folioSettings.get("order_prefix") ?? "OT",
      digits: parseFolioDigits(folioSettings.get("order_folio_digits")),
    }

    const items: ActivityItem[] = [
      ...operations.map(row => operationItem(row, folioFmt)),
      ...repairs.map(row => repairItem(row, folioFmt)),
      ...audits.map(row => auditItem(row)),
    ]

    // `q` busca sobre el texto final (etiqueta, resumen, folio, acción cruda).
    const needle = q?.toLowerCase() ?? null
    const filtered = needle
      ? items.filter(i =>
          i.label.toLowerCase().includes(needle) ||
          i.summary.toLowerCase().includes(needle) ||
          i.action.toLowerCase().includes(needle) ||
          (i.entityLabel?.toLowerCase().includes(needle) ?? false))
      : items

    filtered.sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1)

    const page = filtered.slice(0, take)
    const last = page[page.length - 1]
    const nextCursor = page.length === take && last ? `${last.createdAt}~${last.id}` : null

    // Actores del feed: todo el staff activo + cualquier actor de la página
    // que no sea staff (p. ej. un CUSTOMER que generó RESERVATION_CREATE).
    const known = new Set(staff.map(u => u.id))
    const missing = [...new Set(page.map(i => i.actorId).filter(id => !known.has(id)))]
    const extras =
      missing.length > 0
        ? await prisma.user.findMany({
            where: { businessId, id: { in: missing } },
            select: { id: true, name: true, role: true },
          })
        : []
    const actors = [...staff, ...extras]

    return NextResponse.json(
      { items: page, nextCursor, actors },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    return businessFailure(error)
  }
}
