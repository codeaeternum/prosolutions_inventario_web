import { auth } from "@/lib/auth"
import { productDto, isCatalogStaff, catalogResponseHeaders } from "@/lib/product-dto"
import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getDefaultBusinessId } from "@/lib/settings"
import { prisma } from "@/lib/prisma"
import { releaseStock, takeStock } from "@/lib/domain/operations"
import type { Prisma } from "@prisma/client"

type TransactionClient = Prisma.TransactionClient

// GET /api/products/[id] - Get single product
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const viewerSession = await auth()
    const viewer = viewerSession?.user
    const businessId = viewerSession ? businessIdOf(viewerSession) : await getDefaultBusinessId()
    const { id } = await params

    const product = await prisma.product.findUnique({
      where: { id, businessId },
      include: {
        models: {
          include: {
            model: {
              include: { brand: true },
            },
          },
        },
        category: true,
        _count: { select: { reservations: true } },
      },
    })

    if (!product || (!product.isActive && !isCatalogStaff(viewer))) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      )
    }

    // Tipo para ProductModel con modelo y marca incluidos
    type ProductModelWithBrand = {
      model: {
        id: string
        name: string
        brand: { name: string }
      }
    }

    // Transformar modelos para el frontend
    const transformedProduct = {
      ...product,
      models: product.models.map((pm: ProductModelWithBrand) => ({
        id: pm.model.id,
        name: pm.model.name,
        brand: { name: pm.model.brand.name },
      })),
    }

    return NextResponse.json(productDto(transformedProduct, viewer), { headers: catalogResponseHeaders })
  } catch (error) {
    console.error("Error fetching product:", error)
    return NextResponse.json(
      { error: "Error al obtener producto" },
      { status: 500 }
    )
  }
}

// PUT /api/products/[id] - Update product
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const { id } = await params
    const body = await req.json()
    const {
      name,
      description,
      barcode,
      retailPrice,
      wholesalePrice,
      costPrice,
      stock,
      minStock,
      images,
      isUniversal,
      isActive,
      categoryId,
      modelIds,
      stockBranchId,
    } = body

    if (!name || !retailPrice || !wholesalePrice || !categoryId) {
      return NextResponse.json(
        { error: "Nombre, precios y categoría son requeridos" },
        { status: 400 }
      )
    }

    if (!isUniversal && (!modelIds || modelIds.length === 0)) {
      return NextResponse.json(
        { error: "Selecciona al menos un modelo o marca como universal" },
        { status: 400 }
      )
    }

    // Verificar que el producto existe
    const existingProduct = await prisma.product.findUnique({
      where: { id, businessId },
    })

    if (!existingProduct) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      )
    }

    // Verificar barcode único (excepto el mismo producto)
    if (barcode) {
      const barcodeExists = await prisma.product.findFirst({
        where: {
          barcode,
          businessId,
          NOT: { id },
        },
      })
      if (barcodeExists) {
        return NextResponse.json(
          { error: "Ya existe otro producto con este código de barras" },
          { status: 400 }
        )
      }
    }

    // Calcular diferencia de stock para movimiento de inventario.
    // La existencia se ajusta en UNA sucursal (stockBranchId o la del usuario);
    // nunca como valor absoluto sobre el total.
    const stockDiff = parseInt(stock) - existingProduct.stock
    const editor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { homeBranchId: true } })

    // Actualizar producto y modelos en transacción
    const product = await prisma.$transaction(async (tx: TransactionClient) => {
      // Eliminar relaciones de modelos existentes
      await tx.productModel.deleteMany({
        where: { productId: id },
      })

      // Track price changes
      const parsedCostPrice = (costPrice != null && costPrice !== "") ? parseFloat(costPrice) : null
      const priceFields = [
        { field: "retailPrice", oldVal: existingProduct.retailPrice, newVal: parseFloat(retailPrice) },
        { field: "wholesalePrice", oldVal: existingProduct.wholesalePrice, newVal: parseFloat(wholesalePrice) },
        { field: "costPrice", oldVal: existingProduct.costPrice ?? 0, newVal: parsedCostPrice ?? 0 },
      ]
      for (const { field, oldVal, newVal } of priceFields) {
        if (oldVal !== newVal) {
          await tx.priceHistory.create({
            data: {
              businessId,
              productId: id,
              field,
              oldValue: oldVal,
              newValue: newVal,
              changedById: session.user.id,
            },
          })
        }
      }

      // Actualizar producto
      const updatedProduct = await tx.product.update({
        where: { id, businessId },
        data: {
          name,
          description: description || null,
          barcode: barcode || null,
          retailPrice: parseFloat(retailPrice),
          wholesalePrice: parseFloat(wholesalePrice),
          costPrice: parsedCostPrice,
          minStock: parseInt(minStock),
          images: images || [],
          isUniversal: isUniversal ?? false,
          isActive: isActive ?? true,
          categoryId,
          models: isUniversal
            ? undefined
            : {
                create: modelIds.map((modelId: string) => ({
                  businessId,
                  modelId,
                })),
              },
        },
        include: {
          models: {
            include: {
              model: {
                include: { brand: true },
              },
            },
          },
          category: true,
        },
      })

      // Ajuste de existencias siempre por el dominio: sucursal + total coherentes.
      if (stockDiff !== 0) {
        const branch = stockDiff > 0
          ? await releaseStock(tx, { productId: id, quantity: stockDiff, branchId: stockBranchId ?? editor?.homeBranchId, businessId })
          : (await takeStock(tx, { productId: id, quantity: -stockDiff, branchId: stockBranchId ?? editor?.homeBranchId })).branch
        const after = await tx.product.findUniqueOrThrow({ where: { id }, select: { stock: true } })
        await tx.inventoryMovement.create({
          data: {
            businessId,
            productId: id,
            type: "ADJUSTMENT",
            quantity: Math.abs(stockDiff),
            previousStock: after.stock - stockDiff,
            newStock: after.stock,
            reason: "ADJUSTMENT",
            notes: "Ajuste manual de stock desde edición de producto",
            userId: session.user.id,
            branchId: branch.id,
            businessVersion: 1,
          },
        })
      }

      return updatedProduct
    })

    return NextResponse.json(product)
  } catch (error) {
    console.error("Error updating product:", error)
    return NextResponse.json(
      { error: "Error al actualizar producto" },
      { status: 500 }
    )
  }
}

// DELETE /api/products/[id] - Delete product
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const { id } = await params

    // Verificar que el producto existe
    const existingProduct = await prisma.product.findUnique({
      where: { id, businessId },
      include: {
        reservations: {
          where: {
            status: { in: ["PENDING", "DEPOSIT_VERIFIED"] },
          },
        },
      },
    })

    if (!existingProduct) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      )
    }

    // No eliminar si tiene reservas activas
    if (existingProduct.reservations.length > 0) {
      return NextResponse.json(
        { error: "No se puede eliminar un producto con reservas activas" },
        { status: 400 }
      )
    }

    // Eliminar en transacción
    await prisma.$transaction(async (tx: TransactionClient) => {
      // Eliminar relaciones de modelos
      await tx.productModel.deleteMany({
        where: { productId: id, businessId },
      })

      // Eliminar movimientos de inventario
      await tx.inventoryMovement.deleteMany({
        where: { productId: id, businessId },
      })

      // Eliminar reservas (solo las completadas/canceladas)
      await tx.reservation.deleteMany({
        where: { productId: id, businessId },
      })

      // Eliminar producto
      await tx.product.delete({
        where: { id, businessId },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting product:", error)
    return NextResponse.json(
      { error: "Error al eliminar producto" },
      { status: 500 }
    )
  }
}
