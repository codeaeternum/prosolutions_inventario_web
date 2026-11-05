/**
 * Alcance (scope) del caché local de notificaciones en localStorage.
 *
 * El feed de notificaciones es por NEGOCIO y el estado de lectura por USUARIO;
 * la clave de caché combina ambos (`businessId:userId`). Antes se usaba una
 * sola clave global y el feed de un negocio quedaba cacheado y reaparecía
 * dentro del panel de OTRO negocio al entrar en modo soporte o cambiar de
 * cuenta — fuga cross-tenant.
 */
export const NOTIFICATION_CACHE_PREFIX = "prosolutions_notifications"
export const NOTIFICATION_CLEARED_PREFIX = "prosolutions_notifications_cleared_at"

/** Claves globales heredadas (sin scope): se purgan una vez al montar el hook. */
export const LEGACY_NOTIFICATION_KEYS = [
  NOTIFICATION_CACHE_PREFIX,
  NOTIFICATION_CLEARED_PREFIX,
] as const

/** Scope único de sesión: null mientras no haya usuario autenticado. */
export function notificationScope(
  businessId: string | null | undefined,
  userId: string | null | undefined,
): string | null {
  if (!userId) return null
  return `${businessId ?? ""}:${userId}`
}

export function notificationStorageKey(scope: string): string {
  return `${NOTIFICATION_CACHE_PREFIX}:${scope}`
}

export function notificationClearedKey(scope: string): string {
  return `${NOTIFICATION_CLEARED_PREFIX}:${scope}`
}
