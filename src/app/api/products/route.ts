import { auth } from "@/lib/auth"
import { productDto, isCatalogStaff, catalogResponseHeaders } from "@/lib/product-dto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { assertOperationBranch, getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getDefaultBusinessId } from "@/lib/settings"
import { prisma } from "@/lib/prisma"
import { BusinessError, operation, operationKeySchema, releaseStock } from "@/lib/domain/operations"
import { businessFailure } from "@/lib/domain/http"
import { syncLowStockAlerts } from "@/lib/low-stock"
import { money, recordAudit } from "@/lib/audit"

const createProductSchema = z
  .object({
    name: z.string().min(1, "El nombre es requerido").max(500),
    description: z.string().max(2000).optional().nullable().default(""),
    barcode: z.string().max(100).optional().nullable().default(""),
    retailPrice: z.coerce.number().min(0, "Precio al público debe ser ≥ 0"),
    wholesalePrice: z.coerce.number().min(0, "Precio al mayoreo debe ser ≥ 0"),
    costPrice: z.coerce.number().min(0, "Precio de costo debe ser ≥ 0").optional().nullable(),
    stock: z.coerce.number().int().min(0).default(0),
    minStock: z.coerce.number().int().min(0).default(1),
    images: z.array(z.string().max(2000)).optional().default([]),
    isUniversal: z.boolean().optional().default(false),
    categoryId: z.string().min(1, "La categoría es requerida"),
    modelIds: z.array(z.string().min(1)).optional().default([]),
    stockBranchId: z.string().min(1).optional(),
    idempotencyKey: operationKeySchema.optional(),
  })
  .refine((data) => data.isUniversal || (data.modelIds && data.modelIds.length > 0), {
    message: "Selecciona al menos un modelo o marca como universal",
    path: ["modelIds"],
  })

