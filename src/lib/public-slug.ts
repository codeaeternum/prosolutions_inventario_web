import { cache } from "react"

export {
  RESERVED_SLUGS,
  isValidSlug,
  normalizeSlug,
  SLUG_RE,
} from "@/lib/slug-rules"
import { normalizeSlug, RESERVED_SLUGS, SLUG_RE } from "@/lib/slug-rules"
import { prisma } from "@/lib/prisma"

/**
 * Namespace público por slug: reficio.app/<slug> es la vitrina del negocio
 * (slug guardado en SystemSettings "business_slug") o de un taller aliado
 * (User.publicSlug con role WORKSHOP y status APPROVED).
 *
 * Pensado para multi-tenant a futuro: /<slug>/market, /<slug>/order-status.
 */

export type SlugTarget =
  | {
      kind: "business"
      slug: string
      name: string
      phone?: string
      description?: string
      address?: string
    }
  | {
      kind: "workshop"
      slug: string
      name: string
      userId: string
      phone?: string
    }
  | null

const BUSINESS_KEYS = [
  "business_slug",
  "ticket_business_name",
  "public_phone",
  "public_description",
  "public_address",
] as const

const clean = (value: string | undefined | null): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Resuelve /<slug> a su dueño: primero el negocio (SystemSettings
 * "business_slug"), luego talleres aliados (User.publicSlug, WORKSHOP +
 * APPROVED). Devuelve null si nadie lo reclama o si el slug es inválido —
 * la página lo convierte en 404.
 *
 * Los settings públicos se leen defensivamente: pueden no existir todavía.
 * Errores de BD (p. ej. tabla ausente) también devuelven null tras loguear.
 */
// cache() deduplica por request: generateMetadata + page resuelven el mismo
// slug sin repetir las consultas.
export const resolveSlug = cache(async (rawSlug: string): Promise<SlugTarget> => {
  const slug = normalizeSlug(rawSlug)
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) return null

  try {
    const rows = await prisma.systemSettings.findMany({
      where: { key: { in: [...BUSINESS_KEYS] } },
      select: { key: true, value: true },
    })
    const settings = new Map(rows.map(r => [r.key, r.value]))

    const businessSlug = normalizeSlug(settings.get("business_slug") ?? "")
    if (businessSlug && businessSlug === slug) {
      return {
        kind: "business",
        slug,
        name: clean(settings.get("ticket_business_name")) ?? "El negocio",
        phone: clean(settings.get("public_phone")),
        description: clean(settings.get("public_description")),
        address: clean(settings.get("public_address")),
      }
    }

    const user = await prisma.user.findFirst({
      where: { publicSlug: slug, role: "WORKSHOP", status: "APPROVED" },
      select: { id: true, name: true, jobTitle: true, businessName: true, phone: true },
    })
    if (!user) return null

    return {
      kind: "workshop",
      slug,
      name: user.jobTitle ?? user.businessName ?? user.name,
      userId: user.id,
      phone: clean(user.phone),
    }
  } catch (error) {
    console.error("[public-slug] Error resolviendo slug:", error)
    return null
  }
})

/** Nombre público del negocio (tickets, vitrinas de talleres aliados). */
export async function getBusinessName(): Promise<string> {
  try {
    const row = await prisma.systemSettings.findUnique({
      where: { key: "ticket_business_name" },
      select: { value: true },
    })
    return clean(row?.value) ?? "El negocio"
  } catch (error) {
    console.error("[public-slug] Error leyendo ticket_business_name:", error)
    return "El negocio"
  }
}
