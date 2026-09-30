import type { PrismaClient, Prisma } from "@prisma/client"
import { ALLY_CATALOG_LEVELS } from "../market-visibility"

/**
 * Catálogo B2B de aliados: la MISMA frontera de visibilidad que usa
 * GET /api/marketplace/sugerencias — productos activos con marketVisibility
 * ALLIES|PUBLIC, de negocios activos distintos al del consultor. Aquí se
 * codifica como helper compartido para que otros módulos (p. ej. las
 * sugerencias de compra del almacén) encuentren "qué aliado tiene la pieza"
 * sin duplicar la regla ni filtrar nunca un producto HIDDEN.
 *
 * Product.stock es el total del tenant aliado (invariante stock = Σ
 * BranchStock, ver workshop.ts): stock > 0 equivale a "lo tiene en
 * existencia" sin importar en qué sucursal.
 */

/** Oferta de UN aliado para la pieza buscada. */
export interface AllyOffer {
    businessId: string
    businessName: string
    /** Piezas en existencia en el tenant aliado (total del producto). */
    stock: number
    /** Precio aliado: wholesalePrice del producto; retailPrice si no hay mayoreo. */
    price: number
}

/**
 * Pieza propia a emparejar en los catálogos aliados. La cadena de match es
 * por prioridad y se corta al primer nivel con resultados:
 *  1) `linkedAllyProductIds` — ids de producto DEL LADO ALIADO ya ligados a
 *     esta pieza (p. ej. un encargo que se pidió por el mercado y quedó con
 *     marketplaceRequestId → MarketplaceRequest.productId);
 *  2) barcode exacto (solo si la pieza propia lo tiene capturado);
 *  3) nombre normalizado (case/acentos/espacios) como último recurso.
 */
export interface AllyMatchTarget {
    /** Id del producto en el tenant que consulta (llave del resultado). */
    productId: string
    name: string
    barcode?: string | null
    linkedAllyProductIds?: readonly string[]
}

/** Tope defensivo: la ruta ya corta a 200 sugerencias. */
const MAX_TARGETS = 300
/** Aliados por pieza — la card solo muestra las primeras ofertas. */
export const MAX_ALLY_OFFERS = 5

/**
 * Nombre de producto comparable entre tenants: minúsculas sin acentos y con
 * espacios colapsados ("Pantalla  A55" ≡ "pantalla a55"). La búsqueda en BD
 * usa equals-insensitive y esta llave afina el match en JS (el modo
 * insensitive de Postgres no quita acentos).
 */
export function normalizeProductName(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
}

/** Fila mínima del catálogo aliado para armar la oferta. */
const allyProductSelect = {
    id: true,
    name: true,
    barcode: true,
    stock: true,
    retailPrice: true,
    wholesalePrice: true,
    business: { select: { id: true, name: true } },
} satisfies Prisma.ProductSelect

type AllyProductRow = Prisma.ProductGetPayload<{ select: typeof allyProductSelect }>

/** Frontera de tenant: catálogo aliado con existencias (ver doc del módulo). */
const allyWhere = (businessId: string): Prisma.ProductWhereInput => ({
    isActive: true,
    marketVisibility: { in: [...ALLY_CATALOG_LEVELS] },
    stock: { gt: 0 },
    business: { isActive: true, id: { not: businessId } },
})

/** Precio aliado publicado: mayoreo si existe, si no el menudeo público. */
const allyPriceOf = (row: AllyProductRow): number => row.wholesalePrice || row.retailPrice

/**
 * Junta los productos de un mismo negocio aliado en UNA oferta: precio = el
 * más barato publicado y stock = el mayor visto (un tenant puede tener el
 * mismo nombre/barcode repetido en su catálogo; sumar inflaría la cifra).
 * Devuelve las ofertas por precio ascendente, tope MAX_ALLY_OFFERS.
 */
