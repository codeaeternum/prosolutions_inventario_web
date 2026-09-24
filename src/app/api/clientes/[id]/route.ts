import { NextRequest, NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/utils"
import { getOrderFolioDigits } from "@/lib/settings"
import { repairFolio, repairLabels, type RepairStage } from "@/lib/workshop-labels"
import { orderTotalCents } from "@/lib/workshop-money"

/**
 * Vista 360 del cliente: perfil, KPIs y las secciones que alimentan las
 * pestañas de la ficha (compras, crédito, apartados/reservas y taller).
 *
 * Las RepairOrder ligan al cliente por FK (customerId, estampado en recepción
 * por linkCustomerByPhone). Las históricas anteriores a la FK —o capturadas
 * antes del alta de la cuenta— quedan con customerId null, así que el empalme
 * conserva el respaldo por teléfono normalizado (últimos 10 dígitos, ver
 * normalizePhone) sobre customerPhone y customerPhoneAlt. Ambos conjuntos se
 * unen y deduplican por id de orden.
 */

// Reservas que siguen vivas (esperando pago/verificación o listas para recoger).
const PENDING_RESERVATION_STATUSES = ["PENDING", "PENDING_PAYMENT", "DEPOSIT_VERIFIED", "APPROVED"] as const
// Órdenes de taller aún abiertas: entregadas y canceladas ya cerraron ciclo.
const CLOSED_REPAIR_STATUSES = ["DELIVERED", "CANCELLED"] as const
// Documentos de venta vivos: apartados (OPEN) y ventas suspendidas/cotizaciones (DRAFT).
const OPEN_DOCUMENT_STATUSES = ["OPEN", "DRAFT"] as const

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
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
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

    const [repairs, openRepairs, sales, salesAgg, lastSale, reservations, pendingReservations, creditMovements, repairPaidAgg, documents] =
      await Promise.all([
        repairIds.length
          ? prisma.repairOrder.findMany({
              where: { businessId, id: { in: repairIds } },
              select: {
                id: true,
                number: true,
                status: true,
                equipmentType: true,
                brand: true,
                model: true,
                reportedIssue: true,
                quoteCents: true,
                approvedQuoteCents: true,
                diagnosticFeeCents: true,
                closedWithoutRepair: true,
                // Solo autorizadas: son las que suman al total de la orden.
                parts: {
                  where: { status: "APPROVED" },
                  select: { qty: true, unitCostCents: true, unitPriceCents: true, status: true },
                },
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              take: 50,
            })
          : Promise.resolve([]),
        repairIds.length
          ? prisma.repairOrder.count({
              where: { businessId, id: { in: repairIds }, status: { notIn: [...CLOSED_REPAIR_STATUSES] } },
            })
          : Promise.resolve(0),
        prisma.sale.findMany({
          where: { businessId, customerId: id },
          select: {
            id: true,
            number: true,
            status: true,
            kind: true,
            total: true,
            discountCents: true,
            createdAt: true,
            branch: { select: { name: true } },
            items: { select: { quantity: true, product: { select: { name: true } } }, take: 4 },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        // "Total comprado": solo ventas vigentes (las anuladas no son gasto real)
        // y lo efectivamente cobrado: total de catálogo menos descuento autorizado.
        prisma.sale.aggregate({
          where: { businessId, customerId: id, status: "COMPLETED" },
          _sum: { total: true, discountCents: true },
          _count: { _all: true },
        }),
        prisma.sale.findFirst({
          where: { businessId, customerId: id, status: "COMPLETED" },
          select: { createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.reservation.findMany({
          where: { businessId, userId: id },
          select: {
            id: true,
            quantity: true,
            totalPrice: true,
            depositAmount: true,
            depositPaid: true,
            status: true,
            type: true,
            expiresAt: true,
            createdAt: true,
            product: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        prisma.reservation.count({
          where: { businessId, userId: id, status: { in: [...PENDING_RESERVATION_STATUSES] } },
        }),
        prisma.creditMovement.findMany({
          where: { businessId, userId: id },
          select: {
            id: true,
            type: true,
            amount: true,
            referenceType: true,
            notes: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        // Lo pagado en taller (anticipos/abonos/liquidaciones confirmados).
        repairIds.length
          ? prisma.payment.aggregate({
              where: { businessId, repairOrderId: { in: repairIds }, status: "CONFIRMED" },
              _sum: { amount: true },
            })
          : Promise.resolve({ _sum: { amount: null as number | null } }),
        // Documentos vivos del cliente: apartados y cotizaciones/suspendidas
        // con lo cobrado a cuenta (pagos confirmados) para saber el saldo.
        prisma.sale.findMany({
          where: { businessId, customerId: id, status: { in: [...OPEN_DOCUMENT_STATUSES] } },
          select: {
            id: true,
            number: true,
            kind: true,
            status: true,
            total: true,
            expiresAt: true,
            note: true,
            createdAt: true,
            payments: { where: { status: "CONFIRMED" }, select: { amount: true } },
            _count: { select: { items: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
      ])

    // Largo del folio impreso configurado por el negocio (order_folio_digits).
    const folioDigits = await getOrderFolioDigits(businessId)

    const repairOrders = repairs.map((order) => {
      const totalCents = orderTotalCents(order, order.parts)
      return {
        id: order.id,
        number: order.number,
        folio: repairFolio(order.number, folioDigits),
        status: order.status,
        statusLabel: repairLabels[order.status as RepairStage] ?? order.status,
        equipment: [order.equipmentType, order.brand, order.model].filter(Boolean).join(" "),
        reportedIssue: order.reportedIssue,
        total: totalCents > 0 ? totalCents / 100 : null,
        createdAt: order.createdAt,
      }
    })

    const salesOut = sales.map(({ _count, items, branch, ...sale }) => ({
      ...sale,
      branch: branch.name,
      itemsCount: _count.items,
      itemNames: items.map((it) => `${it.quantity} × ${it.product.name}`),
    }))

    const documentsOut = documents.map(({ payments, _count, ...doc }) => {
      const paid = payments.reduce((sum, p) => sum + p.amount, 0)
      return {
        ...doc,
        itemsCount: _count.items,
        paid,
        balance: Math.max(0, doc.total - paid),
      }
    })

    const stats = {
      totalPurchased: (salesAgg._sum.total ?? 0) - (salesAgg._sum.discountCents ?? 0) / 100 + (repairPaidAgg._sum.amount ?? 0),
      salesCount: salesAgg._count._all,
      lastPurchaseAt: lastSale?.createdAt ?? null,
      pendingReservations,
      openRepairs,
      activeDocuments: documentsOut.length,
    }

    return NextResponse.json(
      {
        customer: user,
        stats,
        sales: salesOut,
        creditMovements,
        reservations,
        repairOrders,
        documents: documentsOut,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("Error fetching cliente 360:", error)
    return NextResponse.json({ error: "Error al obtener el cliente" }, { status: 500 })
  }
}
