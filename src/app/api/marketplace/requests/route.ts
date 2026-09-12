import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { getSession, requireAdmin, requireAdminOrEmployee } from "@/lib/api-auth"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { prisma } from "@/lib/prisma"

const statuses = ["PENDING", "APPROVED", "REJECTED", "FULFILLED"] as const

const createSchema = z.object({
  productId: z.string().min(1),
  qty: z.coerce.number().int().min(1, "La cantidad debe ser al menos 1").max(100000),
  tallerName: z.string().trim().min(2, "Ingresa el nombre del taller").max(120),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(500).optional(),
})

const decideSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["APPROVE", "REJECT", "FULFILL"]),
  decisionNote: z.string().trim().max(500).optional(),
})

const requestInclude = {
  product: {
    select: { name: true, barcode: true, wholesalePrice: true, retailPrice: true },
  },
  requestedBy: { select: { name: true } },
  decidedBy: { select: { name: true } },
} satisfies Prisma.MarketplaceRequestInclude

// GET /api/marketplace/requests?status=
// Solicitudes de piezas de talleres aliados. PENDING primero, luego recientes.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error

    const status = new URL(req.url).searchParams.get("status")
    if (status && !(statuses as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    }

    const requests = await prisma.marketplaceRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: requestInclude,
    })

    // Pendientes primero; dentro de cada grupo conserva el orden por fecha desc.
    requests.sort((a, b) => {
      const aPending = a.status === "PENDING" ? 0 : 1
      const bPending = b.status === "PENDING" ? 0 : 1
      return aPending - bPending
    })

    return NextResponse.json({ requests }, { headers: catalogResponseHeaders })
  } catch (error) {
    console.error("Error fetching marketplace requests:", error)
    return NextResponse.json({ error: "Error al obtener las solicitudes" }, { status: 500 })
  }
}

// POST /api/marketplace/requests  { productId, qty, tallerName, contactName?, contactPhone?, note? }
// Un usuario interno registra la solicitud de un taller aliado sobre una pieza del catálogo.
export async function POST(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id

    const parseResult = createSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const first = parseResult.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    const input = parseResult.data

    const product = await prisma.product.findFirst({
      where: { id: input.productId, isActive: true, marketplaceVisible: true },
      select: { id: true },
    })
    if (!product) {
      return NextResponse.json(
        { error: "Producto no disponible en el mercado" },
        { status: 404 }
      )
    }

    const request = await prisma.marketplaceRequest.create({
      data: {
        productId: product.id,
        qty: input.qty,
        tallerName: input.tallerName,
        contactName: input.contactName || null,
        contactPhone: input.contactPhone || null,
        note: input.note || null,
        requestedById: actorId,
      },
      include: requestInclude,
    })

    return NextResponse.json({ request }, { status: 201 })
  } catch (error) {
    console.error("Error creating marketplace request:", error)
    return NextResponse.json({ error: "Error al registrar la solicitud" }, { status: 500 })
  }
}

// PATCH /api/marketplace/requests  { id, action: "APPROVE"|"REJECT"|"FULFILL", decisionNote? }
// Solo ADMIN. La aprobación es un acuerdo comercial: NO descuenta inventario ni
// genera venta. El surtido (entrega física, salida de stock y cobro al taller)
// es un paso manual posterior — por eso existe el estado FULFILLED aparte.
export async function PATCH(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    const actorId = getSession(auth)!.user.id

    const parseResult = decideSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }
    const { id, action, decisionNote } = parseResult.data

    const existing = await prisma.marketplaceRequest.findUnique({
      where: { id },
      select: { id: true, status: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 })
    }

    // Transiciones válidas: PENDING -> APPROVED/REJECTED, APPROVED -> FULFILLED.
    const nextStatus =
      action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "FULFILLED"
    const expectedCurrent = action === "FULFILL" ? "APPROVED" : "PENDING"

    const updated = await prisma.marketplaceRequest.updateMany({
      where: { id, status: expectedCurrent },
      data: {
        status: nextStatus,
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: decisionNote || null,
      },
    })
    if (updated.count !== 1) {
      return NextResponse.json(
        {
          error:
            action === "FULFILL"
              ? "Solo puedes marcar como surtida una solicitud aprobada."
              : "La solicitud ya fue decidida.",
        },
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
