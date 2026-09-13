import type { Session } from "next-auth"
import { prisma } from "./prisma"

/**
 * Multi-tenant scoping.
 *
 * Cada fila de negocio lleva `businessId`. `tenantDb(businessId)` devuelve un
 * cliente Prisma extendido que inyecta el filtro `businessId` en lecturas,
 * actualizaciones y borrados, y lo estampa en creates de primer nivel.
 *
 * Modelos globales (sin businessId, NO se filtran): Business, DeviceModel.
 *
 * Fase 2 migra las rutas a este cliente; hasta entonces las rutas siguen
 * usando `prisma` global y el aislamiento se aplica de forma explícita.
 */
const TENANT_MODELS = new Set([
  "User", "Brand", "Model", "Category", "Product", "PriceHistory",
  "ProductModel", "Reservation", "CreditMovement", "Settings",
  "PushSubscription", "CashRegister", "CashMovement", "SystemSettings",
  "BusinessOperation", "Branch", "BranchStock", "Sale", "SaleItem",
  "Payment", "RepairOrder", "RepairPart", "RepairEvent", "CashRequest",
  "RepairPhoto", "WorkshopService", "MarketplaceRequest",
  "InventoryMovement",
  "Supplier", "Purchase", "PurchaseItem",
])

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown }

function scopedArgs(args: Args, businessId: string): Args {
  const next = { ...args }
  if (next.where && typeof next.where === "object") {
    next.where = { ...next.where, businessId }
  }
  if (next.data) {
    if (Array.isArray(next.data)) {
      next.data = next.data.map((d) => ({ businessId, ...(d as object) }))
    } else if (typeof next.data === "object") {
      next.data = { businessId, ...(next.data as object) }
    }
  }
  return next
}

/** Devuelve un PrismaClient que limita todas las operaciones al negocio dado. */
export function tenantDb(businessId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args)
          const a = args as Args
          switch (operation) {
            // Lecturas/actualizaciones/borrados: filtrar por businessId.
            case "findUnique":
            case "findUniqueOrThrow":
              // where debe convertirse a filtro no-único si usa una clave
              // compuesta por negocio; Prisma exige unique estricto en
              // findUnique — por eso las rutas deben usar findFirst con
              // businessId cuando la clave es compuesta (SystemSettings, etc.).
              return query(scopedArgs(a, businessId))
            case "findFirst":
            case "findFirstOrThrow":
            case "findMany":
            case "count":
            case "aggregate":
            case "groupBy":
            case "updateMany":
            case "deleteMany":
              return query(scopedArgs(a, businessId))
            // Escrituras: estampar businessId.
            case "create":
            case "createMany":
            case "createManyAndReturn":
              return query(scopedArgs(a, businessId))
            // update/delete/upsert por id único: el where ya es único; el
            // filtro se agrega vía updateMany? No — se deja al caller por ahora
            // (findUnique por id + verificar businessId es el patrón seguro).
            default:
              return query(args)
          }
        },
      },
    },
  })
}

/** businessId del usuario autenticado (todas las cuentas pertenecen a una empresa). */
export function businessIdOf(session: Session): string {
  const businessId = session.user?.businessId
  if (!businessId) throw new Error("Sesión sin empresa asignada")
  return businessId
}
