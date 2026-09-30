import { NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"

/**
 * "Sugerir compra": qué conviene pedir al proveedor según la demanda.
 * Une dos señales por producto:
 *  a) stock en o por debajo del mínimo → reabastecer hasta el doble,
 *  b) encargos de clientes PENDING ligados a la pieza (los de texto libre
 *     sin productId no se pueden sugerir solos).
 * `alreadyInList` marca los que YA tienen un insumo pendiente en la lista de
 * compras (ShoppingItem PENDING) para que la UI no duplique el pendiente.
 *
 * Orden: primero los que esperan clientes (encargosPendientes desc), luego por
 * severidad (qué tan abajo del mínimo están) y nombre.
 */
export async function GET() {
    try {
        const auth = await requireModule("inventario")
        if (auth.error) return auth.error
        const businessId = businessIdOf(getSession(auth)!)

        const [products, pendingEncargos, pendingItems] = await Promise.all([
            prisma.product.findMany({
                where: { businessId, isActive: true },
                select: { id: true, name: true, stock: true, minStock: true, retailPrice: true },
            }),
            prisma.encargo.groupBy({
                by: ["productId"],
                where: { businessId, status: "PENDING", productId: { not: null } },
                _sum: { quantity: true },
            }),
            prisma.shoppingItem.groupBy({
                by: ["productId"],
                where: { businessId, status: "PENDING", productId: { not: null } },
                _count: { _all: true },
            }),
        ])

        const encargosByProduct = new Map<string, number>()
        for (const row of pendingEncargos) {
            if (row.productId) encargosByProduct.set(row.productId, row._sum.quantity ?? 0)
        }
        const inList = new Set(
            pendingItems.map(row => row.productId).filter((id): id is string => Boolean(id)),
        )

        // Prisma no compara dos columnas: stock <= minStock se filtra en JS
        // (mismo patrón que listShoppingNeeds en lib/domain/shopping.ts).
        // También entran productos con encargos pendientes aunque estén sobre
        // el mínimo: un encargo PENDING significa un cliente esperando pieza.
        const suggestions = products
            .filter(p => p.stock <= p.minStock || (encargosByProduct.get(p.id) ?? 0) > 0)
            .map(p => {
                const encargosPendientes = encargosByProduct.get(p.id) ?? 0
                return {
                    productId: p.id,
                    name: p.name,
                    stock: p.stock,
                    minStock: p.minStock,
                    encargosPendientes,
                    // Reabastecer hasta el doble del mínimo y cubrir los encargos en espera.
                    suggestedQty: Math.max(1, p.minStock * 2 - p.stock, encargosPendientes),
                    retailPrice: p.retailPrice,
                    alreadyInList: inList.has(p.id),
                }
            })
            .sort((a, b) =>
                b.encargosPendientes - a.encargosPendientes
                || (b.minStock - b.stock) - (a.minStock - a.stock)
                || a.name.localeCompare(b.name))
            .slice(0, 200)

        return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "private, no-store" } })
    } catch (error) {
        return businessFailure(error)
    }
}
