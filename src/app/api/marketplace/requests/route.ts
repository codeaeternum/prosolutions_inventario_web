import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireMarketplaceViewer, assertModuleAllowed } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { ALLY_CATALOG_LEVELS } from "@/lib/market-visibility"
import { prisma } from "@/lib/prisma"
import { operationKeySchema } from "@/lib/domain/operations"
import { businessFailure } from "@/lib/domain/http"
import { createMarketplaceRequest, marketplaceRequestInclude } from "@/lib/domain/marketplace"
import { sendNotificationToStaff } from "@/app/api/notifications/stream/route"

const statuses = ["PENDING", "APPROVED", "REJECTED", "FULFILLED"] as const

const createSchema = z.object({
  // Llave de idempotencia: el recibo en BusinessOperation hace que un retry
  // de red devuelva la MISMA solicitud en vez de duplicarla. Opcional para
  // clientes viejos — el dominio además deduplica por (solicitante,
  // producto, PENDING), aquí solo garantizamos que la operación tenga llave.
  idempotencyKey: operationKeySchema.optional(),
  productId: z.string().min(1),
  qty: z.coerce.number().int().min(1, "La cantidad debe ser al menos 1").max(100000),
  // Opcional: para cuentas WORKSHOP el nombre del taller se deriva de su perfil
  // (businessName ?? name) y se ignora lo que venga en el body. En pedidos a
  // OTRO negocio (cross-business) el staff puede omitirlo: se usa el nombre
  // del propio negocio comprador.
  tallerName: z.string().trim().max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(500).optional(),
  // Encargo de cliente que surte este pedido: la solicitud y el encargo →
  // ORDERED confirman en la MISMA operación (antes eran dos llamadas y un
  // fallo a la mitad dejaba estados inconsistentes).
  encargoId: z.string().min(1).nullish(),
  supplierNote: z.string().trim().max(500).optional(),
})

const requestInclude = marketplaceRequestInclude

