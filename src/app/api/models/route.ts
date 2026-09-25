import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { getDefaultBusinessId } from "@/lib/settings"
import { prisma } from "@/lib/prisma"
import { recordAudit } from "@/lib/audit"
import { generateSlug } from "@/lib/utils"

const createModelSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  brandId: z.string().min(1, "La marca es requerida"),
})

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const brandId = searchParams.get("brandId")
    const session = await auth()

    const models = await prisma.model.findMany({
      where: { businessId: session ? businessIdOf(session) : await getDefaultBusinessId(), ...(brandId ? { brandId } : {}) },
      include: {
        brand: { select: { name: true } },
        _count: { select: { products: true } },
      },
      orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
    })
    return NextResponse.json(models)
  } catch (error) {
    console.error("Error fetching models:", error)
    return NextResponse.json({ error: "Error al obtener modelos" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const result = await requireModule("inventario")
    if (result.error) return result.error

    const body = await req.json()
    const parseResult = createModelSchema.safeParse(body)
    if (!parseResult.success) {
      const err = parseResult.error.flatten().fieldErrors
      const msg = err.name?.[0] ?? err.brandId?.[0] ?? "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { name, brandId } = parseResult.data
    const session = getSession(result)!
    const businessId = businessIdOf(session)

    // La marca debe pertenecer a esta empresa; una ajena responde como inexistente.
    const brand = await prisma.brand.findFirst({
      where: { id: brandId, businessId },
      select: { id: true },
    })
    if (!brand) {
      return NextResponse.json({ error: "Marca no encontrada" }, { status: 404 })
    }

    const slug = generateSlug(name)

    const existingModel = await prisma.model.findFirst({
      where: { businessId, brandId, slug },
    })

    if (existingModel) {
      return NextResponse.json({ error: "Este modelo ya existe para esta marca" }, { status: 400 })
    }

    const model = await prisma.model.create({
      data: { businessId, name, slug, brandId },
      include: { brand: { select: { name: true } } },
    })

    await recordAudit(prisma, {
      businessId,
      actorId: session.user.id,
      action: "MODEL_CREATE",
      entity: "model",
      entityId: model.id,
      entityName: `${model.brand.name} ${model.name}`,
      summary: `Creó el modelo "${model.brand.name} ${model.name}"`,
    })

    return NextResponse.json(model)
  } catch (error) {
    console.error("Error creating model:", error)
    return NextResponse.json({ error: "Error al crear modelo" }, { status: 500 })
  }
}
