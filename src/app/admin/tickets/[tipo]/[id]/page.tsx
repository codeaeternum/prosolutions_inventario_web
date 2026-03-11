import { redirect } from "next/navigation"
import { requireAdmin } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { formatPrice, formatDate } from "@/lib/utils"
import { TicketPrintView } from "./ticket-print-view"

export const dynamic = "force-dynamic"

export default async function TicketPage({
  params,
}: {
  params: Promise<{ tipo: string; id: string }>
}) {
  const adminCheck = await requireAdmin()
  if (adminCheck.error) redirect("/login")

  const { tipo, id } = await params
  
  let ticketData = null

  if (tipo === "venta") {
    // Buscar venta (InventoryMovement tipo SALE)
    const sale = await prisma.inventoryMovement.findUnique({
      where: { id },
      include: {
        product: true,
        user: true, // admin que la hizo
      }
    })
    
    if (sale) {
      ticketData = {
        title: "TICKET DE VENTA",
        folio: sale.id.slice(-8).toUpperCase(),
        date: sale.createdAt.toISOString(),
        items: [
          {
            name: sale.product.name,
            qty: Math.abs(sale.quantity),
            price: sale.unitPrice || 0,
            total: Math.abs(sale.quantity) * (sale.unitPrice || 0)
          }
        ],
        total: Math.abs(sale.quantity) * (sale.unitPrice || 0),
        notes: sale.notes || "Venta en tienda",
        cashier: sale.user?.name || "Sistema"
      }
    }
  } else if (tipo === "reserva") {
    // Buscar reserva completada
    const res = await prisma.reservation.findUnique({
      where: { id },
      include: {
        product: true,
        user: true
      }
    })

    if (res) {
      ticketData = {
        title: "TICKET DE RESERVA / ENTREGA",
        folio: res.id.slice(-8).toUpperCase(),
        date: res.createdAt.toISOString(),
        client: res.user.name,
        items: [
          {
            name: res.product.name,
            qty: res.quantity,
            price: res.totalPrice / res.quantity,
            total: res.totalPrice
          }
        ],
        total: res.totalPrice,
        paymentMethod: res.paymentMethod || "Efectivo",
        notes: `QR: ${res.qrCode}`,
      }
    }
  } else if (tipo === "abono") {
    // Buscar movimiento de crédito
    const mov = await prisma.creditMovement.findUnique({
      where: { id },
      include: { user: true }
    })

    if (mov) {
      ticketData = {
        title: "COMPROBANTE DE ABONO",
        folio: mov.id.slice(-8).toUpperCase(),
        date: mov.createdAt.toISOString(),
        client: mov.user.name,
        items: [
          {
            name: "Abono a cuenta de crédito",
            qty: 1,
            price: mov.amount,
            total: mov.amount
          }
        ],
        total: mov.amount,
        notes: mov.notes || "",
        newBalance: mov.user.creditBalance || 0
      }
    }
  }

  if (!ticketData) {
    return <div className="p-8 text-center text-red-500">Ticket no encontrado</div>
  }

  return <TicketPrintView data={ticketData} />
}
