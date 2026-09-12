import { auth } from "@/lib/auth"
import { productDto, isCatalogStaff, catalogResponseHeaders } from "@/lib/product-dto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export async function GET(req: Request) {
    try {
    const viewer = (await auth())?.user
        const { searchParams } = new URL(req.url)
        const query = searchParams.get("q")?.trim()
        const publicOnly = searchParams.get("publicOnly") === "true"
        const branchId = searchParams.get("branchId") || undefined

        if (!query || query.length < 2) {
            return NextResponse.json({ products: [] })
        }

        const isCuid = /^c[a-z0-9]{24}$/.test(query)
        const words = query.split(/\s+/).filter(word => word.length > 0)

        // Búsqueda en nombre, descripción, categoría y marca
        const andConditions = words.map(word => ({
            OR: [
                { name: { contains: word, mode: "insensitive" as const } },
                { description: { contains: word, mode: "insensitive" as const } },
                { category: { name: { contains: word, mode: "insensitive" as const } } },
                { models: { some: { model: { brand: { name: { contains: word, mode: "insensitive" as const } } } } } },
                { models: { some: { model: { name: { contains: word, mode: "insensitive" as const } } } } },
            ]
        }))

    const baseWhere = {
        isActive: true,
        ...(publicOnly ? { stock: { gt: 0 } } : {})
    }

        let products = await prisma.product.findMany({
            where: {
                ...baseWhere,
                OR: [
                    { barcode: { contains: query, mode: "insensitive" } },
                    ...(isCuid ? [{ id: { equals: query } }] : []),
                    { AND: andConditions }
                ],
            },
            take: 20,
            select: {
                id: true,
                name: true,
                barcode: true,
                stock: true,
                retailPrice: true,
                wholesalePrice: true,
                images: true,
                category: { select: { name: true } },
                models: {
                    include: {
                        model: { include: { brand: true } }
                    },
                    take: 1
                }
            },
            orderBy: { stock: 'desc' }
        })

        // Fuzzy search con pg_trgm si no hay resultados o si se forzó la búsqueda y falló el AND
        if (products.length === 0) {
            try {
                // Buscamos coincidencia fuzzy en PostgreSQL (requiere pg_trgm activo)
                const fuzzyQuery = query
                const limit = 10
                
                // raw query parameters
                const results: any[] = await prisma.$queryRaw`
                    SELECT p.id, p.name, p.barcode, p.stock, p."retailPrice", p."wholesalePrice", p.images, 
                           c.name as "categoryName"
                    FROM "Product" p
                    LEFT JOIN "Category" c ON p."categoryId" = c.id
                    WHERE p."isActive" = true 
                      ${publicOnly ? Prisma.raw('AND p.stock > 0') : Prisma.raw('')}
                      AND similarity(p.name, ${fuzzyQuery}) > 0.3
                    ORDER BY similarity(p.name, ${fuzzyQuery}) DESC
                    LIMIT ${limit}
                `

                // Mapear los resultados raw para que coincidan con la estructura Prisma
                const mappedResults = results.map(row => ({
                    id: row.id,
                    name: row.name,
                    barcode: row.barcode,
                    stock: row.stock,
                    retailPrice: row.retailPrice,
                    wholesalePrice: row.wholesalePrice,
                    images: row.images,
                    category: { name: row.categoryName },
                    models: [] // Omitimos modelos en raw query para simplificar
                }))

                products = mappedResults
            } catch (e) {
                console.error("Fuzzy search failed, likely pg_trgm is not installed or syntax error:", e)
                // Fallback a OR
                const orConditions = words.map(word => ({
                    name: { contains: word, mode: "insensitive" as const }
                }))

                const looseProducts = await prisma.product.findMany({
                    where: {
                        ...baseWhere,
                        OR: orConditions
                    },
                    take: 10,
                    select: {
                        id: true,
                        name: true,
                        barcode: true,
                        stock: true,
                        retailPrice: true,
                        wholesalePrice: true,
                        images: true,
                        category: { select: { name: true } },
                        models: {
                            include: {
                                model: { include: { brand: true } }
                            },
                            take: 1
                        }
                    }
                })

                const ranked = looseProducts.map(p => {
                    const name = p.name.toLowerCase()
                    const score = words.filter(w => name.includes(w.toLowerCase())).length
                    return { ...p, score }
                }).sort((a, b) => b.score - a.score)

                products = ranked.map(({ score, ...p }) => p)
            }
        }

        // Con sucursal, el stock mostrado es el de ESE local (fuente: BranchStock).
        let result = products.slice(0, 20)
        if (branchId && isCatalogStaff(viewer)) {
            const stocks = await prisma.branchStock.findMany({
                where: { branchId, productId: { in: result.map(p => p.id) } },
                select: { productId: true, quantity: true },
            })
            const byProduct = new Map(stocks.map(s => [s.productId, s.quantity]))
            result = result.map(p => ({ ...p, stock: byProduct.get(p.id) ?? 0 }))
        }
        return NextResponse.json({ products: result.map(p => productDto(p, viewer)) }, { headers: catalogResponseHeaders })
    } catch (error) {
        console.error("Unified Search error:", error)
        return NextResponse.json({ error: "Error en la búsqueda" }, { status: 500 })
    }
}
