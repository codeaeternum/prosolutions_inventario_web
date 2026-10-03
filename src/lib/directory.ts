import { prisma } from "@/lib/prisma"
import { isValidSlug } from "@/lib/slug-rules"

/**
 * Directorio público global (/mercado + /api/directory): la vitrina de TODOS
 * los negocios activos que optaron por aparecer (Business.showInDirectory).
 *
 * Regla de oro: aquí solo sale lo que ya es público en la vitrina /<slug> —
 * nombre, slug, categoría, logo, dirección y conteos. NUNCA emails, teléfonos
 * de usuarios, precios de taller/costo ni stock exacto.
 */

/** Logo público: solo paths locales de uploads (misma regla que public-slug). */
const publicLogo = (value: string | null): string | null => {
  const trimmed = value?.trim()
  return trimmed && trimmed.startsWith("/uploads/") ? trimmed : null
}

const publicText = (value: string | null): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export interface DirectoryBusiness {
  name: string
  slug: string
  category: string
  logoUrl: string | null
  address: string | null
  /** Coordenadas públicas del negocio (alimentan el mapa de /mercado). */
  lat: number | null
  lng: number | null
  counts: {
    products: number
    workshopServices: number
  }
}

export interface DirectoryProduct {
  id: string
  name: string
  /** Precio público (el que ya muestra /<slug>/market). */
  retailPrice: number
  image: string | null
  /** Disponible/Agotado — jamás el número exacto de piezas. */
  inStock: boolean
  category: string | null
  /**
   * Sucursales activas con la pieza disponible (solo nombres, nunca
   * cantidades). Se omite la llave cuando no hay existencias.
   */
  branches?: string[]
  business: { name: string; slug: string }
}

/** Nombres de sucursales activas con stock — disponibilidad binaria pública. */
export const publicBranchNames = (
  stocks: { quantity: number; branch: { name: string; isActive: boolean } }[] | undefined,
): string[] =>
  (stocks ?? [])
    .filter((s) => s.quantity > 0 && s.branch.isActive)
    .map((s) => s.branch.name)
    .sort((a, b) => a.localeCompare(b, "es"))

/**
 * Negocios listados en el directorio: activos, con showInDirectory y slug
 * válido (defensivo: el slug ya se valida al guardarse). Orden: más
 * productos públicos primero; empates por nombre.
 */
export async function listDirectoryBusinesses(): Promise<DirectoryBusiness[]> {
  const businesses = await prisma.business.findMany({
    where: { isActive: true, showInDirectory: true },
    select: {
      name: true,
      slug: true,
      category: true,
      logoUrl: true,
      address: true,
      lat: true,
      lng: true,
      _count: {
        select: {
          // Mismos filtros de visibilidad que la vitrina /<slug>/market:
          // solo lo PUBLIC — lo exclusivo de aliados no cuenta aquí.
          products: { where: { isActive: true, marketVisibility: "PUBLIC" } },
          workshopServices: { where: { isActive: true } },
        },
      },
    },
  })

  return businesses
    .filter(b => isValidSlug(b.slug))
    .map(b => ({
      name: publicText(b.name) ?? "Negocio",
      slug: b.slug,
      category: b.category,
      logoUrl: publicLogo(b.logoUrl),
      address: publicText(b.address),
      lat: b.lat,
      lng: b.lng,
      counts: {
        products: b._count.products,
        workshopServices: b._count.workshopServices,
      },
    }))
    .sort((a, b) =>
      b.counts.products - a.counts.products || a.name.localeCompare(b.name, "es")
    )
}

export const DIRECTORY_SEARCH_MIN = 2
export const DIRECTORY_SEARCH_LIMIT = 50

/**
 * Búsqueda de productos a través de todas las empresas del directorio.
 * Respeta exactamente la visibilidad pública de la vitrina: producto activo
 * + marketVisibility "PUBLIC" (el mismo nivel que usa /<slug>/market).
 */
export async function searchDirectoryProducts(rawQuery: string): Promise<DirectoryProduct[]> {
  const q = rawQuery.trim().slice(0, 60)
  if (q.length < DIRECTORY_SEARCH_MIN) return []

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      marketVisibility: "PUBLIC",
      business: { isActive: true, showInDirectory: true },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: DIRECTORY_SEARCH_LIMIT,
    select: {
      id: true,
      name: true,
      retailPrice: true,
      stock: true,
      images: true,
      category: { select: { name: true } },
      business: { select: { name: true, slug: true } },
      stocks: {
        select: {
          quantity: true,
          branch: { select: { name: true, isActive: true } },
        },
      },
    },
  })

  return products
    .filter(p => isValidSlug(p.business.slug))
    .map((p) => {
      const branches = publicBranchNames(p.stocks)
      return {
        id: p.id,
        name: p.name,
        retailPrice: p.retailPrice,
        image: p.images[0] ?? null,
        inStock: p.stock > 0,
        category: p.category?.name ?? null,
        // Solo se expone la llave cuando hay algo que decir (compat con el
        // contrato público ya fijado en los tests de seguridad).
        ...(branches.length > 0 ? { branches } : {}),
        business: {
          name: publicText(p.business.name) ?? "Negocio",
          slug: p.business.slug,
        },
      }
    })
}
