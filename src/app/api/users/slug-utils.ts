import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isValidSlug, normalizeSlug } from "@/lib/public-slug"

/**
 * Resuelve el publicSlug a persistir para un usuario WORKSHOP.
 * Devuelve el slug normalizado, null si queda vacío, o una NextResponse de
 * error (400 inválido / 409 colisión con otro taller o con el negocio).
 */
export async function resolveWorkshopSlug(
  raw: unknown,
  businessId: string,
  excludeUserId?: string
): Promise<string | null | NextResponse> {
  const slug = normalizeSlug(typeof raw === "string" ? raw : "")
  if (!slug) return null
  if (!isValidSlug(slug)) {
    return NextResponse.json(
      { error: "Slug inválido o reservado: usa minúsculas, números y guiones internos" },
      { status: 400 }
    )
  }
  // El namespace de slugs es global: Business.slug y User.publicSlug comparten
  // /<slug>/*. Las colisiones se verifican contra TODAS las empresas/talleres.
  const [takenByUser, takenByBusiness] = await Promise.all([
    prisma.user.findFirst({
      where: { publicSlug: slug, ...(excludeUserId && { NOT: { id: excludeUserId } }) },
      select: { id: true },
    }),
    prisma.business.findFirst({ where: { slug }, select: { id: true } }),
  ])
  if (takenByUser) {
    return NextResponse.json(
      { error: "Ese slug ya lo usa otro taller aliado" },
      { status: 409 }
    )
  }
  if (takenByBusiness) {
    return NextResponse.json(
      { error: "Ese slug es el link público de un negocio" },
      { status: 409 }
    )
  }
  return slug
}
