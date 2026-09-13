import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { releaseStock, takeStock, transaction } from "@/lib/domain/operations"
import * as XLSX from "xlsx"

export async function GET() {
    try {
        const result = await requireAdmin()
        if (result.error) return result.error

        // Get all products with related data
        const products = await prisma.product.findMany({
            where: { businessId: businessIdOf(getSession(result)!) },
            include: {
                category: { select: { name: true } },
                models: {
                    include: {
                        model: {
                            include: {
                                brand: { select: { name: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { name: "asc" },
        })

        // Transform to flat structure for Excel
        const data = products.map((product) => {
            const model = product.models[0]?.model
            const brand = model?.brand?.name || ""
            const modelName = model?.name || ""

            return {
                ID: product.id,
                Nombre: product.name,
                Marca: brand,
                Modelo: modelName,
                Categoría: product.category?.name || "",
                "Código de Barras": product.barcode || "",
                "Precio Menudeo": product.retailPrice,
                "Precio Mayoreo": product.wholesalePrice,
                Stock: product.stock,
                "Stock Mínimo": product.minStock,
                Activo: product.isActive ? "Sí" : "No",
                Universal: product.isUniversal ? "Sí" : "No",
            }
        })

        // Create workbook
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(data)

        // Set column widths
        ws["!cols"] = [
            { wch: 25 }, // ID
            { wch: 40 }, // Nombre
            { wch: 15 }, // Marca
            { wch: 25 }, // Modelo
            { wch: 20 }, // Categoría
            { wch: 20 }, // Código de Barras
            { wch: 15 }, // Precio Menudeo
            { wch: 15 }, // Precio Mayoreo
            { wch: 10 }, // Stock
            { wch: 12 }, // Stock Mínimo
            { wch: 10 }, // Activo
            { wch: 10 }, // Universal
        ]

        XLSX.utils.book_append_sheet(wb, ws, "Productos")

        // Generate buffer
        const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

        // Return as downloadable file
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="productos_${new Date().toISOString().split("T")[0]}.xlsx"`,
            },
        })
    } catch (error) {
        console.error("Error exporting products:", error)
        return NextResponse.json(
            { error: "Error al exportar productos" },
            { status: 500 }
        )
    }
}

export async function POST(request: NextRequest) {
    try {
        const result = await requireAdmin()
        if (result.error) return result.error
        const session = getSession(result)!
        const actorId = session.user.id
        const businessId = businessIdOf(session)
        const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { homeBranchId: true } })

        const formData = await request.formData()
        const file = formData.get("file") as File
        const importBranchId = String(formData.get("branchId") || actor?.homeBranchId || "") || undefined

        if (!file) {
            return NextResponse.json({ error: "Archivo requerido" }, { status: 400 })
        }

        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        // Parse Excel file
        const wb = XLSX.read(buffer, { type: "buffer" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[]

        if (data.length === 0) {
            return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 })
        }

        let created = 0
        let updated = 0
        const errors: string[] = []

        for (const row of data) {
            try {
                const nombre = String(row["Nombre"] || "").trim()
                if (!nombre) {
                    errors.push(`Fila sin nombre de producto`)
                    continue
                }

                const retailPrice = Number(row["Precio Menudeo"]) || 0
                const wholesalePrice = Number(row["Precio Mayoreo"]) || 0
                const stock = Number(row["Stock"]) || 0
                const minStock = Number(row["Stock Mínimo"]) || 5
                const barcode = row["Código de Barras"] ? String(row["Código de Barras"]) : null
                const isActive = String(row["Activo"]).toLowerCase() !== "no" // Default true
                const isUniversal = String(row["Universal"]).toLowerCase() === "sí"

                // Find or create category
                let categoryId: string | undefined = undefined
                const categoryName = String(row["Categoría"] || "").trim()
                if (categoryName) {
                    const category = await prisma.category.findFirst({
                        where: { businessId, name: { contains: categoryName, mode: "insensitive" } },
                    })
                    categoryId = category?.id
                }

                // Check if product exists by ID or barcode
                const existingId = row["ID"] ? String(row["ID"]) : null
                let existingProduct = null

                if (existingId) {
                    existingProduct = await prisma.product.findUnique({
                        where: { id: existingId, businessId },
                    })
                } else if (barcode) {
                    existingProduct = await prisma.product.findFirst({
                        where: { barcode, businessId },
                    })
                }

                if (existingProduct) {
                    // Actualizar producto; el stock se ajusta por el dominio en una sucursal.
                    await transaction(prisma, async tx => {
                        await tx.product.update({
                            where: { id: existingProduct.id },
                            data: {
                                name: nombre,
                                barcode: barcode || undefined,
                                retailPrice,
                                wholesalePrice,
                                minStock,
                                isActive,
                                isUniversal,
                                categoryId,
                            },
                        })
                        const diff = stock - existingProduct.stock
                        if (diff !== 0) {
                            const branch = diff > 0
                                ? await releaseStock(tx, { productId: existingProduct.id, quantity: diff, branchId: importBranchId, businessId })
                                : (await takeStock(tx, { productId: existingProduct.id, quantity: -diff, branchId: importBranchId, businessId })).branch
                            const after = await tx.product.findUniqueOrThrow({ where: { id: existingProduct.id }, select: { stock: true } })
                            await tx.inventoryMovement.create({ data: {
                                businessId, productId: existingProduct.id, userId: actorId, type: "ADJUSTMENT",
                                quantity: Math.abs(diff), previousStock: after.stock - diff, newStock: after.stock,
                                reason: "ADJUSTMENT", notes: "Importación Excel", branchId: branch.id, businessVersion: 1,
                            } })
                        }
                    })
                    updated++
                } else {
                    // Create new product - need a category
                    if (!categoryId) {
                        // Get first category as default
                        const defaultCategory = await prisma.category.findFirst({ where: { businessId } })
                        if (!defaultCategory) {
                            errors.push(`Producto "${nombre}" sin categoría y no hay categorías disponibles`)
                            continue
                        }
                        categoryId = defaultCategory.id
                    }
                    const productCategoryId = categoryId

                    await transaction(prisma, async tx => {
                        const created = await tx.product.create({
                            data: {
                                businessId,
                                name: nombre,
                                barcode: barcode || undefined,
                                retailPrice,
                                wholesalePrice,
                                stock: 0,
                                minStock,
                                isActive,
                                isUniversal,
                                categoryId: productCategoryId,
                            },
                        })
                        if (stock > 0) {
                            const branch = await releaseStock(tx, { productId: created.id, quantity: stock, branchId: importBranchId, businessId })
                            await tx.inventoryMovement.create({ data: {
                                businessId, productId: created.id, userId: actorId, type: "IN",
                                quantity: stock, previousStock: 0, newStock: stock,
                                reason: "IMPORT", notes: "Importación Excel", branchId: branch.id, businessVersion: 1,
                            } })
                        }
                    })
                    created++
                }
            } catch (rowError) {
                const errorMsg = rowError instanceof Error ? rowError.message : "Error desconocido"
                errors.push(`Error en producto "${row["Nombre"]}": ${errorMsg}`)
            }
        }

        return NextResponse.json({
            success: true,
            message: `Importación completada: ${created} creados, ${updated} actualizados`,
            created,
            updated,
            errors: errors.slice(0, 10), // Return first 10 errors
            totalErrors: errors.length,
        })
    } catch (error) {
        console.error("Error importing products:", error)
        return NextResponse.json(
            { error: "Error al importar productos" },
            { status: 500 }
        )
    }
}
