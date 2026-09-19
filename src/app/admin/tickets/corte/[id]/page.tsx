import { notFound, redirect } from "next/navigation"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getBusinessSettingsMap } from "@/lib/settings"
import prisma from "@/lib/prisma"
import { DENOMINATION_CENTS, expectedCashCents, type CashMovementLike } from "@/lib/domain/cash"
import { CorteTicketView, type CorteTicketData } from "./corte-ticket-view"

export const dynamic = "force-dynamic"

const METHOD_LABELS: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito" }
const DENOM_LABELS: Record<string, string> = {
  "1000": "$1,000", "500": "$500", "200": "$200", "100": "$100", "50": "$50", "20": "$20",
  "10": "$10", "5": "$5", "2": "$2", "1": "$1", "0.5": "$0.50",
}

export default async function CorteTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Staff (admin|empleado): el corte de caja solo lo imprime mostrador.
  const staffCheck = await requireAdminOrEmployee()
  if (staffCheck.error) redirect("/login")
  const session = getSession(staffCheck)!
  const businessId = businessIdOf(session)

  const { id } = await params
  const register = await prisma.cashRegister.findUnique({
    where: { id, businessId },
    include: {
      branch: { select: { name: true } },
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      movements: {
        orderBy: { createdAt: "asc" },
        select: { type: true, amount: true, payment: { select: { method: true, amount: true } } },
      },
    },
  })

  // El corte es documento de caja cerrada; sin cierre no hay conteo que imprimir.
  if (!register || register.status !== "CLOSED" || !register.closedAt) notFound()

  // Cobrado por método durante el turno: los pagos CARD/TRANSFER no generan
  // CashMovement, así que el desglose sale de Payment acotado a la ventana
  // apertura→cierre y a la sucursal de la caja (vía venta u orden de taller).
  const paymentRows = await prisma.payment.groupBy({
    by: ["method"],
    where: {
      businessId,
      status: { in: ["CONFIRMED", "REFUNDED"] },
      createdAt: { gte: register.openedAt, lte: register.closedAt },
      ...(register.branchId
        ? { OR: [{ sale: { branchId: register.branchId } }, { repairOrder: { currentBranchId: register.branchId } }] }
        : {}),
    },
    _sum: { amount: true },
  })
  const methodTotals = ["CASH", "CARD", "TRANSFER", "CREDIT"].map(method => ({
    label: METHOD_LABELS[method],
    amount: paymentRows.find(row => row.method === method)?._sum.amount ?? 0,
  }))

  const expectedCents = expectedCashCents(register.initialAmount, register.movements as CashMovementLike[])
  const countedCents = register.finalAmount == null ? null : Math.round(register.finalAmount * 100)

  // Desglose del conteo físico, de mayor a menor denominación.
  const storedDenoms = (register.denominations ?? null) as Record<string, number> | null
  const denominations = storedDenoms
    ? Object.entries(DENOMINATION_CENTS)
        .map(([key, cents]) => ({ key, label: DENOM_LABELS[key] ?? `$${key}`, count: storedDenoms[key] ?? 0, subtotal: ((storedDenoms[key] ?? 0) * cents) / 100 }))
        .filter(row => row.count > 0)
        .sort((a, b) => parseFloat(b.key) - parseFloat(a.key))
    : []

  const ticketSettings = await getBusinessSettingsMap(businessId, ["ticket_business_name", "ticket_subtitle", "ticket_footer"])

  const data: CorteTicketData = {
    title: "CORTE DE CAJA",
    folio: `C-${register.id.slice(-8).toUpperCase()}`,
    businessName: ticketSettings.get("ticket_business_name") || "PROSOLUTIONS",
    subtitle: ticketSettings.get("ticket_subtitle") || "Venta de refacciones y\nReparación profesional",
    footer: ticketSettings.get("ticket_footer") || "¡Gracias por tu preferencia!",
    branch: register.branch?.name ?? "Sin sucursal",
    openedAt: register.openedAt.toISOString(),
    closedAt: register.closedAt.toISOString(),
    openedBy: register.openedBy.name,
    closedBy: register.closedBy?.name ?? "—",
    initialAmount: register.initialAmount,
    methodTotals,
    hasDenominations: storedDenoms != null,
    denominations,
    counted: countedCents == null ? null : countedCents / 100,
    expected: expectedCents / 100,
    difference: countedCents == null ? null : (countedCents - expectedCents) / 100,
    movementCount: register.movements.length,
    notes: register.notes ?? undefined,
  }

  return <CorteTicketView data={data} />
}
