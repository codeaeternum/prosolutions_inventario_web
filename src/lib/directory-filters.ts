import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { isValidSlug } from "@/lib/slug-rules"
import {
  DIRECTORY_SEARCH_LIMIT,
  DIRECTORY_SEARCH_MIN,
  publicBranchNames,
  type DirectoryProduct,
} from "@/lib/directory"

/**
 * Filtros del directorio público (/mercado): categorías reales presentes en el
 * catálogo visible y búsqueda combinada texto + categoría.
 *
 * Misma regla de oro que directory.ts — solo lo que la vitrina /<slug>/market
 * ya mostraría: producto isActive && marketVisibility "PUBLIC", de un negocio
 * isActive && showInDirectory. Nunca costos, mayoreo ni stock exacto.
 */

export interface DirectoryCategory {
  /** Nombre público de la categoría (Category.name es @unique global). */
  name: string
  /** Productos públicos del directorio en esa categoría. */
  count: number
}

/** Tope defensivo para la fila de chips: se priorizan las más surtidas. */
export const DIRECTORY_CATEGORY_LIMIT = 40

const publicText = (value: string | null): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * Producto visible en el directorio — idéntico al where de la vitrina
 * /<slug>/market y de searchDirectoryProducts en directory.ts.
 */
const PUBLIC_PRODUCT_WHERE = {
  isActive: true,
  marketVisibility: "PUBLIC",
  business: { isActive: true, showInDirectory: true },
} satisfies Prisma.ProductWhereInput

/**
 * Categorías con al menos un producto público en el directorio, con conteo.
 * Se derivan de Product.category (FK a Category) sobre los productos ya
 * visibles — no de una lista fija — así el filtro siempre refleja el
 * catálogo real publicado. Orden: más productos primero; empates por nombre.
 */
export async function listDirectoryCategories(): Promise<DirectoryCategory[]> {
  const categories = await prisma.category.findMany({
    where: {
      business: { isActive: true, showInDirectory: true },
      products: { some: PUBLIC_PRODUCT_WHERE },
    },
    select: {
      name: true,
      _count: { select: { products: { where: PUBLIC_PRODUCT_WHERE } } },
    },
  })

  // Category.name es @unique global; aun así se consolida por nombre para que
  // un dato anómalo nunca produzca chips duplicados.
  const byName = new Map<string, number>()
  for (const c of categories) {
    const name = c.name.trim()
    if (!name || c._count.products <= 0) continue
    byName.set(name, (byName.get(name) ?? 0) + c._count.products)
  }

  return [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"))
    .slice(0, DIRECTORY_CATEGORY_LIMIT)
}

/**
 * Búsqueda de productos a través de todas las empresas del directorio con
 * filtro opcional de categoría (`cat` = Category.name, único global):
 * - Sin categoría: misma regla de siempre — exige q >= DIRECTORY_SEARCH_MIN.
 * - Con categoría: basta el filtro para explorar (browse sin texto); si
 *   también hay texto se filtra dentro de la categoría.
 */
export async function browseDirectoryProducts(
  rawQuery: string,
  rawCategory: string | null,
): Promise<DirectoryProduct[]> {
  const q = rawQuery.trim().slice(0, 60)
  const cat = (rawCategory ?? "").trim().slice(0, 80)
  if (!cat && q.length < DIRECTORY_SEARCH_MIN) return []

  const where: Prisma.ProductWhereInput = { ...PUBLIC_PRODUCT_WHERE }
  if (cat) where.category = { name: { equals: cat, mode: "insensitive" } }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { barcode: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ]
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: { name: "asc" },
    take: DIRECTORY_SEARCH_LIMIT,
    // Mismo select que searchDirectoryProducts: solo campos ya públicos.
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
        ...(branches.length > 0 ? { branches } : {}),
        business: {
          name: publicText(p.business.name) ?? "Negocio",
          slug: p.business.slug,
        },
      }
    })
}
