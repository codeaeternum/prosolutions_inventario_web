import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { cents } from "@/lib/domain/operations"
import { repairFolio } from "@/lib/workshop-labels"
import { getBusinessSetting, getOrderFolioDigits } from "@/lib/settings"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/caja/movements — "movimientos de dinero": vista unificada de
 * auditoría que junta las cuatro fuentes del rastro monetario del negocio:
 *
 *   CashMovement  → CASH_IN / CASH_OUT (asientos del cajón por sucursal)
 *   Payment       → PAYMENT / PAYMENT_REFUND / PAYMENT_VOID — solo los SIN
 *                   cashMovementId: el cobro en efectivo ya aparece como su
 *                   propio asiento de caja e incluirlo duplicaría el dinero.
 *                   Se incluyen los tres estados con dinero real: CONFIRMED
 *                   es dinero que entró, REFUNDED (amount negativo) el que
 *                   salió de vuelta y VOIDED el cobro anulado — el par
 *                   VOIDED/REFUNDED cancela igual que en methodTotals de
 *                   /api/caja, así una venta anulada cuadra a 0 en el feed.
 *                   PENDING_REVIEW se omite (aún no es dinero).
 *   CreditMovement→ CREDIT_DEBT (−, mercancía fiada que se debe cobrar),
 *                   CREDIT_PAYMENT (+, abono cobrado) y CREDIT_REVERSAL
 *                   (+, deuda perdonada — cancela el cargo, p. ej. al
 *                   devolver una venta a crédito).
 *   SupplierPayment → SUPPLIER_PAYMENT (−, salida del negocio a proveedor).
 *
 * El signo de amountCents se lee como dirección del dinero para el negocio
 * (+ entra / − sale o comprometido): un abono CREDIT_PAYMENT en efectivo y un
 * SUPPLIER_PAYMENT con cashFromRegister ya tienen su asiento en CashMovement
 * — llegan marcados con duplicatesCash para no sumarlos dos veces.
 *
 * ?days=  ventana hacia atrás (default 7, máx 90)
 * ?take=  tope de filas tras el merge (default 200, máx 500)
 * ?branchId= sucursal a filtrar (validada con assertBranchAllowed). Sin
 *   filtro explícito, el empleado con sucursales asignadas solo ve caja y
 *   cobros de las suyas; los movimientos sin sucursal atribuible (crédito y
 *   abonos a cuenta general) son del negocio y siempre se muestran — la
 *   misma regla que paymentScopeWhere en domain/supplier-payments.
 */

const DEFAULT_DAYS = 7
const MAX_DAYS = 90
const DEFAULT_TAKE = 200
const MAX_TAKE = 500

/** Montos guardados como Float → centavos con signo (cents() solo acepta ≥ 0). */
function signedCents(value: number): number {
  return value < 0 ? -cents(-value, true) : cents(value, true)
}

type BranchScope = string | { in: string[] } | undefined

type MovementKind =
  | "CASH_IN" | "CASH_OUT"
  | "PAYMENT" | "PAYMENT_REFUND" | "PAYMENT_VOID"
  | "CREDIT_DEBT" | "CREDIT_PAYMENT" | "CREDIT_REVERSAL"
  | "SUPPLIER_PAYMENT"

interface MoneyMovementRow {
  id: string
  kind: MovementKind
  occurredAt: Date
  branchId: string | null
  branchName: string | null
  userId: string | null
  actorName: string
  /** Con signo: + dinero que entra / − el que sale o queda comprometido. */
  amountCents: number
  method: string | null
  reference: string | null
  description: string
  href: string | null
  /** El mismo dinero también tiene su propio asiento de caja en la lista. */
  duplicatesCash: boolean
}

/** Link interno al documento que originó el movimiento de caja. */
function cashHref(referenceType: string | null, referenceId: string | null, payment?: { saleId?: string | null; repairOrderId?: string | null; encargoId?: string | null } | null): string | null {
  if (!referenceId) return null
  switch (referenceType) {
    case "SALE":
    case "RETURN":
      return `/admin/tickets/venta/${referenceId}`
    case "RESERVATION":
      return `/admin/tickets/reserva/${referenceId}`
    case "REPAIR_PAYMENT":
    case "REPAIR_REFUND":
      return payment?.repairOrderId ? `/admin/tickets/reparacion/${payment.repairOrderId}` : null
    case "ENCARGO_DEPOSIT":
    case "ENCARGO_REFUND":
      return payment?.encargoId ? "/admin/inventario?tab=encargos" : null
    case "SUPPLIER_PAYMENT":
      return "/admin/inventario?tab=entradas&sub=proveedores"
    case "EXPENSE":
      return "/admin/caja?tab=solicitudes"
    default:
      return null
  }
}

