import type { Prisma } from "@prisma/client"
import { catalogVisibilityLevels } from "../../lib/product-dto"
import type { MarketVisibility } from "../../lib/market-visibility"

/**
 * Visibilidad del catálogo en el bot — réplica EXACTA de la matriz que la web
 * aplica en `catalogVisibilityLevels` (src/lib/product-dto.ts), porque el bot
 * navega el mismo catálogo por texto/categorías/ofertas:
 *
 *   viewer                                          → niveles que puede listar
 *   anónimo (sin cuenta) / PENDING / REJECTED       → ["PUBLIC"]
 *   APPROVED + WORKSHOP                             → ["ALLIES", "PUBLIC"]
 *   APPROVED + CUSTOMER type STORE | TECHNICIAN     → ["ALLIES", "PUBLIC"]
 *   APPROVED + CUSTOMER type NORMAL                 → null (catálogo completo)
 *   APPROVED + ADMIN | EMPLOYEE (staff)             → null (catálogo completo,
 *                                                     incluye HIDDEN — igual
 *                                                     que el POS de mostrador)
 *
 * Antes de este módulo NINGUNA consulta del bot filtraba `marketVisibility`:
 * un anónimo de Telegram veía nombre/precio/stock de piezas HIDDEN — la misma
 * fuga que la auditoría cerró en la web.
 */

/** Viewer mínimo para la matriz (User completo o un select parcial sirven). */
export type BotCatalogViewer =
    | { role: string; status: string; customerType?: string | null }
    | null
    | undefined

/** Niveles permitidos para el viewer, o null si no hay restricción. */
export function visibilityLevelsFor(viewer: BotCatalogViewer): MarketVisibility[] | null {
    return catalogVisibilityLevels(
        viewer == null
            ? null
            : { role: viewer.role, status: viewer.status, customerType: viewer.customerType ?? undefined },
    )
}

/**
 * Fragmento de `where` Prisma para consultas de catálogo del bot: se esparce
 * en el where (`...visibilityWhere(viewer)`); vacío cuando el viewer ve todo.
 */
export function visibilityWhere(viewer: BotCatalogViewer): Pick<Prisma.ProductWhereInput, "marketVisibility"> {
    const levels = visibilityLevelsFor(viewer)
    return levels ? { marketVisibility: { in: levels } } : {}
}
