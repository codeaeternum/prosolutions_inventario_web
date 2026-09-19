import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const { id } = await params
    const sale = await prisma.sale.findUnique({
      where: { id, businessId: businessIdOf(getSession(auth)!) },
      include: {
        branch: { select: { id: true, name: true } },
        seller: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true, businessName: true, customerType: true } },
        items: { include: { product: { select: { id: true, name: true, barcode: true } } } },
        payments: { orderBy: { createdAt: "asc" } },
      },
    })
    if (!sale) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 })
    return NextResponse.json({ sale }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return businessFailure(error) }
}
