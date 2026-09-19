import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getDefaultBusinessId } from "@/lib/settings"
import { prisma } from "@/lib/prisma"
import { generateSlug } from "@/lib/utils"

const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  icon: z.string().max(100).optional().nullable().default(""),
})

export async function GET() {
  try {
    const session = await auth()
    const categories = await prisma.category.findMany({
      where: { businessId: session ? businessIdOf(session) : await getDefaultBusinessId() },
      include: {
        _count: { select: { products: true } },
      },
      orderBy: { name: "asc" },
    })
    return NextResponse.json(categories)
  } catch (error) {
    console.error("Error fetching categories:", error)
    return NextResponse.json({ error: "Error al obtener categorías" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const result = await requireModule("productos")
    if (result.error) return result.error

    const body = await req.json()
    const parseResult = createCategorySchema.safeParse(body)
    if (!parseResult.success) {
      const msg = parseResult.error.flatten().fieldErrors.name?.[0] ?? "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { name, icon } = parseResult.data
    const businessId = businessIdOf(getSession(result)!)

    const slug = generateSlug(name)

    const existingCategory = await prisma.category.findFirst({
      where: { businessId, OR: [{ name }, { slug }] },
    })

    if (existingCategory) {
      return NextResponse.json({ error: "Esta categoría ya existe" }, { status: 400 })
    }

    const category = await prisma.category.create({
      data: { businessId, name, slug, icon: icon || null },
    })

    return NextResponse.json(category)
  } catch (error) {
    console.error("Error creating category:", error)
    return NextResponse.json({ error: "Error al crear categoría" }, { status: 500 })
  }
}
