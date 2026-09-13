import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { sell } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"

const decideSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "FULFILL"]),
  decisionNote: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"]).optional(),
  branchId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
})

const requestInclude = {
  product: {
    select: { name: true, barcode: true, wholesalePrice: true, retailPrice: true },
  },
  requestedBy: { select: { id: true, name: true, role: true } },
  decidedBy: { select: { name: true } },
  sale: { select: { id: true, number: true } },
} satisfies Prisma.MarketplaceRequestInclude

// PATCH /api/marketplace/requests/:id
// { action: "APPROVE"|"REJECT"|"FULFILL", decisionNote?, paymentMethod?, branchId?, customerId? }
// Solo ADMIN. La aprobación es un acuerdo comercial: NO descuenta inventario.
// FULFILL sí genera la venta (sell) a precio de mayoreo — con idempotencyKey
// derivado de la solicitud, reintentar nunca duplica la venta — y luego marca
// la solicitud como FULFILLED ligada a esa venta (saleId).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params

    const parseResult = decideSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }
    const { action, decisionNote, paymentMethod, branchId, customerId } = parseResult.data

    const existing = await prisma.marketplaceRequest.findUnique({
      where: { id },
      include: { requestedBy: { select: { id: true, role: true } } },
    })
    if (!existing || existing.businessId !== businessId) {
      return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 })
    }

    // ---- FULFILL: APPROVED -> FULFILLED generando la venta al taller ----
    if (action === "FULFILL") {
      if (existing.status !== "APPROVED") {
        return NextResponse.json(
          { error: "Solo puedes marcar como surtida una solicitud aprobada." },
          { status: 409 }
        )
      }
      if (!paymentMethod) {
        return NextResponse.json(
          { error: "Selecciona el método de pago del surtido." },
          { status: 400 }
        )
      }
      // A crédito se cobra a la cuenta WORKSHOP del taller: la que venga en el
      // body o, si la pidió un taller aliado logueado, la de ese usuario.
      const saleCustomerId =
        customerId ??
        (existing.requestedBy?.role === "WORKSHOP" ? existing.requestedBy.id : undefined)
      if (paymentMethod === "CREDITO" && !saleCustomerId) {
        return NextResponse.json(
          { error: "El cobro a crédito requiere la cuenta del taller." },
          { status: 400 }
        )
      }

      let result: Awaited<ReturnType<typeof sell>>
      try {
        result = await sell(prisma, actorId, businessId, {
          idempotencyKey: `mkt-fulfill-${existing.id}`,
          items: [{ productId: existing.productId, quantity: existing.qty }],
          paymentMethod,
          customerId: saleCustomerId,
          branchId: branchId ?? undefined,
          priceTier: "wholesale",
        })
      } catch (error) {
        return businessFailure(error)
      }

      // Guard de estado: si otro admin la decidió en paralelo, la venta ya
      // existía por idempotencia pero la solicitud no se toca dos veces.
      const updated = await prisma.marketplaceRequest.updateMany({
        where: { id, businessId, status: "APPROVED" },
        data: {
          status: "FULFILLED",
          decidedById: actorId,
          decidedAt: new Date(),
          decisionNote: decisionNote || null,
          saleId: result.sale.id,
        },
      })
      if (updated.count !== 1) {
        return NextResponse.json(
          { error: "La solicitud ya fue decidida." },
          { status: 409 }
        )
      }

      const request = await prisma.marketplaceRequest.findUniqueOrThrow({
        where: { id },
        include: requestInclude,
      })
      return NextResponse.json({ request, saleNumber: result.sale.number })
    }

    // ---- APPROVE / REJECT: PENDING -> APPROVED / REJECTED ----
    const updated = await prisma.marketplaceRequest.updateMany({
      where: { id, businessId, status: "PENDING" },
      data: {
        status: action === "APPROVE" ? "APPROVED" : "REJECTED",
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: decisionNote || null,
      },
    })
    if (updated.count !== 1) {
      return NextResponse.json(
        { error: "La solicitud ya fue decidida." },
        { status: 409 }
      )
    }

    const request = await prisma.marketplaceRequest.findUniqueOrThrow({
      where: { id },
      include: requestInclude,
    })
    return NextResponse.json({ request })
  } catch (error) {
    console.error("Error deciding marketplace request:", error)
    return NextResponse.json({ error: "Error al actualizar la solicitud" }, { status: 500 })
  }
}
