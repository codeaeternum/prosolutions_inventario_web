import type { PrismaClient, Prisma } from "@prisma/client"
import { z } from "zod"
import { BusinessError, operation, operationKeySchema } from "./operations"
import { transitionEncargoTx } from "./encargos"
import { ALLY_CATALOG_LEVELS } from "../market-visibility"

/**
 * Solicitudes del mercado B2B (MarketplaceRequest): un taller aliado o el
 * staff del negocio pide una pieza al catálogo de otro negocio (o al propio
 * — el staff también registra solicitudes de talleres a mano).
 *
 * Frontera de tenant:
 * - La FILA vive en el tenant del PROVEEDOR (businessId = dueño del
 *   producto): él la ve en Solicitudes y la decide. El lado comprador la
 *   recupera con direction=out.
 * - El RECIBO idempotente (BusinessOperation) queda en el tenant del
 *   COMPRADOR, que es quien ejecuta la acción — igual que una venta: el
 *   recibo protege los reintentos del cliente que la originó.
 *
 * Doble guardia contra duplicados:
 * 1. `idempotencyKey` → recibo en BusinessOperation; el replay devuelve la
 *    respuesta guardada sin re-ejecutar.
 * 2. Dedupe de BD para clientes viejos sin llave: si ya existe una solicitud
 *    PENDING del mismo solicitante sobre el mismo producto, se devuelve esa
 *    (deduplicated: true) en vez de abrir otra — un doble clic no clona el
 *    pedido en la bandeja del proveedor. Con `encargoId` la deduplicación
 *    correcta es la propia liga encargo → solicitud: un encargo ya pedido
 *    responde con su solicitud ligada, sea cual sea su estado, y cada
 *    encargo distinto pide su propia pieza (dos clientes que encargan la
 *    misma refacción NO se fusionan en una sola solicitud).
 */

export const marketplaceRequestInclude = {
  product: {
    select: { name: true, barcode: true, wholesalePrice: true, retailPrice: true },
  },
  // Negocio proveedor (dueño del producto): alimenta "Pedidos que hago".
  business: { select: { id: true, name: true, slug: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  decidedBy: { select: { name: true } },
  sale: { select: { id: true, number: true } },
} satisfies Prisma.MarketplaceRequestInclude

const createSchema = z.object({
  idempotencyKey: operationKeySchema,
  productId: z.string().min(1),
  qty: z.number().int().min(1).max(100000),
  // Nombre visible del taller que pide; la ruta lo deriva del perfil
  // (WORKSHOP) o del negocio comprador (pedido cross-business sin taller).
  tallerName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(500).optional(),
  // Encargo de cliente que esta solicitud surte: en la MISMA operación se
  // crea la solicitud y el encargo pasa a ORDERED ligando el requestId —
  // antes eran dos llamadas HTTP y un fallo a mitad dejaba la solicitud
  // creada pero el encargo pendiente (o viceversa).
  encargoId: z.string().min(1).optional(),
  supplierNote: z.string().trim().max(500).optional(),
})
export type CreateMarketplaceRequestInput = z.infer<typeof createSchema>

/**
 * Registra una solicitud de pieza al mercado. Idempotente vía operation();
 * cuando viene `encargoId` la transición del encargo (ORDERED +
 * marketplaceRequestId) corre en la MISMA transacción serializable.
 *
 * `businessId` es el tenant del COMPRADOR (el del actor); la solicitud se
 * crea con el tenant del proveedor sacado del producto.
 */
export async function createMarketplaceRequest(db: PrismaClient, actorId: string, businessId: string, raw: unknown) {
  const input = createSchema.parse(raw)
  return operation(db, {
    key: input.idempotencyKey,
    actorId,
    businessId,
    kind: "MARKETPLACE_REQUEST",
    // Tocar un encargo es trabajo de mostrador; la solicitud suelta también
    // la registra una cuenta WORKSHOP (permission customer = solo APPROVED).
    permission: input.encargoId ? "staff" : "customer",
    payload: input,
  }, async tx => {
    // Producto ordenable: activo y publicado para aliados (ALLIES o PUBLIC)
    // en un negocio activo — propio o de otro negocio del directorio B2B.
    // Se relee dentro del tx: la decisión y la escritura ven el mismo
    // snapshot serializable.
    const product = await tx.product.findFirst({
      where: {
        id: input.productId,
        isActive: true,
        marketVisibility: { in: [...ALLY_CATALOG_LEVELS] },
        business: { isActive: true },
      },
      select: { id: true, name: true, businessId: true },
    })
    if (!product) throw new BusinessError("Producto no disponible en el mercado", 404)

    // Con encargo: la deduplicación fuerte es la liga misma. Si el encargo
    // ya quedó pedido con una solicitud, ESA es la respuesta — reintentar el
    // "Pedirla" no abre otra solicitud al aliado ni reordena el encargo.
    if (input.encargoId) {
      const encargo = await tx.encargo.findFirst({
        where: { id: input.encargoId, businessId },
        select: { id: true, status: true, marketplaceRequestId: true },
      })
      if (!encargo) throw new BusinessError("Encargo no encontrado.", 404)
      if (encargo.marketplaceRequestId) {
        const linked = await tx.marketplaceRequest.findUnique({
          where: { id: encargo.marketplaceRequestId },
          include: marketplaceRequestInclude,
        })
        if (linked) {
          return {
            request: linked,
            deduplicated: true,
            encargo: { encargoId: encargo.id, status: encargo.status, marketplaceRequestId: linked.id },
          }
        }
      }
    }

    // Dedupe para clientes sin llave idempotente (flujos sueltos sin
    // encargo): la misma pieza PENDING del mismo solicitante ya está en la
    // bandeja del proveedor — devolverla en vez de abrir una segunda
    // (consistente con el recibo: un replay devuelve la misma respuesta,
    // no un error). No aplica al flujo con encargoId: ahí cada encargo lleva
    // su propia solicitud y la deduplicación correcta ya se hizo por la liga.
    const duplicated = input.encargoId
      ? null
      : await tx.marketplaceRequest.findFirst({
          where: { requestedById: actorId, productId: product.id, status: "PENDING" },
          orderBy: { createdAt: "desc" },
          include: marketplaceRequestInclude,
        })

    const request = duplicated ?? await tx.marketplaceRequest.create({
      data: {
        businessId: product.businessId,
        productId: product.id,
        qty: input.qty,
        tallerName: input.tallerName,
        contactName: input.contactName || null,
        contactPhone: input.contactPhone || null,
        note: input.note || null,
        requestedById: actorId,
      },
      include: marketplaceRequestInclude,
    })

    // El encargo pasa a ORDERED en la misma tx ligando la solicitud (la que
    // ya existía deduplicada o la recién creada). transitionEncargoTx valida
    // tenant + salto permitido y escribe el rastro en la bitácora; si el
    // encargo no admite ORDERED todo se revierte — solicitud incluida.
    let encargo = null
    if (input.encargoId) {
      encargo = await transitionEncargoTx(tx, {
        actorId,
        businessId,
        id: input.encargoId,
        action: "ORDERED",
        marketplaceRequestId: request.id,
        supplierNote: input.supplierNote,
      })
    }

    return { request, deduplicated: Boolean(duplicated), encargo }
  })
}
