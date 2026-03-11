import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const createProductSchema = z
  .object({
    name: z.string().min(1, "El nombre es requerido").max(500),
    description: z.string().max(2000).optional().nullable().default(""),
    barcode: z.string().max(100).optional().nullable().default(""),
    retailPrice: z.coerce.number().min(0, "Precio al público debe ser ≥ 0"),
    wholesalePrice: z.coerce.number().min(0, "Precio al mayoreo debe ser ≥ 0"),
    stock: z.coerce.number().int().min(0).default(0),
    minStock: z.coerce.number().int().min(0).default(1),
    images: z.array(z.string().max(2000)).optional().default([]),
    isPublic: z.boolean().optional().default(false),
    isUniversal: z.boolean().optional().default(false),
    categoryId: z.string().min(1, "La categoría es requerida"),
    modelIds: z.array(z.string().min(1)).optional().default([]),
  })
  .refine((data) => data.isUniversal || (data.modelIds && data.modelIds.length > 0), {
    message: "Selecciona al menos un modelo o marca como universal",
    path: ["modelIds"],
  })

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const categoryId = searchParams.get("categoryId")
    const modelId = searchParams.get("modelId")
    const brandId = searchParams.get("brandId")
    const search = searchParams.get("search")
    const lowStock = searchParams.get("lowStock") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20", 10) || 20))

    const where = {
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
        products,
        total,
        page,
        limit,
        totalPages,
      })
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
      products,
      total,
      page,
      limit,
      totalPages,
    })
  } catch (error) {
    console.error("Error fetching products:", error)
    return NextResponse.json({ error: "Error al obtener productos" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error
    const session = getSession(result)!

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
      stock,
      minStock,
      images,
      isPublic,
      isUniversal,
      categoryId,
      modelIds,
    } = parseResult.data

    // Check if barcode already exists
    if (barcode) {
      const existingProduct = await prisma.product.findUnique({
        where: { barcode },
      })
      if (existingProduct) {
        return NextResponse.json(
          { error: "Ya existe un producto con este código de barras" },
          { status: 400 }
        )
      }
    }

    const product = await prisma.product.create({
      data: {
        name,
        description: description || null,
        barcode: barcode || null,
        retailPrice,
        wholesalePrice,
        stock,
        minStock,
        images,
        isPublic: isPublic || false,
        isUniversal: isUniversal || false,
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

    // Create initial inventory movement
    if (product.stock > 0) {
      await prisma.inventoryMovement.create({
        data: {
          productId: product.id,
          type: "IN",
          quantity: product.stock,
          previousStock: 0,
          newStock: product.stock,
          reason: "Stock inicial",
          userId: session.user.id,
        },
      })
    }

    return NextResponse.json(product)
  } catch (error) {
    console.error("Error creating product:", error)
    return NextResponse.json({ error: "Error al crear producto" }, { status: 500 })
  }
}
