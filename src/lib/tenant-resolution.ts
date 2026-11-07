import { prisma } from "@/lib/prisma"
import { getDefaultBusinessId } from "@/lib/settings"
import { normalizeSlug, SLUG_RE } from "@/lib/slug-rules"

/**
 * Resolución del tenant para rutas PÚBLICAS (sin sesión).
 *
 * El deployment corre varias vitrinas (/<slug>/market) sobre la misma
 * instancia, pero las rutas de catálogo históricas resolvían al primer
 * Business activo: un anónimo que llegó por la vitrina de otro negocio veía
 * el catálogo del tenant #1 y las cuentas nuevas caían siempre ahí.
 *
 * La vitrina declara su tenant con el query param `?biz=<slug>` o el header
 * `x-tenant-slug`; sin indicio se conserva el comportamiento de siempre
 * (getDefaultBusinessId) para no romper el modo mono-tenant.
 *
 * Un slug EXPLÍCITO que no corresponde a un negocio activo devuelve null —
 * la ruta responde 404 en vez de servir silenciosamente el tenant default
 * bajo la vitrina equivocada (peor que el error: fuga el catálogo ajeno).
 */

/** Query param por el que el cliente declara la vitrina de origen. */
export const TENANT_SLUG_PARAM = "biz"
/** Header alternativo (mismo significado; el query param gana). */
export const TENANT_SLUG_HEADER = "x-tenant-slug"

/**
 * businessId del negocio ACTIVO dueño de `rawSlug`, o null si no existe,
 * está inactivo o el valor ni siquiera tiene forma de slug.
 */
export async function businessIdForSlug(rawSlug: string): Promise<string | null> {
  const slug = normalizeSlug(rawSlug)
  if (!SLUG_RE.test(slug)) return null
  const business = await prisma.business.findFirst({
    where: { slug, isActive: true },
    select: { id: true },
  })
  return business?.id ?? null
}

/**
 * Tenant efectivo de una request pública:
 *   ?biz=<slug> o x-tenant-slug válidos → ese negocio
 *   ausente/vacío                        → getDefaultBusinessId() (compat)
 *   explícito pero inexistente/inactivo  → null (la ruta responde 404)
 */
export async function resolvePublicBusinessId(req?: Request | null): Promise<string | null> {
  const raw = req
    ? (new URL(req.url).searchParams.get(TENANT_SLUG_PARAM) ?? req.headers.get(TENANT_SLUG_HEADER))
    : null
  if (!raw?.trim()) return getDefaultBusinessId()
  return businessIdForSlug(raw)
}
