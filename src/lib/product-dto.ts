type Viewer = { role: string; status: string; customerType?: string } | null | undefined
export function isCatalogStaff(viewer: Viewer): boolean {
  return viewer?.status === "APPROVED" && (viewer.role === "ADMIN" || viewer.role === "EMPLOYEE")
}
export function canSeeWholesale(viewer: Viewer): boolean {
  return isCatalogStaff(viewer) || (viewer?.status === "APPROVED" && (viewer.customerType === "STORE" || viewer.customerType === "TECHNICIAN"))
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
