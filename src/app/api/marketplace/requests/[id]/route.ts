import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule, assertOperationBranch } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { sell } from "@/lib/domain/sales"
import { businessFailure } from "@/lib/domain/http"
import { marketplaceRequestInclude } from "@/lib/domain/marketplace"

const NO_STORE = { "Cache-Control": "private, no-store" } as const

const decideSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "FULFILL"]),
  decisionNote: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "CREDITO"]).optional(),
  reference: z.string().trim().max(200).optional(), // folio SPEI/autorización; obligatorio en TRANSFERENCIA
  branchId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
})

const requestInclude = marketplaceRequestInclude

// PATCH /api/marketplace/requests/:id
// { action: "APPROVE"|"REJECT"|"FULFILL", decisionNote?, paymentMethod?, branchId?, customerId? }
// Módulo mercado + rol ADMIN: aprobar, rechazar o surtir es decidir la venta
// (a crédito incluido) con un aliado — misma clase de decisión que un pago a
// proveedor, por eso un EMPLOYEE con el módulo no basta (la UI ya ocultaba
// los botones; ahora la API coincide).
// La aprobación es un acuerdo comercial: NO descuenta inventario.
// FULFILL sí genera la venta (sell) a precio de taller — con idempotencyKey
// derivado de la solicitud, reintentar nunca duplica la venta — y luego marca
// la solicitud como FULFILLED ligada a esa venta (saleId).
// Recuperaciones: REJECT también libera una APPROVED sin venta (una aprobada
// sin stock/precio ya no queda wedge) y APPROVE sobre una FULFILLED cuya
// venta quedó VOIDED la devuelve a APPROVED para surtirla de nuevo.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireModule("mercado")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    // Solo ADMIN decide solicitudes: requireModule es el gate base y este
    // corte temprano evita abrir la venta para un empleado (mismo patrón que
    // el POST de /api/supplier-payments).
    if (session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede aprobar, rechazar o surtir solicitudes." },
        { status: 403, headers: NO_STORE }
      )
    }
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const { id } = await params

    const parseResult = decideSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400, headers: NO_STORE })
    }
    const { action, decisionNote, paymentMethod, reference, branchId, customerId } = parseResult.data

    const existing = await prisma.marketplaceRequest.findUnique({
      where: { id },
      include: {
        product: { select: { wholesalePrice: true } },
        requestedBy: { select: { id: true, role: true, businessId: true } },
        sale: { select: { id: true, number: true, status: true } },
      },
    })
    if (!existing || existing.businessId !== businessId) {
      return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404, headers: NO_STORE })
    }

    // ---- FULFILL: APPROVED -> FULFILLED generando la venta al taller ----
    if (action === "FULFILL") {
      // Reintento idempotente: ya quedó surtida con una venta vigente —
      // repetir la llamada devuelve el mismo resultado, no un 409.
      if (existing.status === "FULFILLED" && existing.sale && existing.sale.status !== "VOIDED") {
        const request = await prisma.marketplaceRequest.findUniqueOrThrow({
          where: { id },
          include: requestInclude,
        })
        return NextResponse.json(
          { request, saleNumber: existing.sale.number, idempotent: true },
          { headers: NO_STORE }
        )
      }
      if (existing.status !== "APPROVED") {
        return NextResponse.json(
          {
            error: existing.status === "FULFILLED"
              ? "La venta ligada fue anulada: vuelve a aprobar la solicitud para surtirla de nuevo."
              : "Solo puedes marcar como surtida una solicitud aprobada.",
          },
          { status: 409, headers: NO_STORE }
        )
      }
      // El surtido cobra la lista de taller: sin wholesalePrice el sell()
      // falla con un error genérico de importe — mejor frenar aquí.
      if (!(existing.product.wholesalePrice > 0)) {
        return NextResponse.json(
          { error: "El producto no tiene precio de taller; captúralo en el catálogo antes de surtir." },
          { status: 400, headers: NO_STORE }
        )
      }
      if (!paymentMethod) {
        return NextResponse.json(
          { error: "Selecciona el método de pago del surtido." },
          { status: 400, headers: NO_STORE }
        )
      }
      if (paymentMethod === "TRANSFERENCIA" && !reference) {
        return NextResponse.json(
          { error: "La transferencia requiere su folio SPEI o clave de rastreo." },
          { status: 400, headers: NO_STORE }
        )
      }
      // A crédito se cobra a la cuenta WORKSHOP del taller: la que venga en
      // el body o, si la pidió un taller aliado logueado DE ESTE negocio, la
      // de ese usuario. Un WORKSHOP de OTRO tenant no puede ser cliente de
      // la venta (actor() lo rechaza y la solicitud quedaba wedge en
      // APPROVED para siempre): la venta se carga a una cuenta local que el
      // proveedor elige explícitamente.
      const requesterIsLocalWorkshop =
        existing.requestedBy?.role === "WORKSHOP" && existing.requestedBy.businessId === businessId
      const requesterIsForeignWorkshop =
        existing.requestedBy?.role === "WORKSHOP" && existing.requestedBy.businessId !== businessId
      const saleCustomerId = customerId ?? (requesterIsLocalWorkshop ? existing.requestedBy!.id : undefined)
      if (requesterIsForeignWorkshop && !saleCustomerId) {
        return NextResponse.json(
          { error: "La cuenta del taller que pidió no existe en tu negocio; elige a qué cuenta local cargar la venta." },
          { status: 400, headers: NO_STORE }
        )
      }
      if (paymentMethod === "CREDITO" && !saleCustomerId) {
        return NextResponse.json(
          { error: "El cobro a crédito requiere una cuenta de taller de tu negocio." },
          { status: 400, headers: NO_STORE }
        )
      }

      // La venta del surtido sale de la sucursal indicada o la base del staff.
      const deniedBranch = await assertOperationBranch(session, branchId)
      if (deniedBranch) return deniedBranch

      let result: Awaited<ReturnType<typeof sell>>
      try {
        result = await sell(prisma, actorId, businessId, {
          idempotencyKey: `mkt-fulfill-${existing.id}`,
          items: [{ productId: existing.productId, quantity: existing.qty }],
          payments: [{ method: paymentMethod, ...(reference ? { reference } : {}) }],
          customerId: saleCustomerId,
          branchId: branchId ?? undefined,
          priceTier: "wholesale",
          // Documento "nota de venta a taller": el surtido del mercado B2B
          // siempre es venta a taller aunque el comprador sea walk-in.
          workshopSale: true,
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
        // Carrera: si quedó FULFILLED ligada a ESTA misma venta (mismo
        // idempotencyKey → misma venta), el surtido ya se confirmó — el
        // reintento reporta éxito en vez de un 409 fantasma.
        const current = await prisma.marketplaceRequest.findUnique({
          where: { id },
          select: { status: true, saleId: true },
        })
        if (current?.status === "FULFILLED" && current.saleId === result.sale.id) {
          const request = await prisma.marketplaceRequest.findUniqueOrThrow({
            where: { id },
            include: requestInclude,
          })
          return NextResponse.json(
            { request, saleNumber: result.sale.number, idempotent: true },
            { headers: NO_STORE }
          )
        }
        return NextResponse.json(
          { error: "La solicitud ya fue decidida." },
          { status: 409, headers: NO_STORE }
        )
      }

      const request = await prisma.marketplaceRequest.findUniqueOrThrow({
        where: { id },
        include: requestInclude,
      })
      return NextResponse.json({ request, saleNumber: result.sale.number }, { headers: NO_STORE })
    }

    // ---- APPROVE: PENDING -> APPROVED; además rescata una FULFILLED cuya
    // venta quedó VOIDED (venta anulada en POS): vuelve a APPROVED sin la
    // venta muerta para poder surtirla de nuevo con una venta nueva. ----
    if (action === "APPROVE") {
      const updated = await prisma.marketplaceRequest.updateMany({
        where: {
          id,
          businessId,
          OR: [
            { status: "PENDING" },
            { status: "FULFILLED", sale: { is: { status: "VOIDED" } } },
          ],
        },
        data: {
          status: "APPROVED",
          saleId: null,
          decidedById: actorId,
          decidedAt: new Date(),
          decisionNote: decisionNote || null,
        },
      })
      if (updated.count !== 1) {
        return NextResponse.json(
          { error: "Solo se puede aprobar una solicitud pendiente (o reactivar una surtida cuya venta fue anulada)." },
          { status: 409, headers: NO_STORE }
        )
      }
    } else {
      // ---- REJECT: PENDING -> REJECTED; también desde APPROVED mientras no
      // haya venta ligada — una aprobada que ya no se puede surtir no queda
      // wedge para siempre.
      const updated = await prisma.marketplaceRequest.updateMany({
        where: { id, businessId, saleId: null, status: { in: ["PENDING", "APPROVED"] } },
        data: {
          status: "REJECTED",
          decidedById: actorId,
          decidedAt: new Date(),
          decisionNote: decisionNote || null,
        },
      })
      if (updated.count !== 1) {
        return NextResponse.json(
          { error: "La solicitud ya fue decidida." },
          { status: 409, headers: NO_STORE }
        )
      }
    }

    const request = await prisma.marketplaceRequest.findUniqueOrThrow({
      where: { id },
      include: requestInclude,
    })
    return NextResponse.json({ request }, { headers: NO_STORE })
  } catch (error) {
    console.error("Error deciding marketplace request:", error)
    return NextResponse.json({ error: "Error al actualizar la solicitud" }, { status: 500, headers: NO_STORE })
  }
}
