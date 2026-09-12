import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { getSession, requireMarketplaceViewer } from "@/lib/api-auth"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { prisma } from "@/lib/prisma"

const purchaseInclude = {
  sale: {
    select: {
      id: true,
      number: true,
      status: true,
      total: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          product: { select: { name: true, barcode: true } },
        },
      },
      payments: {
        select: {
          id: true,
          method: true,
          amount: true,
          status: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.MarketplaceRequestInclude

// GET /api/marketplace/purchases
// Historial de compras surtidas del mercado B2B: solicitudes FULFILLED con su
// venta ligada (folio, partidas a precio mayoreo, pagos). Los montos siempre
// salen del servidor (sale.total / sale.items), nunca del cliente.
// Una cuenta WORKSHOP solo ve sus propias compras y además recibe el saldo a
// crédito de su cuenta (los abonos son globales al cliente, no por venta).
// Staff (ADMIN/EMPLOYEE) ve las compras de todos los talleres.
export async function GET() {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const isWorkshop = session.user.role === "WORKSHOP"

    const requests = await prisma.marketplaceRequest.findMany({
      where: {
        status: "FULFILLED",
        saleId: { not: null },
        ...(isWorkshop ? { requestedById: session.user.id } : {}),
      },
      orderBy: { decidedAt: "desc" },
      take: 200,
      include: purchaseInclude,
    })

    // saleId usa onDelete: SetNull; si la venta ya no existe el request queda
    // FULFILLED pero sin documento — no se muestra como compra.
    const purchases = requests
      .filter((r) => r.sale !== null)
      .map((r) => ({
        id: r.id,
        tallerName: r.tallerName,
        requestedAt: r.createdAt,
        fulfilledAt: r.decidedAt,
        sale: r.sale,
      }))

    let credit: { balance: number; limit: number | null } | null = null
    if (isWorkshop) {
      const account = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { creditBalance: true, creditLimit: true },
      })
      credit = {
        balance: account?.creditBalance ?? 0,
        limit: account?.creditLimit ?? null,
      }
    }

    return NextResponse.json({ purchases, credit }, { headers: catalogResponseHeaders })
  } catch (error) {
    console.error("Error fetching marketplace purchases:", error)
    return NextResponse.json({ error: "Error al obtener las compras" }, { status: 500 })
  }
}
