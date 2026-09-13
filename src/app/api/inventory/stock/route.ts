import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"

/**
 * Existencias por sucursal: una fila por producto activo con el desglose
 * por cada sucursal activa. Pensado para la matriz de /admin/inventario.
 *
 * Filtros opcionales: ?search= (nombre/barcode), ?categoryId=, ?lowStock=true
 * (total <= minStock; se filtra en JS porque Prisma no compara columnas).
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await requireAdminOrEmployee()
        if (auth.error) return auth.error
        const businessId = businessIdOf(getSession(auth)!)

        const { searchParams } = new URL(request.url)
        const search = searchParams.get("search")?.trim()
        const categoryId = searchParams.get("categoryId")
        const lowStock = searchParams.get("lowStock") === "true"

        const where = {
            businessId,
            isActive: true,
            ...(categoryId ? { categoryId } : {}),
            ...(search
                ? {
                    OR: [
                        { name: { contains: search, mode: "insensitive" as const } },
                        { barcode: { contains: search, mode: "insensitive" as const } },
                    ],
                }
                : {}),
        }

        const [products, branches, categories] = await Promise.all([
            prisma.product.findMany({
                where,
                orderBy: { name: "asc" },
                select: {
                    id: true,
                    name: true,
                    barcode: true,
                    minStock: true,
                    category: { select: { id: true, name: true } },
                    stocks: {
                        where: { businessId },
                        select: {
                            branchId: true,
                            quantity: true,
                            branch: { select: { name: true } },
                        },
                    },
                },
            }),
            prisma.branch.findMany({
                where: { businessId, isActive: true },
                orderBy: { createdAt: "asc" },
                select: { id: true, name: true },
            }),
            prisma.category.findMany({
                where: { businessId },
                orderBy: { name: "asc" },
                select: { id: true, name: true },
            }),
        ])

        const rows = products.map((p) => {
            // Mapa branchId -> cantidad para rellenar las columnas activas.
            const byBranch = new Map(p.stocks.map((s) => [s.branchId, s.quantity]))
            // El total considera TODAS las sucursales (incl. inactivas), como Product.stock.
            const total = p.stocks.reduce((acc, s) => acc + s.quantity, 0)
            return {
                id: p.id,
                name: p.name,
                barcode: p.barcode,
                category: p.category,
                minStock: p.minStock,
                total,
                branches: branches.map((b) => ({
                    branchId: b.id,
                    branchName: b.name,
                    quantity: byBranch.get(b.id) ?? 0,
                })),
            }
        })

        const filtered = lowStock ? rows.filter((r) => r.total <= r.minStock) : rows

        return NextResponse.json(
            {
                products: filtered,
                branches,
                categories,
                summary: {
                    products: filtered.length,
                    lowStock: rows.filter((r) => r.total > 0 && r.total <= r.minStock).length,
                    outOfStock: rows.filter((r) => r.total === 0).length,
                },
            },
            { headers: { "Cache-Control": "private, no-store" } }
        )
    } catch (error) {
        console.error("Error fetching stock by branch:", error)
        return NextResponse.json({ error: "Error al cargar existencias" }, { status: 500 })
    }
}
