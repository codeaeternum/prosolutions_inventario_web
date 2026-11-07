import { ALLY_CATALOG_LEVELS, type MarketVisibility } from "./market-visibility"

type Viewer = { role: string; status: string; customerType?: string } | null | undefined
export function isCatalogStaff(viewer: Viewer): boolean {
  return viewer?.status === "APPROVED" && (viewer.role === "ADMIN" || viewer.role === "EMPLOYEE")
}
export function canSeeWholesale(viewer: Viewer): boolean {
  return isCatalogStaff(viewer) || (viewer?.status === "APPROVED" && (viewer.customerType === "STORE" || viewer.customerType === "TECHNICIAN"))
}
/**
 * Niveles de `Product.marketVisibility` que el viewer puede listar en el
 * catálogo tenant (/api/products, /api/products/[id], /api/search/pos):
 *
 * - `null` → sin filtro: staff y CUSTOMER aprobado ven el catálogo completo
 *   del negocio (el POS del mostrador opera estas mismas rutas con sesión).
 * - `["ALLIES","PUBLIC"]` → aliado con cuenta: rol WORKSHOP o CUSTOMER
 *   aprobado de tipo STORE/TECHNICIAN (su canal B2B es /api/marketplace).
 * - `["PUBLIC"]` → anónimo o cuenta sin aprobar: la vitrina nunca recibe
 *   piezas ALLIES/HIDDEN — la fuga cerrada por la auditoría.
 */
export function catalogVisibilityLevels(viewer: Viewer): MarketVisibility[] | null {
  if (isCatalogStaff(viewer)) return null
  if (viewer?.status !== "APPROVED") return ["PUBLIC"]
  const ally = viewer.role === "WORKSHOP" || canSeeWholesale(viewer)
  return ally ? [...ALLY_CATALOG_LEVELS] : null
}
/** Explicit allowlist prevents future database columns becoming public accidentally. */
export function productDto<T extends object>(product: T, viewer: Viewer): Record<string, unknown> {
  const input = product as Record<string, unknown>
  const keys = ["id", "name", "description", "barcode", "retailPrice", "stock", "images", "isUniversal", "categoryId", "category", "models"]
  if (canSeeWholesale(viewer)) keys.push("wholesalePrice")
  if (isCatalogStaff(viewer)) keys.push("internalPrice", "minStock", "isActive", "createdAt", "updatedAt", "_count", "stocks", "marketVisibility")
  // El costo revela el margen real: solo el dueño (ADMIN) lo ve.
  if (isCatalogStaff(viewer) && viewer!.role === "ADMIN") keys.push("costPrice")
  return Object.fromEntries(keys.filter(key => key in input).map(key => [key, input[key]]))
}
export const catalogResponseHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" }
