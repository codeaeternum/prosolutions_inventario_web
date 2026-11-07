import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { resolvePublicBusinessId } from "@/lib/tenant-resolution"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { generateSlug } from "@/lib/utils"

const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  icon: z.string().max(100).optional().nullable().default(""),
})

export async function GET(req?: Request) {
  try {
    const session = await auth()
    // Anónimo: ?biz=<slug> (o header x-tenant-slug) fija el tenant de la
    // vitrina; slug explícito inválido → 404, no el default ajeno.
    const businessId = session ? businessIdOf(session) : await resolvePublicBusinessId(req)
    if (!businessId) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 })
    const categories = await prisma.category.findMany({
      where: { businessId },
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
    const result = await requireModule("inventario")
    if (result.error) return result.error

    const body = await req.json()
    const parseResult = createCategorySchema.safeParse(body)
    if (!parseResult.success) {
      const msg = parseResult.error.flatten().fieldErrors.name?.[0] ?? "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { name, icon } = parseResult.data
    const session = getSession(result)!
    const businessId = businessIdOf(session)

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

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "CATEGORY_CREATE",
      entity: "category",
      entityId: category.id,
      entityName: category.name,
      summary: `Creó la categoría "${category.name}"`,
    })

    return NextResponse.json(category)
  } catch (error) {
    console.error("Error creating category:", error)
    return NextResponse.json({ error: "Error al crear categoría" }, { status: 500 })
  }
}
