import { notFound, redirect } from "next/navigation"
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
  
  let ticketData: {
    title: string; folio: string; date: string; client?: string; cashier?: string;
    items: { name: string; qty: number; price: number; total: number }[];
    total: number; paymentMethod?: string; notes?: string; newBalance?: number;
    qrCode?: string; businessName?: string; subtitle?: string; footer?: string;
  } | null = null

  if (tipo === "venta") {
    // Documento de venta nuevo (Sale con líneas y pagos); fallback al movimiento heredado.
    const saleDoc = await prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        payments: { orderBy: { createdAt: "asc" } },
        seller: true,
        customer: true,
        branch: true,
      }
    })

    if (saleDoc) {
      const METHOD_LABEL: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia", CREDIT: "Crédito" }
      ticketData = {
        title: saleDoc.status === "VOIDED" ? "VENTA ANULADA" : "TICKET DE VENTA",
        folio: `V-${String(saleDoc.number).padStart(6, "0")}`,
        date: saleDoc.createdAt.toISOString(),
        client: saleDoc.customer?.name,
        items: saleDoc.items.map(item => ({
          name: item.product.name,
          qty: item.quantity,
          price: item.unitPrice,
          total: item.totalPrice,
        })),
        total: saleDoc.total,
        paymentMethod: saleDoc.payments.filter(p => p.amount > 0).map(p => `${METHOD_LABEL[p.method] ?? p.method} ${formatPrice(p.amount)}`).join("\n"),
        notes: saleDoc.branch.name,
        cashier: saleDoc.seller.name,
      }
    } else {
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
      const qrUrl = `${process.env.NEXTAUTH_URL || 'https://prosolutions.ascnex.com'}/verificar/${res.qrCode || res.id}`
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
        qrCode: qrUrl,
      }
    }
  } else if (tipo === "abono") {
    // Buscar movimiento de crédito
    const mov = await prisma.creditMovement.findUnique({
      where: { id },
      include: { user: true }
    })

    if (!mov || mov.type !== "PAYMENT") notFound()
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

  // Load ticket customization settings
  const [ticketBusinessName, ticketSubtitle, ticketFooter] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { key: "ticket_business_name" } }),
    prisma.systemSettings.findUnique({ where: { key: "ticket_subtitle" } }),
    prisma.systemSettings.findUnique({ where: { key: "ticket_footer" } }),
  ])

  ticketData.businessName = ticketBusinessName?.value || "PROSOLUTIONS"
  ticketData.subtitle = ticketSubtitle?.value || "Venta de refacciones y\nReparación profesional"
  ticketData.footer = ticketFooter?.value || "¡Gracias por tu preferencia!"

  return <TicketPrintView data={ticketData} />
}
