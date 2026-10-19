import { NextRequest, NextResponse } from "next/server"
import { assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { BusinessError, releaseStock, takeStock, transaction } from "@/lib/domain/operations"
import { syncLowStockAlerts } from "@/lib/low-stock"
import { recordAudit } from "@/lib/audit"
import * as XLSX from "xlsx"

// Límites de la importación: el archivo se lee completo en memoria y cada fila
// corre su propia transacción serializable — 10 MB / 5,000 filas por tanda.
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_ROWS = 5_000

const isBlankCell = (value: unknown) => value === undefined || value === null || String(value).trim() === ""

/**
 * Celda numérica del Excel. Vacía = ausente (en actualización conserva el
 * valor del producto). Devuelve null cuando el contenido no es usable: antes
 * `Number(x) || 0` convertía texto a 0 y dejaba pasar negativos, lo que
 * brincaba el producto en el POS al fallar cents().
 */
function numericCell(value: unknown, opts: { integer?: boolean } = {}): number | undefined | null {
  if (isBlankCell(value)) return undefined
  const n = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n < 0) return null
  if (opts.integer && !Number.isInteger(n)) return null
  return n
}

/** Celda "Sí/No" (Activo). Vacía = ausente; cualquier valor salvo "no" cuenta como sí. */
function boolCell(value: unknown): boolean | undefined {
  if (isBlankCell(value)) return undefined
  return String(value).trim().toLowerCase() !== "no"
}

/** Celda "Sí" estricta (Universal): vacía = ausente; solo "sí"/"si" enciende. */
function yesCell(value: unknown): boolean | undefined {
  if (isBlankCell(value)) return undefined
  const text = String(value).trim().toLowerCase()
  return text === "sí" || text === "si"
}

/**
 * Traduce un fallo de fila a un mensaje seguro para el usuario: los errores de
 * Prisma llevan internals (constraint, modelo, SQL) que no deben exponerse.
 */
function describeRowError(error: unknown): string {
  if (error instanceof BusinessError) return error.message // mensajes de dominio ya son user-facing
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : ""
  if (code === "P2002") return "dato duplicado"
  if (code === "P2003") return "referencia inválida"
  if (code.startsWith("P")) return "error de base de datos"
  return "error en la fila"
}

