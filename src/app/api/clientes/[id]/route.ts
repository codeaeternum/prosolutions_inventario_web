import { NextRequest, NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/utils"
import { getOrderFolioDigits } from "@/lib/settings"
import { repairFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { orderTotalCents } from "@/lib/workshop-money"
import { ReservationStatus, SaleStatus, CreditMovementType } from "@prisma/client"

/**
 * Vista 360 del cliente: perfil, KPIs y un timeline unificado con todo lo que
 * ha hecho en el negocio (taller, ventas, reservas y crédito).
 *
 * Las RepairOrder ligan al cliente por FK (customerId, estampado en recepción
 * por linkCustomerByPhone). Las históricas anteriores a la FK —o capturadas
 * antes del alta de la cuenta— quedan con customerId null, así que el empalme
 * conserva el respaldo por teléfono normalizado (últimos 10 dígitos, ver
 * normalizePhone) sobre customerPhone y customerPhoneAlt. Ambos conjuntos se
 * unen y deduplican por id de orden.
 */

const reservationLabels: Record<ReservationStatus, string> = {
  PENDING: "Pendiente",
  PENDING_PAYMENT: "Esperando pago",
  DEPOSIT_VERIFIED: "Depósito verificado",
  APPROVED: "Lista para recoger",
  REJECTED: "Rechazada",
  COMPLETED: "Entregada",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
}

const saleLabels: Record<SaleStatus, string> = {
  COMPLETED: "Completada",
  VOIDED: "Anulada",
}

const creditLabels: Record<CreditMovementType, string> = {
  DEBT: "Cargo a crédito",
  PAYMENT: "Abono a crédito",
  REVERSAL: "Reversión de deuda",
}

interface TimelineEvent {
  kind: "repair" | "sale" | "credit" | "reservation"
  id: string
  folio: string
  fecha: string
  descripcion: string
  monto: number | null
  status: string
  statusLabel: string
  href: string
}

// Misma transformación que normalizePhone pero en SQL: quita no-dígitos y
// conserva los últimos 10. Los teléfonos cortos quedan intactos (RIGHT con n
// mayor que la longitud devuelve la cadena completa).
async function repairOrderIdsByPhone(businessId: string, phoneNorm: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "RepairOrder"
    WHERE "businessId" = ${businessId}
      AND (
        RIGHT(regexp_replace("customerPhone", '[^0-9]', '', 'g'), 10) = ${phoneNorm}
        OR RIGHT(regexp_replace(COALESCE("customerPhoneAlt", ''), '[^0-9]', '', 'g'), 10) = ${phoneNorm}
      )
  `
  return rows.map((r) => r.id)
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireModule("clientes")
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const { id } = await params
    const user = await prisma.user.findFirst({
      where: { id, businessId, role: "CUSTOMER" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        telegramId: true,
        businessName: true,
        customerType: true,
        status: true,
        creditLimit: true,
        creditBalance: true,
        totalPurchases: true,
        createdAt: true,
      },
    })
    if (!user) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })

    const phoneNorm = normalizePhone(user.phone)
    // Unión FK + teléfono: las ligadas por customerId primero y, como respaldo,
    // las históricas que solo empatan por teléfono normalizado.
    const [linkedOrders, phoneIds] = await Promise.all([
      prisma.repairOrder.findMany({
        where: { businessId, customerId: id },
        select: { id: true },
      }),
      phoneNorm ? repairOrderIdsByPhone(businessId, phoneNorm) : Promise.resolve([]),
    ])
    const repairIds = [...new Set([...linkedOrders.map((o) => o.id), ...phoneIds])]

    const [repairs, sales, salesAgg, reservations, reservationsCount, credits, creditsCount, repairPaidAgg] =
      await Promise.all([
        repairIds.length
          ? prisma.repairOrder.findMany({
              where: { businessId, id: { in: repairIds } },
              select: {
                id: true,
                number: true,
                status: true,
                customerName: true,
                equipmentType: true,
                brand: true,
                model: true,
                reportedIssue: true,
                quoteCents: true,
                approvedQuoteCents: true,
                diagnosticFeeCents: true,
                // Solo autorizadas: son las que suman al total de la orden.
                parts: {
                  where: { status: "APPROVED" },
                  select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true },
                },
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 100,
            })
          : Promise.resolve([]),
        prisma.sale.findMany({
          where: { businessId, customerId: id },
          select: {
            id: true,
            number: true,
            status: true,
            total: true,
            createdAt: true,
            branch: { select: { name: true } },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        // "Total gastado": solo ventas vigentes (las anuladas no son gasto real).
        prisma.sale.aggregate({
          where: { businessId, customerId: id, status: "COMPLETED" },
          _sum: { total: true },
          _count: { _all: true },
        }),
        prisma.reservation.findMany({
          where: { businessId, userId: id },
          select: {
            id: true,
            quantity: true,
            totalPrice: true,
            status: true,
            type: true,
            createdAt: true,
            product: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        prisma.reservation.count({ where: { businessId, userId: id } }),
        prisma.creditMovement.findMany({
          where: { businessId, userId: id },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        prisma.creditMovement.count({ where: { businessId, userId: id } }),
        // Lo pagado en taller (anticipos/abonos/liquidaciones confirmados).
        repairIds.length
          ? prisma.payment.aggregate({
              where: { businessId, repairOrderId: { in: repairIds }, status: "CONFIRMED" },
              _sum: { amount: true },
            })
          : Promise.resolve({ _sum: { amount: null as number | null } }),
      ])

    const eventos: TimelineEvent[] = []

    // Largo del folio impreso configurado por el negocio (order_folio_digits).
    const folioDigits = await getOrderFolioDigits(businessId)
    for (const order of repairs) {
      const equipo = [order.equipmentType, order.brand, order.model].filter(Boolean).join(" ")
      // Total real de la orden: mano de obra + refacciones autorizadas
      // (o solo el cargo por diagnóstico en cierres sin reparación).
      const totalCents = orderTotalCents(order, order.parts)
      eventos.push({
        kind: "repair",
        id: order.id,
        folio: repairFolio(order.number, folioDigits),
        fecha: order.createdAt.toISOString(),
        descripcion: `${equipo} — ${order.reportedIssue}`.slice(0, 180),
        monto: totalCents > 0 ? totalCents / 100 : null,
        status: order.status,
        statusLabel: repairLabels[order.status as RepairStage] ?? order.status,
        href: `/admin/taller?orden=${order.id}`,
      })
    }

    for (const sale of sales) {
      const items = sale._count.items
      eventos.push({
        kind: "sale",
        id: sale.id,
        folio: `V-${String(sale.number).padStart(6, "0")}`,
        fecha: sale.createdAt.toISOString(),
        descripcion: `${items} producto${items === 1 ? "" : "s"} · ${sale.branch.name}`,
        monto: sale.total,
        status: sale.status,
        statusLabel: saleLabels[sale.status],
        href: `/admin/tickets/venta/${sale.id}`,
      })
    }

    for (const res of reservations) {
      eventos.push({
        kind: "reservation",
        id: res.id,
        folio: res.id.slice(-8).toUpperCase(),
        fecha: res.createdAt.toISOString(),
        descripcion: `${res.quantity} × ${res.product.name}${res.type === "DEPOSIT" ? " · con anticipo" : ""}`,
        monto: res.totalPrice,
        status: res.status,
        statusLabel: reservationLabels[res.status],
        href: `/admin/tickets/reserva/${res.id}`,
      })
    }

    for (const mov of credits) {
      const isDebt = mov.type === "DEBT"
      eventos.push({
        kind: "credit",
        id: mov.id,
        folio: mov.id.slice(-8).toUpperCase(),
        fecha: mov.createdAt.toISOString(),
        descripcion: mov.notes?.trim() || creditLabels[mov.type],
        // Signo: DEBT aumenta lo que debe; PAYMENT/REVERSAL lo reducen.
        monto: isDebt ? mov.amount : -mov.amount,
        status: mov.type,
        statusLabel: creditLabels[mov.type],
        href: mov.type === "PAYMENT" ? `/admin/tickets/abono/${mov.id}` : "/admin/credito",
      })
    }

    eventos.sort((a, b) => b.fecha.localeCompare(a.fecha))

    const ultimaActividad = eventos[0]?.fecha ?? null
    const kpis = {
      totalGastado: (salesAgg._sum.total ?? 0) + (repairPaidAgg._sum.amount ?? 0),
      ventas: salesAgg._count._all,
      reparaciones: repairIds.length,
      reservas: reservationsCount,
      movimientosCredito: creditsCount,
      ultimaActividad,
    }

    return NextResponse.json({ cliente: user, kpis, eventos })
  } catch (error) {
    console.error("Error fetching cliente 360:", error)
    return NextResponse.json({ error: "Error al obtener el cliente" }, { status: 500 })
  }
}