// GET /api/marketplace/requests?status=&direction=
// Solicitudes de piezas de talleres aliados. PENDING primero, luego recientes.
// Una cuenta WORKSHOP solo ve las solicitudes que ella misma registró.
//
// `direction=out` → "Pedidos que hago": solicitudes que usuarios de ESTE
// negocio hicieron a OTROS negocios (businessId de la solicitud = proveedor).
// Lo pide el staff de /admin/mercado; un WORKSHOP ve solo las que él creó.
export async function GET(req: Request) {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    // WORKSHOP solo ve lo suyo; el staff que opera el mercado necesita el módulo.
    if (session.user.role !== "WORKSHOP") {
      const denied = assertModuleAllowed(session, "mercado")
      if (denied) return denied
    }

    const params = new URL(req.url).searchParams
    const status = params.get("status")
    if (status && !(statuses as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    }
    const outgoing = params.get("direction") === "out"

    const businessId = businessIdOf(session)
    const isWorkshop = session.user.role === "WORKSHOP"

    const requests = await prisma.marketplaceRequest.findMany({
      where: outgoing
        ? {
            // Salientes: las pidió alguien de este negocio a otro negocio.
            businessId: { not: businessId },
            requestedBy: { businessId },
            ...(status ? { status } : {}),
            ...(isWorkshop ? { requestedById: session.user.id } : {}),
          }
        : {
            businessId,
            ...(status ? { status } : {}),
            ...(isWorkshop ? { requestedById: session.user.id } : {}),
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

// POST /api/marketplace/requests  { productId, qty, tallerName?, contactName?, contactPhone?, note?, encargoId?, supplierNote?, idempotencyKey? }
// Staff: registra a mano la solicitud de un taller aliado (tallerName
//   requerido) o hace un PEDIDO A OTRO NEGOCIO — el producto puede ser de
//   cualquier negocio activo que lo publique a aliados/público; la solicitud
//   cae en la bandeja del negocio proveedor y en "Pedidos que hago" del
//   comprador (se identifica por requestedBy.businessId).
// WORKSHOP: el taller pide directamente; tallerName sale de su cuenta
//   (businessName ?? name) y requestedById queda ligado a su usuario.
// Con `encargoId` el dominio además pasa el encargo a ORDERED en la MISMA
//   transacción — la solicitud y el avance del encargo confirman o fallan
//   juntos (flujo "Pedirla" del panel de encargos).
// Idempotente: `idempotencyKey` guarda el recibo (replay = misma respuesta);
//   sin llave, el dominio deduplica por solicitante + producto PENDING.
export async function POST(req: Request) {
  try {
    const auth = await requireMarketplaceViewer()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const actorId = session.user.id
    const businessId = businessIdOf(session)
    const isWorkshop = session.user.role === "WORKSHOP"
    // El taller se autorregistra su solicitud; staff interno requiere el
    // módulo "mercado" — o "inventario", porque pedir la pieza al aliado es
    // parte del flujo de encargo que vive ahí.
    if (!isWorkshop) {
      const denied = assertModuleAllowed(session, "mercado") && assertModuleAllowed(session, "inventario")
      if (denied) return denied
    }
    const parseResult = createSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const first = parseResult.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    const input = parseResult.data
    // Un encargo solo lo toca el mostrador: una cuenta WORKSHOP no opera el
    // panel de encargos (el dominio además lo refuerza con permission staff).
    if (isWorkshop && input.encargoId) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    // Producto ordenable: activo y publicado para aliados (ALLIES o PUBLIC)
    // en un negocio activo — propio o de otro negocio del directorio B2B.
    // El dominio lo revalida dentro de la transacción; aquí solo se usa para
    // derivar tallerName en pedidos cross-business y responder 404 temprano.
    const product = await prisma.product.findFirst({
      where: {
        id: input.productId,
        isActive: true,
        marketVisibility: { in: [...ALLY_CATALOG_LEVELS] },
        business: { isActive: true },
      },
      select: {
        id: true,
        name: true,
        businessId: true,
      },
    })
    if (!product) {
      return NextResponse.json(
        { error: "Producto no disponible en el mercado" },
        { status: 404 }
      )
    }
    const sellerBusinessId = product.businessId
    const crossBusiness = sellerBusinessId !== businessId

    let tallerName = input.tallerName?.trim() ?? ""
    if (isWorkshop) {
      const account = await prisma.user.findUnique({
        where: { id: actorId },
        select: { businessName: true, jobTitle: true, name: true },
      })
      tallerName = account?.businessName?.trim() || account?.jobTitle?.trim() || account?.name || session.user.name || ""
    } else if (crossBusiness && tallerName.length < 2) {
      // Pedido a otro negocio sin taller explícito: el "taller" que pide es
      // el propio negocio comprador.
      const mine = await prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true },
      })
      tallerName = mine?.name?.trim() ?? ""
    }
    if (tallerName.length < 2) {
      return NextResponse.json(
        { error: "Ingresa el nombre del taller" },
        { status: 400 }
      )
    }

    // Si la llave ya tenía recibo, esta llamada es un replay de red: el
    // dominio devolverá la respuesta guardada y el staff no debe recibir un
    // segundo aviso por la MISMA solicitud (la verificación es best-effort
    // —un reintento concurrente puede duplicar el toast, nunca la fila—).
    const alreadyRecorded = input.idempotencyKey
      ? Boolean(await prisma.businessOperation.findUnique({ where: { key: input.idempotencyKey }, select: { id: true } }))
      : false

    const result = await createMarketplaceRequest(prisma, actorId, businessId, {
      ...input,
      encargoId: input.encargoId ?? undefined,
      // Cliente viejo sin llave: una aleatoria satisface operation(); la
      // deduplicación por contenido queda a cargo del dominio.
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      tallerName,
    })

    // Aviso en vivo al staff del PROVEEDOR solo cuando se asentó una
    // solicitud NUEVA — una deduplicada/repetida ya avisó al crearse; un
    // fallo aquí nunca debe tumbar el registro.
    if (!result.deduplicated && !alreadyRecorded) {
      void sendNotificationToStaff({
        type: "marketplace_request",
        title: "Nueva solicitud de refacción",
        message: `${result.request.tallerName} solicita ${result.request.qty}× ${product.name}`,
        data: { requestId: result.request.id },
      }, sellerBusinessId).catch(() => {})
    }

    return NextResponse.json(
      { request: result.request, deduplicated: result.deduplicated, encargo: result.encargo },
      // 200 en dedupe o replay de recibo (recurso existente); 201 en alta real.
      { status: result.deduplicated || alreadyRecorded ? 200 : 201 }
    )
  } catch (error) {
    return businessFailure(error)
  }
}
