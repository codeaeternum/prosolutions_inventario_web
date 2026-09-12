/**
 * Reglas de slugs públicos — ÚNICA FUENTE client-safe (sin imports de servidor).
 * `src/lib/public-slug.ts` los re-exporta para el servidor; la UI los importa
 * de aquí directamente.
 */

export const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/

// Slugs que nunca pueden ser namespace público. Además de las rutas reales del
// App Router (Next resuelve lo estático primero, pero un negocio con ese slug
// tendría una vitrina inalcanzable), se reservan las subrutas del propio
// namespace y las convenciones de Next/archivos de /public.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Rutas de la app
  "admin",
  "api",
  "catalogo",
  "seguimiento",
  "evidencia",
  "cotizacion",
  "login",
  "register",
  "pending",
  "mercado",
  "carrito",
  "mis-reservas",
  "perfil",
  "instalar",
  "verificar",
  "uploads",
  "t",
  // Subrutas del namespace público (evitan /<slug> ambiguas como /market)
  "market",
  "order-status",
  "servicios",
  // Convenciones de Next.js y archivos públicos
  "_next",
  "icons",
  "favicon.ico",
  "manifest.json",
  "robots.txt",
  "sitemap.xml",
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
  "sw.js",
  "offline.html",
])

/** Normaliza un slug candidato o recibido por URL: trim + minúsculas. */
export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Válido para `business_slug` o `User.publicSlug`: formato correcto y no
 * reservado. Acepta mayúsculas/espacios en la entrada (se normaliza antes de
 * validar) — el valor que se persiste debe ser el normalizado.
 */
export function isValidSlug(s: string): boolean {
  const slug = normalizeSlug(s)
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug)
}
