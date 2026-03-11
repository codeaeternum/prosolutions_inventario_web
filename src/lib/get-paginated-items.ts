/**
 * Normaliza la respuesta de APIs que pueden devolver listas paginadas con distintos nombres.
 * Uso: const items = getPaginatedItems(response, 'products' | 'users' | 'reservations' | 'data')
 */
export function getPaginatedItems<T>(
  data: {
    products?: T[]
    users?: T[]
    reservations?: T[]
    data?: T[]
    items?: T[]
    total?: number
    page?: number
  },
  preferredKey: "products" | "users" | "reservations" | "data" = "data"
): T[] {
  const list =
    data[preferredKey] ??
    data.products ??
    data.users ??
    data.reservations ??
    data.items ??
    []
  return Array.isArray(list) ? list : []
}

/**
 * Extrae metadatos de paginación de una respuesta (total, page, limit, totalPages).
 */
export function getPaginationMeta(data: {
  total?: number
  page?: number
  limit?: number
  totalPages?: number
}): { total: number; page: number; limit: number; totalPages: number } {
  return {
    total: data.total ?? 0,
    page: data.page ?? 1,
    limit: data.limit ?? 20,
    totalPages: data.totalPages ?? 1,
  }
}
