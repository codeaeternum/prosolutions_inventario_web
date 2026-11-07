import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { resolvePublicBusinessId } from "@/lib/tenant-resolution"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { generateSlug } from "@/lib/utils"

const createBrandSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  logo: z.string().max(500).optional().nullable().default(""),
})

export async function GET(req?: Request) {
  try {
    const session = await auth()
    // Anónimo: ?biz=<slug> (o header x-tenant-slug) fija el tenant de la
    // vitrina; slug explícito inválido → 404, no el default ajeno.
    const businessId = session ? businessIdOf(session) : await resolvePublicBusinessId(req)
    if (!businessId) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 })
    const brands = await prisma.brand.findMany({
      where: { businessId },
      include: {
        _count: { select: { models: true } },
      },
      orderBy: { name: "asc" },
    })
    return NextResponse.json(brands)
  } catch (error) {
    console.error("Error fetching brands:", error)
    return NextResponse.json({ error: "Error al obtener marcas" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const result = await requireModule("inventario")
    if (result.error) return result.error

    const body = await req.json()
    const parseResult = createBrandSchema.safeParse(body)
    if (!parseResult.success) {
      const msg = parseResult.error.flatten().fieldErrors.name?.[0] ?? "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { name, logo } = parseResult.data
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    const slug = generateSlug(name)

    const existingBrand = await prisma.brand.findFirst({
      where: { businessId, OR: [{ name }, { slug }] },
    })

    if (existingBrand) {
      return NextResponse.json({ error: "Esta marca ya existe" }, { status: 400 })
    }

    const brand = await prisma.brand.create({
      data: { businessId, name, slug, logo: logo || null },
    })

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "BRAND_CREATE",
      entity: "brand",
      entityId: brand.id,
      entityName: brand.name,
      summary: `Creó la marca "${brand.name}"`,
    })

    return NextResponse.json(brand)
  } catch (error) {
    console.error("Error creating brand:", error)
    return NextResponse.json({ error: "Error al crear marca" }, { status: 500 })
  }
}