/** Link al documento de un CreditMovement (venta/reserva que originó el cargo). */
function creditHref(referenceType: string | null, referenceId: string | null): string | null {
  if (!referenceId) return null
  if (referenceType === "SALE") return `/admin/tickets/venta/${referenceId}`
  if (referenceType === "RESERVATION") return `/admin/tickets/reserva/${referenceId}`
  return null
}

const PAYMENT_PURPOSE_LABELS: Record<string, string> = {
  ADVANCE: "anticipo", ABONO: "abono", SETTLEMENT: "liquidación", REFUND: "devolución", RESERVATION: "apartado",
}

export async function GET(req: Request) {
  try {
    const auth = await requireModule("caja")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)

    const url = new URL(req.url)
    const parsedDays = parseInt(url.searchParams.get("days") ?? "", 10)
    const days = Number.isFinite(parsedDays) ? Math.min(MAX_DAYS, Math.max(1, parsedDays)) : DEFAULT_DAYS
    const parsedTake = parseInt(url.searchParams.get("take") ?? "", 10)
    const take = Number.isFinite(parsedTake) ? Math.min(MAX_TAKE, Math.max(1, parsedTake)) : DEFAULT_TAKE

    const branchId = url.searchParams.get("branchId") || undefined
    const deniedBranch = assertBranchAllowed(session, branchId)
    if (deniedBranch) return deniedBranch

    // Mismo criterio que GET /api/caja: sin filtro explícito el empleado con
    // sucursales asignadas solo ve lo suyo; ADMIN y el empleado sin lista lo ven todo.
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const branchScope: BranchScope = branchId ?? (allowed?.length ? { in: allowed } : undefined)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const paymentBranchScope = branchScope
      ? { OR: [{ sale: { branchId: branchScope } }, { repairOrder: { currentBranchId: branchScope } }, { encargo: { branchId: branchScope } }] }
      : {}
    // Abonos a cuenta general (purchaseId null) son del negocio: no se recortan.
    const supplierBranchScope = branchScope
      ? { OR: [{ purchaseId: null }, { purchase: { branchId: branchScope } }] }
      : {}

    const [cashMovements, payments, creditMovements, supplierPayments, folioDigits, orderPrefix] = await Promise.all([
      prisma.cashMovement.findMany({
        where: {
          businessId,
          createdAt: { gte: since },
          ...(branchScope ? { register: { branchId: branchScope } } : {}),
        },
        include: {
          register: { select: { branchId: true, branch: { select: { name: true } } } },
          user: { select: { name: true } },
          // Documento de cobro ligado (Payment.cashMovementId): método, folio
          // externo y destino del link cuando el asiento es de taller/encargo.
          payment: { select: { method: true, reference: true, saleId: true, repairOrderId: true, encargoId: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
      }),
      prisma.payment.findMany({
        where: {
          businessId,
          createdAt: { gte: since },
          status: { in: ["CONFIRMED", "REFUNDED", "VOIDED"] },
          // El cobro con asiento de caja ya sale como fila CASH_IN/CASH_OUT.
          cashMovementId: null,
          ...paymentBranchScope,
        },
        include: {
          sale: { select: { id: true, number: true, branchId: true, branch: { select: { name: true } } } },
          repairOrder: { select: { id: true, number: true, currentBranchId: true, currentBranch: { select: { name: true } } } },
          encargo: { select: { id: true, branchId: true, branch: { select: { name: true } } } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
      }),
      // Sin sucursal atribuible: el cliente (user) es el actor del cargo/abono.
      prisma.creditMovement.findMany({
        where: { businessId, createdAt: { gte: since } },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take,
      }),
      prisma.supplierPayment.findMany({
        where: { businessId, createdAt: { gte: since }, ...supplierBranchScope },
        include: {
          supplier: { select: { name: true } },
          purchase: { select: { number: true, branchId: true, branch: { select: { name: true } } } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
      }),
      getOrderFolioDigits(businessId),
      // Prefijo del folio de taller (order_prefix): los documentos de
      // referencia "Taller PS-000123" salen con el mismo formato del ticket.
      getBusinessSetting(businessId, "order_prefix").catch(() => null),
    ])

    // Asientos de caja ligados a un abono de crédito (referenceType
    // CREDIT_PAYMENT) o a un pago de proveedor en efectivo (SUPPLIER_PAYMENT):
    // esas filas llegan con duplicatesCash — el mismo dinero está dos veces
    // en el feed (ledger de crédito/proveedor + cajón). Se consulta aparte
    // porque el asiento puede quedar fuera del `take` de su fuente.
    const linkedIds = [...creditMovements.map(m => m.id), ...supplierPayments.map(p => p.id)]
    const cashSeats = linkedIds.length
      ? await prisma.cashMovement.findMany({
          where: { businessId, referenceType: { in: ["CREDIT_PAYMENT", "SUPPLIER_PAYMENT"] }, referenceId: { in: linkedIds } },
          select: { referenceId: true },
        })
      : []
    const inCash = new Set(cashSeats.map(row => row.referenceId))

    const rows: MoneyMovementRow[] = [
      ...cashMovements.map(m => ({
        id: m.id,
        kind: (m.type === "IN" ? "CASH_IN" : "CASH_OUT") as MovementKind,
        occurredAt: m.createdAt,
        branchId: m.register?.branchId ?? null,
        branchName: m.register?.branch?.name ?? null,
        userId: m.userId,
        actorName: m.user?.name ?? "—",
        amountCents: m.type === "IN" ? signedCents(m.amount) : -signedCents(m.amount),
        method: m.payment?.method ?? null,
        reference: m.payment?.reference ?? null,
        description: m.description,
        href: cashHref(m.referenceType, m.referenceId, m.payment),
        duplicatesCash: false,
      })),
      ...payments.map(p => {
        const branchIdOf = p.sale?.branchId ?? p.repairOrder?.currentBranchId ?? p.encargo?.branchId ?? null
        const branchName = p.sale?.branch?.name ?? p.repairOrder?.currentBranch?.name ?? p.encargo?.branch?.name ?? null
        const documentRef = p.sale
          ? `V-${p.sale.number}`
          : p.repairOrder
            ? repairFolio(p.repairOrder.number, folioDigits, orderPrefix)
            : p.encargoId
              ? "Encargo"
              : null
        const href = p.saleId
          ? `/admin/tickets/venta/${p.saleId}`
          : p.repairOrderId
            ? `/admin/tickets/reparacion/${p.repairOrderId}`
            : p.encargoId
              ? "/admin/inventario?tab=encargos"
              : null
        const purpose = p.purpose ? (PAYMENT_PURPOSE_LABELS[p.purpose] ?? p.purpose) : null
        const description =
          p.status === "VOIDED"
            ? `Cobro anulado${documentRef ? ` · ${documentRef}` : ""}`
            : `${p.status === "REFUNDED" ? "Reembolso" : "Cobro"}${documentRef ? ` ${documentRef}` : ""}${purpose ? ` · ${purpose}` : ""}`
        return {
          id: p.id,
          kind: (p.status === "VOIDED" ? "PAYMENT_VOID" : p.status === "REFUNDED" ? "PAYMENT_REFUND" : "PAYMENT") as MovementKind,
          occurredAt: p.createdAt,
          branchId: branchIdOf,
          branchName,
          userId: p.createdById,
          actorName: p.createdBy?.name ?? "—",
          // REFUNDED ya se guarda con amount negativo.
          amountCents: signedCents(p.amount),
          method: p.method,
          reference: p.reference ?? documentRef,
          description: p.notes ? `${description} — ${p.notes}` : description,
          href,
          duplicatesCash: false,
        }
      }),
      ...creditMovements.map(m => ({
        id: m.id,
        kind: (m.type === "DEBT" ? "CREDIT_DEBT" : m.type === "PAYMENT" ? "CREDIT_PAYMENT" : "CREDIT_REVERSAL") as MovementKind,
        occurredAt: m.createdAt,
        branchId: null,
        branchName: null,
        userId: m.userId,
        actorName: m.user?.name ?? "—",
        // Signo: la deuda sale como mercancía fiada (−), el abono entra (+) y
        // la reversión (+) cancela un cargo que ya no se cobrará.
        amountCents: m.type === "DEBT" ? -signedCents(m.amount) : signedCents(m.amount),
        method: null,
        reference: m.referenceType ?? null,
        description: m.notes ?? (m.type === "DEBT" ? "Cargo a crédito" : m.type === "PAYMENT" ? "Abono de cliente" : "Reversión de deuda"),
        href: creditHref(m.referenceType, m.referenceId),
        duplicatesCash: inCash.has(m.id),
      })),
      ...supplierPayments.map(p => ({
        id: p.id,
        kind: "SUPPLIER_PAYMENT" as MovementKind,
        occurredAt: p.createdAt,
        branchId: p.purchase?.branchId ?? null,
        branchName: p.purchase?.branch?.name ?? null,
        userId: p.createdById,
        actorName: p.createdBy?.name ?? "—",
        amountCents: -p.amountCents,
        method: p.method,
        reference: p.purchase ? `OC-${String(p.purchase.number).padStart(6, "0")}` : "Cuenta general",
        description: `Pago a proveedor ${p.supplier.name}${p.notes ? ` — ${p.notes}` : ""}`,
        href: "/admin/inventario?tab=entradas&sub=proveedores",
        duplicatesCash: inCash.has(p.id),
      })),
    ]

    rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))
    const movements = rows.slice(0, take)

    return NextResponse.json(
      { days, take, count: movements.length, movements },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch {
    return NextResponse.json({ error: "Error al obtener los movimientos de dinero" }, { status: 500 })
  }
}