function offersOf(rows: AllyProductRow[]): AllyOffer[] {
    const byBusiness = new Map<string, AllyOffer>()
    for (const row of rows) {
        const prev = byBusiness.get(row.business.id)
        byBusiness.set(row.business.id, {
            businessId: row.business.id,
            businessName: row.business.name,
            stock: Math.max(prev?.stock ?? 0, row.stock),
            price: Math.min(prev?.price ?? Number.POSITIVE_INFINITY, allyPriceOf(row)),
        })
    }
    return [...byBusiness.values()]
        .sort((a, b) => a.price - b.price || a.businessName.localeCompare(b.businessName, "es"))
        .slice(0, MAX_ALLY_OFFERS)
}

/**
 * Encuentra qué aliados tienen en existencia cada pieza pedida. Tres
 * consultas por LOTES (no una por producto): primero las ligas directas ya
 * conocidas, luego barcodes exactos de los que siguen sin match y al final
 * nombres de los restantes. Devuelve productId propio → ofertas (posiblemente
 * vacío; una pieza sin oferta no aparece en el mapa).
 */
export async function findAllyOffers(
    db: PrismaClient,
    businessId: string,
    targets: readonly AllyMatchTarget[],
): Promise<Map<string, AllyOffer[]>> {
    const result = new Map<string, AllyOffer[]>()
    const scoped = targets.slice(0, MAX_TARGETS)
    if (!scoped.length) return result

    const base = allyWhere(businessId)

    // — 1) Ligas directas: encargos que ya apuntan al producto del aliado —
    const linkedByTarget = new Map<string, string[]>()
    const linkedIds = new Set<string>()
    for (const t of scoped) {
        if (!t.linkedAllyProductIds?.length) continue
        const ids = [...new Set(t.linkedAllyProductIds)]
        linkedByTarget.set(t.productId, ids)
        for (const id of ids) linkedIds.add(id)
    }
    if (linkedIds.size) {
        const rows = await db.product.findMany({
            where: { ...base, id: { in: [...linkedIds] } },
            select: allyProductSelect,
        })
        const byId = new Map(rows.map(row => [row.id, row]))
        for (const t of scoped) {
            const matched = (linkedByTarget.get(t.productId) ?? [])
                .map(id => byId.get(id))
                .filter((row): row is AllyProductRow => Boolean(row))
            if (matched.length) result.set(t.productId, offersOf(matched))
        }
    }

    // — 2) Barcode exacto: solo piezas sin match por liga y con barcode —
    const byBarcode = new Map<string, string>()
    for (const t of scoped) {
        if (result.has(t.productId)) continue
        const barcode = t.barcode?.trim()
        if (barcode) byBarcode.set(t.productId, barcode)
    }
    if (byBarcode.size) {
        const rows = await db.product.findMany({
            where: { ...base, barcode: { in: [...new Set(byBarcode.values())] } },
            select: allyProductSelect,
        })
        const grouped = new Map<string, AllyProductRow[]>()
        for (const row of rows) {
            const key = row.barcode?.trim()
            if (!key) continue
            const list = grouped.get(key) ?? []
            list.push(row)
            grouped.set(key, list)
        }
        for (const [productId, barcode] of byBarcode) {
            const matched = grouped.get(barcode) ?? []
            if (matched.length) result.set(productId, offersOf(matched))
        }
    }

    // — 3) Nombre: último recurso para las que siguen sin oferta —
    const pendingByName = scoped.filter(t => !result.has(t.productId))
    if (pendingByName.length) {
        const rows = await db.product.findMany({
            where: {
                ...base,
                OR: pendingByName.map(t => ({ name: { equals: t.name, mode: "insensitive" as const } })),
            },
            select: allyProductSelect,
        })
        const grouped = new Map<string, AllyProductRow[]>()
        for (const row of rows) {
            const key = normalizeProductName(row.name)
            const list = grouped.get(key) ?? []
            list.push(row)
            grouped.set(key, list)
        }
        for (const t of pendingByName) {
            const matched = grouped.get(normalizeProductName(t.name)) ?? []
            if (matched.length) result.set(t.productId, offersOf(matched))
        }
    }

    return result
}
