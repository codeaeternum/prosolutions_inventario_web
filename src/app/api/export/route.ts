import { NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { getOrderFolioDigits } from "@/lib/settings"
import { repairFolio, repairLabels } from "@/lib/workshop-labels"
import { orderTotalCents } from "@/lib/workshop-money"

const MAX_ROWS = 5000
const EXPORT_TYPES = ["products", "sales", "orders"] as const
type ExportType = (typeof EXPORT_TYPES)[number]

const paymentMethodLabels: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  CREDIT: "Crédito",
}
const saleStatusLabels: Record<string, string> = { COMPLETED: "Completada", VOIDED: "Anulada" }

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvCell).join(",")]
  for (const row of rows) lines.push(row.map(csvCell).join(","))
  // BOM para que Excel respete UTF-8 (acentos, ñ)
  return "\uFEFF" + lines.join("\r\n")
}

function csvResponse(type: ExportType, csv: string): NextResponse {
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-${date}.csv"`,
      "Cache-Control": "private, no-store",
    },
  })
}

const money = (n: number) => n.toFixed(2)
const centsToPesos = (cents: number) => (cents / 100).toFixed(2)

function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function exportProducts(businessId: string): Promise<string> {
  const [products, branches] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, isActive: true },
      orderBy: { name: "asc" },
      take: MAX_ROWS,
      include: {
        category: { select: { name: true } },
        stocks: { where: { businessId }, select: { branchId: true, quantity: true } },
      },
    }),
    prisma.branch.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
  ])
  const headers = [
    "Código de barras",
    "Nombre",
    "Categoría",
    "Costo",
    "Precio público",
    "Precio aliado",
    "Precio taller propio",
    "Stock total",
    ...branches.map((b) => `Stock: ${b.name}`),
    "Visibilidad mercado",
  ]
  const rows = products.map((p) => {
    const stockByBranch = new Map(p.stocks.map((s) => [s.branchId, s.quantity]))
    return [
      p.barcode ?? "",
      p.name,
      p.category.name,
      p.costPrice != null ? money(p.costPrice) : "",
      money(p.retailPrice),
      money(p.wholesalePrice),
      p.internalPrice != null ? money(p.internalPrice) : "",
      p.stock,
      ...branches.map((b) => stockByBranch.get(b.id) ?? 0),
      { HIDDEN: "Oculto", ALLIES: "Aliados", PUBLIC: "Público" }[p.marketVisibility] ?? p.marketVisibility,
    ]
  })
  return toCsv(headers, rows)
}

async function exportSales(businessId: string, branchId?: string): Promise<string> {
  const sales = await prisma.sale.findMany({
    // Solo documentos comprometidos: los vivos (DRAFT/OPEN) no son venta aún.
    where: { businessId, status: { in: ["COMPLETED", "VOIDED"] }, ...(branchId ? { branchId } : {}) },
    orderBy: { number: "desc" },
    take: MAX_ROWS,
    include: {
      branch: { select: { name: true } },
      seller: { select: { name: true } },
      customer: { select: { name: true } },
      items: { select: { quantity: true } },
      payments: { select: { method: true, status: true } },
    },
  })
  const headers = ["Folio", "Fecha", "Sucursal", "Cliente", "Vendedor", "Artículos", "Total", "Descuento", "Método de pago", "Estado"]
  const rows = sales.map((s) => [
    `V-${String(s.number).padStart(6, "0")}`,
    formatDateTime(s.createdAt),
    s.branch.name,
    s.customer?.name ?? "Mostrador",
    s.seller.name,
    s.items.reduce((sum, i) => sum + i.quantity, 0),
    // Lo cobrado: catálogo menos el descuento autorizado al cobrar.
    money(s.total - s.discountCents / 100),
    s.discountCents > 0 ? `${money(s.discountCents / 100)}${s.discountReason ? ` (${s.discountReason})` : ""}` : "",
    [...new Set(s.payments.filter((p) => p.status !== "VOIDED").map((p) => paymentMethodLabels[p.method] ?? p.method))].join(" + "),
    saleStatusLabels[s.status] ?? s.status,
  ])
  return toCsv(headers, rows)
}

async function exportOrders(businessId: string, branchId?: string): Promise<string> {
  const orders = await prisma.repairOrder.findMany({
    where: { businessId, ...(branchId ? { currentBranchId: branchId } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_ROWS,
    include: {
      currentBranch: { select: { name: true } },
      assignedTo: { select: { name: true } },
      // CONFIRMED suman y los reembolsos REFUNDED (amount negativo) restan.
      payments: { where: { status: { in: ["CONFIRMED", "REFUNDED"] } }, select: { amount: true, status: true } },
      // Refacciones autorizadas: se cobran además de la mano de obra.
      parts: { where: { status: "APPROVED" }, select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true } },
    },
  })
  const headers = ["Folio", "Fecha recepción", "Cliente", "Teléfono", "Equipo", "Estado", "Sucursal", "Técnico", "Presupuesto", "Abonado", "Saldo"]
  // Mismo largo de folio que el ticket impreso (order_folio_digits del negocio).
  const folioDigits = await getOrderFolioDigits(businessId)
  const rows = orders.map((o) => {
    // Total de la orden: mano de obra + refacciones autorizadas (o el cargo
    // de diagnóstico en cierres sin reparación).
    const totalCents = orderTotalCents(o, o.parts)
    const paidCents = o.payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
    return [
      repairFolio(o.number, folioDigits),
      formatDateTime(o.createdAt),
      o.customerName,
      o.customerPhone,
      [o.equipmentType, o.brand, o.model].filter(Boolean).join(" "),
      repairLabels[o.status] ?? o.status,
      o.currentBranch.name,
      o.assignedTo?.name ?? "",
      centsToPesos(totalCents),
      centsToPesos(paidCents),
      centsToPesos(Math.max(0, totalCents - paidCents)),
    ]
  })
  return toCsv(headers, rows)
}

export async function GET(req: Request) {
  try {
    // Solo admin: los CSV incluyen costPrice y PII de clientes (teléfonos).
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const businessId = businessIdOf(getSession(auth)!)

    const query = new URL(req.url).searchParams
    const type = query.get("type") as ExportType | null
    if (!type || !EXPORT_TYPES.includes(type)) {
      return NextResponse.json({ error: "Tipo de exportación inválido. Usa products, sales u orders." }, { status: 400 })
    }
    const branchId = query.get("branchId") || undefined

    let csv: string
    switch (type) {
      case "products":
        csv = await exportProducts(businessId)
        break
      case "sales":
        csv = await exportSales(businessId, branchId)
        break
      case "orders":
        csv = await exportOrders(businessId, branchId)
        break
    }
    return csvResponse(type, csv)
  } catch (error) {
    console.error("Error exporting:", error)
    return NextResponse.json({ error: "Error al generar la exportación" }, { status: 500 })
  }
}
