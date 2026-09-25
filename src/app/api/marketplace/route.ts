import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule, requireMarketplaceViewer, assertModuleAllowed } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { catalogResponseHeaders } from "@/lib/product-dto"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"

const toggleVisibilitySchema = z.object({
  productId: z.string().min(1),
  marketplaceVisible: z.boolean(),
})

const bulkVisibilitySchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(500),
  marketplaceVisible: z.boolean(),
})

const visibilitySchema = z.union([toggleVisibilitySchema, bulkVisibilitySchema])

// GET /api/marketplace?search=&category=&hidden=1
// Catálogo B2B: lo que los talleres aliados (WORKSHOP) ven del inventario.
// `hidden=1` (solo ADMIN) incluye también los productos ocultos del mercado;
// WORKSHOP y EMPLOYEE siempre ven únicamente los productos visibles.
export async function GET(req: Request) {
  try {
    const result = await requireMarketplaceViewer()
    if (result.error) return result.error
    const session = getSession(result)!
    // WORKSHOP es el cliente del catálogo; el staff interno necesita el módulo.
    if (session.user.role !== "WORKSHOP") {
      const denied = assertModuleAllowed(session, "mercado")
      if (denied) return denied
    }
    const isAdmin = session.user.role === "ADMIN"
    const businessId = businessIdOf(session)

    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")?.trim()
    const category = searchParams.get("category")?.trim()
    const includeHidden = searchParams.get("hidden") === "1" && isAdmin

    const where = {
      businessId,
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
            where: { businessId },
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
        where: { businessId, isActive: true, marketplaceVisible: true },
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

// POST /api/marketplace — dos formas:
//   { productId, marketplaceVisible }              → un producto (toggle del panel)
//   { productIds: string[] (1..500), marketplaceVisible } → publicación masiva
// Módulo mercado: muestra u oculta productos del catálogo para talleres.
export async function POST(req: Request) {
  try {
    const result = await requireModule("mercado")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const body = await req.json()
    const parseResult = visibilitySchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }

    // Bulk: updateMany acotado al negocio y a activos — ids ajenos o inactivos
    // simplemente no cuentan en `count`.
    if ("productIds" in parseResult.data) {
      const { productIds, marketplaceVisible } = parseResult.data
      const { count } = await prisma.product.updateMany({
        where: { businessId, isActive: true, id: { in: productIds } },
        data: { marketplaceVisible },
      })

      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "PRODUCT_UPDATE",
        entity: "product",
        entityId: null,
        summary: `Publicación masiva al mercado: ${count} productos ${marketplaceVisible ? "publicados" : "ocultos"}`,
        changes: { marketplaceVisible, productIds },
      })

      return NextResponse.json({ updated: count })
    }

    const { productId, marketplaceVisible } = parseResult.data

    const existing = await prisma.product.findUnique({
      where: { id: productId, businessId },
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
