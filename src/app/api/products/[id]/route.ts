import { auth } from "@/lib/auth"
import { productDto, isCatalogStaff, catalogResponseHeaders } from "@/lib/product-dto"
import { NextRequest, NextResponse } from "next/server"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getDefaultBusinessId } from "@/lib/settings"
import { prisma } from "@/lib/prisma"
import { releaseStock, takeStock } from "@/lib/domain/operations"
import { syncLowStockAlerts } from "@/lib/low-stock"
import { diffChanges, money, recordAudit } from "@/lib/audit"
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
    const result = await requireModule("inventario")
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
      internalPrice,
      costPrice,
      marketVisibility,
      stock,
      minStock,
      images,
      isUniversal,
      isActive,
      categoryId,
      modelIds,
      stockBranchId,
    } = body

    if (!name || !categoryId) {
      return NextResponse.json(
        { error: "Nombre y categoría son requeridos" },
        { status: 400 }
      )
    }
    const parsedRetail = parseFloat(retailPrice)
    if (!Number.isFinite(parsedRetail) || parsedRetail < 0) {
      return NextResponse.json(
        { error: "El precio público es requerido" },
        { status: 400 }
      )
    }
    // Precio aliado vacío = mismo que el público (la mayoría de piezas no se
    // venden a aliados). Un 0 explícito sí se respeta.
    const parsedWholesale =
      wholesalePrice === undefined || wholesalePrice === null || wholesalePrice === ""
        ? parsedRetail
        : parseFloat(wholesalePrice)
    if (!Number.isFinite(parsedWholesale) || parsedWholesale < 0) {
      return NextResponse.json(
        { error: "El precio aliado no es válido" },
        { status: 400 }
      )
    }

    if (!isUniversal && (!modelIds || modelIds.length === 0)) {
      return NextResponse.json(
        { error: "Selecciona al menos un modelo o marca como universal" },
        { status: 400 }
      )
    }

    // La categoría, los modelos y la sucursal deben pertenecer a esta empresa.
    const category = await prisma.category.findFirst({
      where: { id: categoryId, businessId },
      select: { id: true },
    })
    if (!category) {
      return NextResponse.json(
        { error: "Categoría no encontrada" },
        { status: 404 }
      )
    }
    if (!isUniversal) {
      const ownedModels = await prisma.model.count({
        where: { id: { in: modelIds }, businessId },
      })
      if (ownedModels !== modelIds.length) {
        return NextResponse.json(
          { error: "Uno o más modelos no existen" },
          { status: 400 }
        )
      }
    }
    if (stockBranchId && !await prisma.branch.findFirst({ where: { id: stockBranchId, businessId }, select: { id: true } })) {
      return NextResponse.json(
        { error: "Sucursal no encontrada" },
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
    // nunca como valor absoluto sobre el total. Campo vacío/ausente = sin
    // ajuste (evita NaN y evita que un campo vacío dispare un ajuste a 0).
    const parsedStock = stock === undefined || stock === null || stock === "" ? null : parseInt(stock, 10)
    if (parsedStock !== null && (!Number.isFinite(parsedStock) || parsedStock < 0)) {
      return NextResponse.json(
        { error: "Las existencias no son válidas" },
        { status: 400 }
      )
    }
    const stockDiff = parsedStock === null ? 0 : parsedStock - existingProduct.stock
    const parsedMinStock = minStock === undefined || minStock === null || minStock === "" ? existingProduct.minStock : parseInt(minStock, 10)
    if (!Number.isFinite(parsedMinStock) || parsedMinStock < 0) {
      return NextResponse.json(
        { error: "El stock mínimo no es válido" },
        { status: 400 }
      )
    }
    // El costo solo lo define el dueño: un empleado que mande otro valor lo
    // pisa el precio existente (su formulario ni siquiera lo muestra).
    const isAdmin = session.user.role === "ADMIN"
    const parsedCostPrice = !isAdmin
      ? existingProduct.costPrice
      : (costPrice != null && costPrice !== "") ? parseFloat(costPrice) : null
    // internalPrice ausente conserva el valor actual; "" o null lo limpian
    // (la pieza vuelve a cobrarse al público en órdenes propias).
    const parsedInternalPrice = internalPrice === undefined
      ? existingProduct.internalPrice
      : (internalPrice != null && internalPrice !== "") ? parseFloat(internalPrice) : null
    // Publicar al mercado es decisión del dueño: si un empleado manda el
    // campo se ignora y se conserva la visibilidad actual.
    const parsedVisibility = !isAdmin || marketVisibility === undefined
      ? existingProduct.marketVisibility
      : ["HIDDEN", "ALLIES", "PUBLIC"].includes(marketVisibility) ? marketVisibility : null
    if (parsedVisibility === null) {
      return NextResponse.json({ error: "Visibilidad inválida (HIDDEN, ALLIES o PUBLIC)" }, { status: 400 })
    }
    const editor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { homeBranchId: true } })

    // Actualizar producto y modelos en transacción
    const product = await prisma.$transaction(async (tx: TransactionClient) => {
      // Eliminar relaciones de modelos existentes
      await tx.productModel.deleteMany({
        where: { productId: id },
      })

      // Track price changes
      const priceFields = [
        { field: "retailPrice", oldVal: existingProduct.retailPrice, newVal: parsedRetail },
        { field: "wholesalePrice", oldVal: existingProduct.wholesalePrice, newVal: parsedWholesale },
        { field: "internalPrice", oldVal: existingProduct.internalPrice ?? 0, newVal: parsedInternalPrice ?? 0 },
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
          retailPrice: parsedRetail,
          wholesalePrice: parsedWholesale,
          internalPrice: parsedInternalPrice,
          costPrice: parsedCostPrice,
          marketVisibility: parsedVisibility,
          minStock: parsedMinStock,
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
          : (await takeStock(tx, { productId: id, quantity: -stockDiff, branchId: stockBranchId ?? editor?.homeBranchId, businessId })).branch
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

    // Bitácora: antes→después de los campos editables. Las llaves del diff
    // van en español porque el resumen se muestra tal cual al dueño.
    const auditBefore = {
      nombre: existingProduct.name,
      codigoBarras: existingProduct.barcode,
      precio: existingProduct.retailPrice,
      aliado: existingProduct.wholesalePrice,
      tallerPropio: existingProduct.internalPrice,
      costo: existingProduct.costPrice,
      stock: existingProduct.stock,
      stockMinimo: existingProduct.minStock,
      activo: existingProduct.isActive,
      universal: existingProduct.isUniversal,
      categoriaId: existingProduct.categoryId,
      descripcion: existingProduct.description,
    }
    const auditAfter = {
      nombre: name,
      codigoBarras: barcode || null,
      precio: parsedRetail,
      aliado: parsedWholesale,
      tallerPropio: parsedInternalPrice,
      costo: parsedCostPrice,
      stock: existingProduct.stock + stockDiff,
      stockMinimo: parsedMinStock,
      activo: isActive ?? true,
      universal: isUniversal ?? false,
      categoriaId: categoryId,
      descripcion: description || null,
    }
    const changes = diffChanges(auditBefore, auditAfter, Object.keys(auditAfter))
    if (changes) {
      const parts: string[] = []
      if (changes.precio) parts.push(`Precio ${money(existingProduct.retailPrice)} → ${money(auditAfter.precio)}`)
      if (changes.costo) parts.push(`Costo ${money(existingProduct.costPrice)} → ${money(auditAfter.costo)}`)
      if (changes.aliado) parts.push(`Aliado ${money(existingProduct.wholesalePrice)} → ${money(auditAfter.aliado)}`)
      if (changes.tallerPropio) parts.push(`Taller propio ${money(existingProduct.internalPrice)} → ${money(auditAfter.tallerPropio)}`)
      if (changes.nombre) parts.push(`Nombre "${existingProduct.name}" → "${name}"`)
      if (changes.activo) parts.push(auditAfter.activo ? "Reactivado" : "Desactivado")
      if (changes.stock) parts.push(`Stock ${existingProduct.stock} → ${auditAfter.stock}`)
      if (changes.stockMinimo) parts.push(`Stock mínimo ${existingProduct.minStock} → ${auditAfter.stockMinimo}`)
      if (changes.categoriaId) parts.push("Cambió de categoría")
      if (changes.codigoBarras) parts.push("Cambió el código de barras")
      if (changes.universal) parts.push(auditAfter.universal ? "Marcado como universal" : "Dejó de ser universal")
      if (changes.descripcion) parts.push("Cambió la descripción")
      if (parts.length === 0) parts.push("Editó el producto")
      await recordAudit(prisma, {
        businessId,
        actorId: session.user.id,
        action: "PRODUCT_UPDATE",
        entity: "product",
        entityId: id,
        entityName: existingProduct.name,
        summary: parts.join(" · "),
        changes,
      })
    }

    // Post-commit: revisa stock bajo tanto por el ajuste de existencias como
    // por un cambio de minStock (subir el mínimo puede cruzar el umbral solo).
    await syncLowStockAlerts(prisma, businessId, [id])
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
    const result = await requireModule("inventario")
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

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "PRODUCT_DELETE",
      entity: "product",
      entityId: id,
      entityName: existingProduct.name,
      summary: `Eliminó "${existingProduct.name}" · Precio ${money(existingProduct.retailPrice)}`,
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
