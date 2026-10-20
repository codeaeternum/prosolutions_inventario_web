import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule, requireMarketplaceViewer, assertModuleAllowed } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { catalogResponseHeaders } from "@/lib/product-dto"
import {
  ALLY_CATALOG_LEVELS,
  MARKET_VISIBILITY_LABELS,
  isMarketVisibility,
  levelFromLegacyBoolean,
  marketVisibilitySchema,
  type MarketVisibility,
} from "@/lib/market-visibility"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"

// Dos formas de apuntar productos: uno solo o publicación masiva (1..500).
const targetSchema = z.union([
  z.object({ productId: z.string().min(1) }),
  z.object({ productIds: z.array(z.string().min(1)).min(1).max(500) }),
])

// Nivel nuevo (marketVisibility) o booleano viejo (marketplaceVisible):
// compat — clientes aún no migrados mandan true/false y se mapea a
// ALLIES (visible para talleres) / HIDDEN.
const visibilitySchema = z.intersection(
  targetSchema,
  z.union([
    z.object({ marketVisibility: marketVisibilitySchema }),
    z.object({ marketplaceVisible: z.boolean() }),
  ])
)

// GET /api/marketplace?search=&category=&hidden=1
// Catálogo B2B del negocio:
// - WORKSHOP (taller aliado): solo productos ALLIES|PUBLIC, con su precio de
//   taller. Nunca ve HIDDEN ni precios internos/de costo.
// - Staff (ADMIN/EMPLOYEE con módulo mercado): TODOS los activos, cada uno con
//   su nivel marketVisibility — es la fuente del control de publicación de
//   /admin/mercado. `hidden=1` queda aceptado por compat (ya no es necesario:
//   el staff siempre ve el catálogo completo).
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
    const isWorkshop = session.user.role === "WORKSHOP"
    const businessId = businessIdOf(session)
    // El desglose de existencias por sucursal (branches[]) solo muestra las
    // sucursales asignadas del empleado; WORKSHOP (aliado) conserva todas —
    // necesita saber en qué sucursal recoger la pieza.
    const allowed = isWorkshop || session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const stocksBranchScope = allowed?.length ? { branchId: { in: allowed } } : {}

    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")?.trim()
    const category = searchParams.get("category")?.trim()

    const where = {
      businessId,
      isActive: true,
      // El taller aliado solo ve lo publicado para él; el staff lo ve todo
      // (administra los tres niveles desde /admin/mercado).
      ...(isWorkshop ? { marketVisibility: { in: [...ALLY_CATALOG_LEVELS] } } : {}),
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

    const [products, grouped] = await Promise.all([
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
          marketVisibility: true,
          category: { select: { id: true, name: true } },
          stocks: {
            where: { businessId, ...stocksBranchScope },
            select: {
              quantity: true,
              branch: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { name: "asc" },
        take: 100,
      }),
      prisma.product.groupBy({
        by: ["marketVisibility"],
        where: { businessId, isActive: true },
        _count: { _all: true },
      }),
    ])

    // Conteo por nivel para el resumen "N publicados" del panel staff.
    const counts = { HIDDEN: 0, ALLIES: 0, PUBLIC: 0 }
    for (const row of grouped) {
      if (isMarketVisibility(row.marketVisibility)) {
        counts[row.marketVisibility] = row._count._all
      }
    }
    // Compat: `visibleCount` era "publicados a talleres" = ALLIES + PUBLIC.
    const visibleCount = counts.ALLIES + counts.PUBLIC

    return NextResponse.json(
      {
        products: products.map((p) => {
          const level = isMarketVisibility(p.marketVisibility)
            ? p.marketVisibility
            : "HIDDEN"
          return {
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            retailPrice: p.retailPrice,
            wholesalePrice: p.wholesalePrice,
            stock: p.stock,
            minStock: p.minStock,
            image: p.images[0] ?? null,
            marketVisibility: level,
            // Derivado legacy para clientes viejos que aún lean el booleano.
            marketplaceVisible: level !== "HIDDEN",
            category: p.category,
            branches: p.stocks
              .map((s) => ({
                branchId: s.branch.id,
                branchName: s.branch.name,
                quantity: s.quantity,
              }))
              .sort((a, b) => a.branchName.localeCompare(b.branchName)),
          }
        }),
        total: products.length,
        visibleCount,
        counts: {
          hidden: counts.HIDDEN,
          allies: counts.ALLIES,
          public: counts.PUBLIC,
          published: visibleCount,
        },
      },
      { headers: catalogResponseHeaders }
    )
  } catch (error) {
    console.error("Error fetching marketplace:", error)
    return NextResponse.json({ error: "Error al obtener el mercado" }, { status: 500 })
  }
}

// POST /api/marketplace — formas aceptadas:
//   { productId, marketVisibility }               → un producto
//   { productIds: string[] (1..500), marketVisibility } → publicación masiva
// Compat: `marketplaceVisible` booleano viejo → true:"ALLIES" false:"HIDDEN".
// marketVisibility ∈ HIDDEN | ALLIES | PUBLIC — el nivel decide quién ve la
// pieza: nadie / solo talleres aliados / también el público general.
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
    const data = parseResult.data

    const level: MarketVisibility =
      "marketVisibility" in data && data.marketVisibility !== undefined
        ? data.marketVisibility
        : levelFromLegacyBoolean(
            (data as { marketplaceVisible: boolean }).marketplaceVisible
          )
    const levelLabel = MARKET_VISIBILITY_LABELS[level]

    // Bulk: updateMany acotado al negocio y a activos — ids ajenos o inactivos
    // simplemente no cuentan en `count`.
    if ("productIds" in data) {
      const { productIds } = data
      const { count } = await prisma.product.updateMany({
        where: { businessId, isActive: true, id: { in: productIds } },
        data: { marketVisibility: level },
      })

      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "PRODUCT_UPDATE",
        entity: "product",
        entityId: null,
        summary: `Publicación masiva al mercado: ${count} productos → ${levelLabel}`,
        changes: { marketVisibility: level, productIds },
      })

      return NextResponse.json({ updated: count, marketVisibility: level })
    }

    const { productId } = data

    const existing = await prisma.product.findUnique({
      where: { id: productId, businessId },
      select: { id: true, name: true, marketVisibility: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 })
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data: { marketVisibility: level },
      select: {
        id: true,
        name: true,
        marketVisibility: true,
      },
    })

    // Cambiar el nivel mueve el producto entre audiencias (nadie / aliados /
    // público): queda en auditoría con etiqueta legible.
    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "PRODUCT_UPDATE",
      entity: "product",
      entityId: product.id,
      entityName: product.name,
      summary: `Visibilidad de mercado: ${isMarketVisibility(existing.marketVisibility) ? MARKET_VISIBILITY_LABELS[existing.marketVisibility] : existing.marketVisibility} → ${levelLabel} · ${product.name}`,
      changes: {
        marketVisibility: {
          from: existing.marketVisibility,
          to: level,
        },
      },
    })

    return NextResponse.json({
      ...product,
      // Derivado legacy para clientes viejos.
      marketplaceVisible: level !== "HIDDEN",
    })
  } catch (error) {
    console.error("Error updating marketplace visibility:", error)
    return NextResponse.json({ error: "Error al actualizar el producto" }, { status: 500 })
  }
}