export async function GET() {
    try {
        const result = await requireModule("inventario")
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
        const result = await requireModule("inventario")
        if (result.error) return result.error
        const session = getSession(result)!
        const actorId = session.user.id
        const businessId = businessIdOf(session)
        const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { homeBranchId: true } })

        const formData = await request.formData()
        const file = formData.get("file")
        const importBranchId = String(formData.get("branchId") || actor?.homeBranchId || "") || undefined
        // Los ajustes de stock de la importación caen a esta sucursal.
        const denied = await assertOperationBranch(session, importBranchId)
        if (denied) return denied

        if (!file || typeof file === "string") {
            return NextResponse.json({ error: "Archivo requerido" }, { status: 400 })
        }
        if (file.size > MAX_FILE_BYTES) {
            return NextResponse.json({ error: "El archivo supera el máximo de 10 MB" }, { status: 400 })
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
        if (data.length > MAX_ROWS) {
            return NextResponse.json(
                { error: `El archivo tiene ${data.length} filas; el máximo por importación es ${MAX_ROWS.toLocaleString("es-MX")}. Divídelo en varias cargas.` },
                { status: 400 }
            )
        }

        // ── Pase 1: validar celdas (sin tocar la BD). Las filas inválidas se
        // rechazan con error propio en vez de corromperse en silencio. ──
        const errors: string[] = []
        type ParsedRow = {
            line: number
            nombre: string
            existingId: string | null
            barcode: string | null
            retailPrice?: number
            wholesalePrice?: number
            stock?: number
            minStock?: number
            isActive?: boolean
            isUniversal?: boolean
            categoryName: string
        }
        const rows: ParsedRow[] = []
        data.forEach((row, index) => {
            const line = index + 2 // la fila 1 del Excel es el encabezado
            const reject = (message: string) => errors.push(`Fila ${line}: ${message}`)

            const nombre = String(row["Nombre"] || "").trim()
            if (!nombre) {
                reject("sin nombre de producto")
                return
            }
            const retailPrice = numericCell(row["Precio Menudeo"])
            if (retailPrice === null) {
                reject(`"Precio Menudeo" debe ser un número mayor o igual a 0`)
                return
            }
            const wholesalePrice = numericCell(row["Precio Mayoreo"])
            if (wholesalePrice === null) {
                reject(`"Precio Mayoreo" debe ser un número mayor o igual a 0`)
                return
            }
            const stock = numericCell(row["Stock"], { integer: true })
            if (stock === null) {
                reject(`"Stock" debe ser un entero mayor o igual a 0`)
                return
            }
            const minStock = numericCell(row["Stock Mínimo"], { integer: true })
            if (minStock === null) {
                reject(`"Stock Mínimo" debe ser un entero mayor o igual a 0`)
                return
            }
            rows.push({
                line,
                nombre,
                existingId: isBlankCell(row["ID"]) ? null : String(row["ID"]).trim(),
                barcode: isBlankCell(row["Código de Barras"]) ? null : String(row["Código de Barras"]).trim(),
                retailPrice,
                wholesalePrice,
                stock,
                minStock,
                isActive: boolCell(row["Activo"]),
                isUniversal: yesCell(row["Universal"]),
                categoryName: String(row["Categoría"] || "").trim(),
            })
        })

        // ── Pase 2: prefetch en lote. Antes cada fila hacía su propia
        // consulta de categoría + producto (2×N lecturas seriales). ──
        // Categorías del tenant indexadas por nombre: coincidencia EXACTA
        // insensible a mayúsculas (un "contains" ligaba "a" a cualquiera).
        const categories = await prisma.category.findMany({
            where: { businessId },
            select: { id: true, name: true },
            orderBy: { createdAt: "asc" },
        })
        const categoryByName = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]))
        const defaultCategoryId = categories[0]?.id

        // Productos ya existentes por ID o por código de barras, en una
        // sola consulta. La fila con ID solo busca por ID; sin ID, por código.
        const wantedIds = [...new Set(rows.filter(r => r.existingId).map(r => r.existingId!))]
        const wantedBarcodes = [...new Set(rows.filter(r => !r.existingId && r.barcode).map(r => r.barcode!))]
        const existing = (wantedIds.length || wantedBarcodes.length)
            ? await prisma.product.findMany({
                where: {
                    businessId,
                    OR: [
                        ...(wantedIds.length ? [{ id: { in: wantedIds } }] : []),
                        ...(wantedBarcodes.length ? [{ barcode: { in: wantedBarcodes } }] : []),
                    ],
                },
                select: { id: true, barcode: true, stock: true, isActive: true },
            })
            : []
        const byId = new Map(existing.map(p => [p.id, p]))
        const byBarcode = new Map(existing.filter(p => p.barcode).map(p => [p.barcode!, p]))

        let created = 0
        let updated = 0
        // Productos cuyo stock/mínimo pudo cruzar el umbral: la alerta se
        // sincroniza una sola vez al terminar la importación (post-commit).
        const touchedProductIds = new Set<string>()

        // ── Pase 3: una transacción por fila (los efectos de stock siguen
        // siendo atómicos aunque otra fila falle). ──
        for (const row of rows) {
            try {
                // Categoría: match exacto por nombre; si la fila no nombra una
                // categoría existente, la actualización conserva la actual y la
                // creación cae a la primera del negocio (comportamiento previo).
                const categoryId = row.categoryName ? categoryByName.get(row.categoryName.toLowerCase()) : undefined
                const existingProduct = row.existingId
                    ? byId.get(row.existingId)
                    : row.barcode ? byBarcode.get(row.barcode) : undefined

                if (existingProduct) {
                    // Actualizar producto; el stock se ajusta por el dominio en una sucursal.
                    // Las celdas vacías conservan el valor actual (una columna en
                    // blanco ya no apaga el producto ni le pone precio 0).
                    await transaction(prisma, async tx => {
                        await tx.product.update({
                            where: { id: existingProduct.id },
                            data: {
                                name: row.nombre,
                                ...(row.barcode ? { barcode: row.barcode } : {}),
                                ...(row.retailPrice !== undefined ? { retailPrice: row.retailPrice } : {}),
                                ...(row.wholesalePrice !== undefined ? { wholesalePrice: row.wholesalePrice } : {}),
                                ...(row.minStock !== undefined ? { minStock: row.minStock } : {}),
                                ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
                                ...(row.isUniversal !== undefined ? { isUniversal: row.isUniversal } : {}),
                                ...(categoryId ? { categoryId } : {}),
                            },
                        })
                        const targetStock = row.stock ?? existingProduct.stock
                        const diff = targetStock - existingProduct.stock
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
                    touchedProductIds.add(existingProduct.id)
                    updated++
                } else {
                    // Create new product - need a category
                    const productCategoryId = categoryId ?? defaultCategoryId
                    if (!productCategoryId) {
                        errors.push(`Fila ${row.line}: producto "${row.nombre}" sin categoría y no hay categorías disponibles`)
                        continue
                    }

                    const initialStock = row.stock ?? 0
                    const createdProduct = await transaction(prisma, async tx => {
                        const created = await tx.product.create({
                            data: {
                                businessId,
                                name: row.nombre,
                                barcode: row.barcode || undefined,
                                retailPrice: row.retailPrice ?? 0,
                                wholesalePrice: row.wholesalePrice ?? 0,
                                stock: 0,
                                minStock: row.minStock ?? 5,
                                isActive: row.isActive ?? true,
                                isUniversal: row.isUniversal ?? false,
                                categoryId: productCategoryId,
                            },
                        })
                        if (initialStock > 0) {
                            const branch = await releaseStock(tx, { productId: created.id, quantity: initialStock, branchId: importBranchId, businessId })
                            await tx.inventoryMovement.create({ data: {
                                businessId, productId: created.id, userId: actorId, type: "IN",
                                quantity: initialStock, previousStock: 0, newStock: initialStock,
                                reason: "IMPORT", notes: "Importación Excel", branchId: branch.id, businessVersion: 1,
                            } })
                        }
                        return created
                    })
                    touchedProductIds.add(createdProduct.id)
                    created++
                }
            } catch (rowError) {
                errors.push(`Fila ${row.line} ("${row.nombre}"): ${describeRowError(rowError)}`)
            }
        }

        // Una sola revisión al final: los avisos llegan agrupados, no por fila.
        await syncLowStockAlerts(prisma, businessId, [...touchedProductIds])
        // Importación masiva: un solo evento resumen (no uno por producto).
        if (created + updated > 0) {
            await recordAudit(prisma, {
                businessId,
                actorId,
                action: "PRODUCT_IMPORT",
                entity: "product",
                entityName: file.name || "Excel",
                summary: `Importó ${created + updated} productos por Excel (${created} nuevos, ${updated} actualizados)`,
            })
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
