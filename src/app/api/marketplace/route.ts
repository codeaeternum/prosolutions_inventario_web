import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin, requireMarketplaceViewer } from "@/lib/api-auth"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { prisma } from "@/lib/prisma"

const toggleVisibilitySchema = z.object({
  productId: z.string().min(1),
  marketplaceVisible: z.boolean(),
})

// GET /api/marketplace?search=&category=&hidden=1
// Catálogo B2B: lo que los talleres aliados (WORKSHOP) ven del inventario.
// `hidden=1` (solo ADMIN) incluye también los productos ocultos del mercado;
// WORKSHOP y EMPLOYEE siempre ven únicamente los productos visibles.
export async function GET(req: Request) {
  try {
    const result = await requireMarketplaceViewer()
    if (result.error) return result.error
    const session = getSession(result)!
    const isAdmin = session.user.role === "ADMIN"

    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")?.trim()
    const category = searchParams.get("category")?.trim()
    const includeHidden = searchParams.get("hidden") === "1" && isAdmin

    const where = {
      isActive: true,
      ...(includeHidden ? {} : { marketplaceVisible: true }),
      ...(category && { categoryId: category }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { barcode: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
          { category: { name: { contains: search, mode: "insensitive" as const } } },
        ],
      }),
    }

    const [products, visibleCount] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          barcode: true,
          retailPrice: true,
          wholesalePrice: true,
          stock: true,
          minStock: true,
          images: true,
          marketplaceVisible: true,
          category: { select: { id: true, name: true } },
          stocks: {
            select: {
              quantity: true,
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { name: "asc" },
        take: 100,
      }),
      prisma.product.count({
        where: { isActive: true, marketplaceVisible: true },
      }),
    ])

    return NextResponse.json(
      {
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          barcode: p.barcode,
          retailPrice: p.retailPrice,
          wholesalePrice: p.wholesalePrice,
          stock: p.stock,
          minStock: p.minStock,
          image: p.images[0] ?? null,
          marketplaceVisible: p.marketplaceVisible,
          category: p.category,
          branches: p.stocks
            .map((s) => ({
              branchId: s.branch.id,
              branchName: s.branch.name,
              quantity: s.quantity,
            }))
            .sort((a, b) => a.branchName.localeCompare(b.branchName)),
        })),
        total: products.length,
        visibleCount,
      },
      { headers: catalogResponseHeaders }
    )
  } catch (error) {
    console.error("Error fetching marketplace:", error)
    return NextResponse.json({ error: "Error al obtener el mercado" }, { status: 500 })
  }
}

// POST /api/marketplace  { productId, marketplaceVisible }
// Solo ADMIN: muestra u oculta un producto del catálogo para talleres.
export async function POST(req: Request) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const body = await req.json()
    const parseResult = toggleVisibilitySchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }
    const { productId, marketplaceVisible } = parseResult.data

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 })
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: { marketplaceVisible },
      select: {
        id: true,
        name: true,
        marketplaceVisible: true,
      },
    })

    return NextResponse.json(product)
  } catch (error) {
    console.error("Error updating marketplace visibility:", error)
    return NextResponse.json({ error: "Error al actualizar el producto" }, { status: 500 })
  }
}
