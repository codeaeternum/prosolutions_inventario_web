import { NextResponse } from "next/server"
import { assertBranchAllowed, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { productDto } from "@/lib/product-dto"

// Catálogo navegable para el grid del terminal POS: productos activos con
// stock, paginados por categoría. El stock mostrado es el de la sucursal
// seleccionada (fuente: BranchStock), igual que en /api/search/pos.
export async function GET(req: Request) {
  try {
    const auth = await requireModule("ventas")
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const query = new URL(req.url).searchParams
    const categoryId = query.get("categoryId") || undefined
    const branchId = query.get("branchId") || undefined
    // El stock por sucursal solo se expone si el empleado la tiene asignada.
    const deniedBranch = assertBranchAllowed(session, branchId)
    if (deniedBranch) return deniedBranch
    const cursor = query.get("cursor") || undefined
    const limit = Math.max(1, Math.min(60, Number(query.get("limit")) || 24))

    const products = await prisma.product.findMany({
      where: {
        businessId,
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, barcode: true, stock: true,
        retailPrice: true, wholesalePrice: true, images: true,
        categoryId: true,
        category: { select: { name: true } },
        models: { include: { model: { include: { brand: true } } }, take: 1 },
      },
    })
    const hasMore = products.length > limit
    let result = products.slice(0, limit)

    if (branchId) {
      const stocks = await prisma.branchStock.findMany({
        where: { branchId, businessId, productId: { in: result.map(p => p.id) } },
        select: { productId: true, quantity: true },
      })
      const byProduct = new Map(stocks.map(s => [s.productId, s.quantity]))
      result = result.map(p => ({ ...p, stock: byProduct.get(p.id) ?? 0 }))
    }
    return NextResponse.json(
      { products: result.map(p => productDto(p, session.user)), nextCursor: hasMore ? result[result.length - 1]?.id ?? null : null },
      { headers: { "Cache-Control": "private, no-store" } },
    )
  } catch (error) {
    console.error("POS products error:", error)
    return NextResponse.json({ error: "Error al cargar el catálogo" }, { status: 500 })
  }
}
