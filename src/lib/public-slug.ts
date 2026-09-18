import { cache } from "react"

export {
  RESERVED_SLUGS,
  isValidSlug,
  normalizeSlug,
  SLUG_RE,
} from "@/lib/slug-rules"
import { normalizeSlug, RESERVED_SLUGS, SLUG_RE } from "@/lib/slug-rules"
import { prisma } from "@/lib/prisma"
import { getBusinessSetting, getDefaultBusinessId } from "@/lib/settings"

/**
 * Namespace público por slug: reficio.app/<slug> es la vitrina de un negocio
 * (Business.slug, multi-tenant) o de un taller aliado (User.publicSlug con
 * role WORKSHOP y status APPROVED).
 *
 * Pensado para multi-tenant: /<slug>/market, /<slug>/order-status.
 */

export type SlugTarget =
  | {
      kind: "business"
      /** Id del negocio dueño del slug (scoping multi-tenant). */
      businessId: string
      slug: string
      name: string
      /** Path del logo subido (/uploads/logo-*) o null si no hay. */
      logo: string | null
      phone?: string
      description?: string
      address?: string
      /** Coordenadas públicas (mapa del directorio + JSON-LD geo). */
      lat?: number
      lng?: number
    }
  | {
      kind: "workshop"
      slug: string
      name: string
      userId: string
      /** Id del negocio al que pertenece el taller (scoping multi-tenant). */
      businessId: string
      /** Nombre del negocio al que pertenece el taller ("Taller aliado de X"). */
      businessName: string
      /** Talleres aliados no tienen logo propio por ahora: siempre null. */
      logo: string | null
      phone?: string
    }
  | null

const clean = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Logo público: solo paths locales de uploads (nada de URLs externas). */
const cleanLogo = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim()
  return trimmed && trimmed.startsWith("/uploads/") ? trimmed : null
}

/**
 * Resuelve /<slug> a su dueño: primero un negocio activo (Business.slug),
 * luego talleres aliados (User.publicSlug, WORKSHOP + APPROVED). Devuelve
 * null si nadie lo reclama o si el slug es inválido — la página lo convierte
 * en 404.
 *
 * La descripción pública sigue en SystemSettings scoped por negocio
 * (public_description); se lee defensivamente porque puede no existir.
 * Errores de BD (p. ej. tabla ausente) también devuelven null tras loguear.
 */
// cache() deduplica por request: generateMetadata + page resuelven el mismo
// slug sin repetir las consultas.
export const resolvePublicSlug = cache(async (rawSlug: string): Promise<SlugTarget> => {
  const slug = normalizeSlug(rawSlug)
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return null

  try {
    const business = await prisma.business.findUnique({
      where: { slug, isActive: true },
      select: {
        id: true, name: true, slug: true, phone: true, address: true, logoUrl: true,
        lat: true, lng: true,
      },
    })
    if (business) {
      return {
        kind: "business",
        businessId: business.id,
        slug: business.slug,
        name: clean(business.name) ?? "El negocio",
        logo: cleanLogo(business.logoUrl),
        phone: clean(business.phone),
        description: clean(await getBusinessSetting(business.id, "public_description")),
        address: clean(business.address),
        lat: business.lat ?? undefined,
        lng: business.lng ?? undefined,
      }
    }

    // Taller aliado: su slug público muere con la empresa (isActive=false),
    // igual que el slug del propio negocio — empresa suspendida = 404.
    const user = await prisma.user.findFirst({
      where: { publicSlug: slug, role: "WORKSHOP", status: "APPROVED", business: { isActive: true } },
      select: {
        id: true,
        name: true,
        jobTitle: true,
        businessName: true,
        phone: true,
        businessId: true,
        business: { select: { name: true } },
      },
    })
    if (!user) return null

    return {
      kind: "workshop",
      slug,
      name: user.jobTitle ?? user.businessName ?? user.name,
      userId: user.id,
      businessId: user.businessId,
      businessName: clean(user.business.name) ?? "el negocio",
      logo: null,
      phone: clean(user.phone),
    }
  } catch (error) {
    console.error("[public-slug] Error resolviendo slug:", error)
    return null
  }
})

/** Nombre público del negocio (tickets y textos compartidos). */
export async function getBusinessName(): Promise<string> {
  try {
    const value = await getBusinessSetting(await getDefaultBusinessId(), "ticket_business_name")
    return clean(value) ?? "El negocio"
  } catch (error) {
    console.error("[public-slug] Error leyendo ticket_business_name:", error)
    return "El negocio"
  }
}
