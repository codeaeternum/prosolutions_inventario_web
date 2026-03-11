/**
 * Formato estándar de respuestas paginadas.
 * Las APIs que devuelven listas deben usar este shape para consistencia.
 */
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * Construye una respuesta paginada estándar (campo `data`).
 * Para compatibilidad con clientes que esperan `products`/`users`/`reservations`,
 * los Route Handlers pueden seguir devolviendo ese nombre y el cliente usa getPaginatedItems().
 */
export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit) || 1
  return { data: items, total, page, limit, totalPages }
}
