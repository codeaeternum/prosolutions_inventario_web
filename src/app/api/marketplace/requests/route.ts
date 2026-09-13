import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { getSession, requireMarketplaceViewer } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { prisma } from "@/lib/prisma"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"

const statuses = ["PENDING", "APPROVED", "REJECTED", "FULFILLED"] as const

const createSchema = z.object({
  productId: z.string().min(1),
  qty: z.coerce.number().int().min(1, "La cantidad debe ser al menos 1").max(100000),
  // Opcional: para cuentas WORKSHOP el nombre del taller se deriva de su perfil
  // (businessName ?? name) y se ignora lo que venga en el body.
  tallerName: z.string().trim().max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(500).optional(),
})

const requestInclude = {
  product: {
    select: { name: true, barcode: true, wholesalePrice: true, retailPrice: true },
  },
  requestedBy: { select: { id: true, name: true, role: true } },
  decidedBy: { select: { name: true } },
  sale: { select: { id: true, number: true } },
} satisfies Prisma.MarketplaceRequestInclude

// GET /api/marketplace/requests?status=
// Solicitudes de piezas de talleres aliados. PENDING primero, luego recientes.
// Una cuenta WORKSHOP solo ve las solicitudes que ella misma registró.
export async function GET(req: Request) {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!

    const status = new URL(req.url).searchParams.get("status")
    if (status && !(statuses as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    }

    const requests = await prisma.marketplaceRequest.findMany({
      where: {
        businessId: businessIdOf(session),
        ...(status ? { status } : {}),
        ...(session.user.role === "WORKSHOP" ? { requestedById: session.user.id } : {}),
      },
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

// POST /api/marketplace/requests  { productId, qty, tallerName?, contactName?, contactPhone?, note? }
// Staff: registra a mano la solicitud de un taller aliado (tallerName requerido).
// WORKSHOP: el taller pide directamente; tallerName sale de su cuenta
// (businessName ?? name) y requestedById queda ligado a su usuario.
export async function POST(req: Request) {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const isWorkshop = session.user.role === "WORKSHOP"

    const parseResult = createSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const first = parseResult.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    const input = parseResult.data

    let tallerName = input.tallerName?.trim() ?? ""
    if (isWorkshop) {
      const account = await prisma.user.findUnique({
        where: { id: actorId },
        select: { businessName: true, jobTitle: true, name: true },
      })
      tallerName = account?.businessName?.trim() || account?.jobTitle?.trim() || account?.name || session.user.name || ""
    }
    if (tallerName.length < 2) {
      return NextResponse.json(
        { error: "Ingresa el nombre del taller" },
        { status: 400 }
      )
    }

    const product = await prisma.product.findFirst({
      where: { id: input.productId, businessId, isActive: true, marketplaceVisible: true },
      select: { id: true, name: true },
    })
    if (!product) {
      return NextResponse.json(
        { error: "Producto no disponible en el mercado" },
        { status: 404 }
      )
    }

    const request = await prisma.marketplaceRequest.create({
      data: {
        businessId,
        productId: product.id,
        qty: input.qty,
        tallerName,
        contactName: input.contactName || null,
        contactPhone: input.contactPhone || null,
        note: input.note || null,
        requestedById: actorId,
      },
      include: requestInclude,
    })

    // Aviso en vivo al staff conectado; un fallo aquí no debe tumbar el registro.
    void sendNotificationToStaff({
      type: "marketplace_request",
      title: "Nueva solicitud de refacción",
      message: `${request.tallerName} solicita ${request.qty}× ${product.name}`,
      data: { requestId: request.id },
    }).catch(() => {})

    return NextResponse.json({ request }, { status: 201 })
  } catch (error) {
    console.error("Error creating marketplace request:", error)
    return NextResponse.json({ error: "Error al registrar la solicitud" }, { status: 500 })
  }
}
