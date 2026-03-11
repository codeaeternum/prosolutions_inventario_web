import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

// GET /api/products/[id] - Get single product
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const product = await prisma.product.findUnique({
      where: { id },
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

    if (!product) {
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

    return NextResponse.json(transformedProduct)
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

    const { id } = await params
    const body = await req.json()
    const {
      name,
      description,
      barcode,
      retailPrice,
      wholesalePrice,
      stock,
      minStock,
      images,
      isPublic,
      isUniversal,
      isActive,
      categoryId,
      modelIds,
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
      where: { id },
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

    // Calcular diferencia de stock para movimiento de inventario
    const stockDiff = parseInt(stock) - existingProduct.stock

    // Actualizar producto y modelos en transacción
    const product = await prisma.$transaction(async (tx: TransactionClient) => {
      // Eliminar relaciones de modelos existentes
      await tx.productModel.deleteMany({
        where: { productId: id },
      })

      // Actualizar producto
      const updatedProduct = await tx.product.update({
        where: { id },
        data: {
          name,
          description: description || null,
          barcode: barcode || null,
          retailPrice: parseFloat(retailPrice),
          wholesalePrice: parseFloat(wholesalePrice),
          stock: parseInt(stock),
          minStock: parseInt(minStock),
          images: images || [],
          isPublic: isPublic ?? false,
          isUniversal: isUniversal ?? false,
          isActive: isActive ?? true,
          categoryId,
          models: isUniversal
            ? undefined
            : {
                create: modelIds.map((modelId: string) => ({
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

      // Crear movimiento de inventario si hubo cambio de stock
      if (stockDiff !== 0) {
        await tx.inventoryMovement.create({
          data: {
            productId: id,
            type: stockDiff > 0 ? "IN" : "OUT",
            quantity: Math.abs(stockDiff),
            previousStock: existingProduct.stock,
            newStock: parseInt(stock),
            reason: "ADJUSTMENT",
            notes: "Ajuste manual de stock desde edición de producto",
            userId: session.user.id,
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

    const { id } = await params

    // Verificar que el producto existe
    const existingProduct = await prisma.product.findUnique({
      where: { id },
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
        where: { productId: id },
      })

      // Eliminar movimientos de inventario
      await tx.inventoryMovement.deleteMany({
        where: { productId: id },
      })

      // Eliminar reservas (solo las completadas/canceladas)
      await tx.reservation.deleteMany({
        where: { productId: id },
      })

      // Eliminar producto
      await tx.product.delete({
        where: { id },
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