export async function GET(req: Request) {
  try {
    const viewerSession = await auth()
    const viewer = viewerSession?.user
    const businessId = viewerSession ? businessIdOf(viewerSession) : await getDefaultBusinessId()
    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get("categoryId")
    const modelId = searchParams.get("modelId")
    const brandId = searchParams.get("brandId")
    const search = searchParams.get("search")
    const lowStock = searchParams.get("lowStock") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20", 10) || 20))

    if (lowStock && !isCatalogStaff(viewer)) return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })

    const where = {
      businessId,
      isActive: true,
      ...(categoryId && { categoryId }),
      ...(modelId && {
        OR: [
          { models: { some: { modelId } } },
          { isUniversal: true },
        ],
      }),
      ...(brandId && {
        models: { some: { model: { brandId } } },
      }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { barcode: { contains: search, mode: "insensitive" as const } },
          { description: { contains: search, mode: "insensitive" as const } },
          { category: { name: { contains: search, mode: "insensitive" as const } } },
          { models: { some: { model: { brand: { name: { contains: search, mode: "insensitive" as const } } } } } },
          { models: { some: { model: { name: { contains: search, mode: "insensitive" as const } } } } },
        ],
      }),
    }

    const include = {
      models: {
        include: {
          model: { include: { brand: true } },
        },
      },
      category: true,
      _count: { select: { reservations: true } },
      // Existencias por sucursal (productDto las expone sólo a staff).
      ...(isCatalogStaff(viewer) ? { stocks: { where: { businessId }, include: { branch: { select: { id: true, name: true } } } } } : {}),
    }

    if (lowStock) {
      // lowStock se filtra en JS (no se puede comparar columnas en Prisma)
      const all = await prisma.product.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
      })
      const filtered = all.filter((p) => p.stock <= p.minStock)
      const total = filtered.length
      const products = filtered.slice((page - 1) * limit, page * limit)
      const totalPages = Math.ceil(total / limit) || 1
      return NextResponse.json({
        products: products.map(p => productDto(p, viewer)),
        total,
        page,
        limit,
        totalPages,
      }, { headers: catalogResponseHeaders })
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ])

    const totalPages = Math.ceil(total / limit) || 1
    return NextResponse.json({
      products: products.map(p => productDto(p, viewer)),
      total,
      page,
      limit,
      totalPages,
    }, { headers: catalogResponseHeaders })
  } catch (error) {
    console.error("Error fetching products:", error)
    return NextResponse.json({ error: "Error al obtener productos" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const result = await requireModule("productos")
    if (result.error) return result.error
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const body = await req.json()
    const parseResult = createProductSchema.safeParse(body)
    if (!parseResult.success) {
      const flat = parseResult.error.flatten()
      const msg =
        flat.formErrors[0] ??
        flat.fieldErrors.name?.[0] ??
        flat.fieldErrors.categoryId?.[0] ??
        flat.fieldErrors.modelIds?.[0] ??
        flat.fieldErrors.retailPrice?.[0] ??
        flat.fieldErrors.wholesalePrice?.[0] ??
        "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
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
      categoryId,
      modelIds,
      stockBranchId,
      idempotencyKey,
    } = parseResult.data

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

    // La existencia inicial entra a una sucursal (stockBranchId ?? homeBranch).
    if (stock > 0) {
      const denied = await assertOperationBranch(session, stockBranchId)
      if (denied) return denied
    }

    const creator = await prisma.user.findUnique({ where: { id: session.user.id }, select: { homeBranchId: true } })
    // Idempotente: la captura rápida manda idempotencyKey para que un
    // doble-submit/reintento no duplique el producto. El recibo se crea junto
    // al producto en la misma transacción; sin llave del cliente se genera una
    // desechable (mismo comportamiento de siempre, pero la escritura queda
    // auditada en BusinessOperation como el resto de operaciones del dominio).
    const createdResult = await operation(prisma, {
      key: idempotencyKey ?? `product-${crypto.randomUUID()}`,
      actorId: session.user.id,
      businessId,
      kind: "PRODUCT_CREATE",
      permission: "staff",
      payload: parseResult.data,
    }, async tx => {
      // Dentro de la operación: un reintento con la misma llave devuelve el
      // recibo guardado sin volver a evaluar el barcode (que ya existe porque
      // ESTA operación lo creó).
      if (barcode) {
        const existingProduct = await tx.product.findFirst({
          where: { barcode, businessId },
          select: { id: true },
        })
        if (existingProduct) {
          throw new BusinessError("Ya existe un producto con este código de barras", 400)
        }
      }

      const created = await tx.product.create({
        data: {
          businessId,
          name,
          description: description || null,
          barcode: barcode || null,
          retailPrice,
          wholesalePrice,
          costPrice: costPrice ?? null,
          stock: 0,
          minStock,
          images,
          isUniversal: isUniversal || false,
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

      // La existencia inicial entra a UNA sucursal vía el dominio.
      if (stock > 0) {
        const branch = await releaseStock(tx, { productId: created.id, quantity: stock, branchId: stockBranchId ?? creator?.homeBranchId, businessId })
        await tx.inventoryMovement.create({
          data: {
            businessId,
            productId: created.id,
            type: "IN",
            quantity: stock,
            previousStock: 0,
            newStock: stock,
            reason: "Stock inicial",
            userId: session.user.id,
            branchId: branch.id,
            businessVersion: 1,
          },
        })
      }

      // Bitácora dentro del work de la operación: el evento comitea con el
      // producto y un reintento con la misma llave NO duplica el registro
      // (en replay la respuesta se sirve del recibo sin re-ejecutar work).
      await recordAudit(tx, {
        businessId,
        actorId: session.user.id,
        action: "PRODUCT_CREATE",
        entity: "product",
        entityId: created.id,
        entityName: created.name,
        summary: `Alta de producto · Precio ${money(created.retailPrice)}${stock > 0 ? ` · Stock inicial ${stock}` : ""}`,
      })
      return { product: created }
    })

    // Post-commit: un producto que nace bajo mínimo también avisa.
    await syncLowStockAlerts(prisma, businessId, [createdResult.product.id])
    return NextResponse.json(createdResult.product)
  } catch (error) {
    if (error instanceof BusinessError) return businessFailure(error)
    console.error("Error creating product:", error)
    return NextResponse.json({ error: "Error al crear producto" }, { status: 500 })
  }
}
