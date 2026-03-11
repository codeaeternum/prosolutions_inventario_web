import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { generateSlug } from "@/lib/utils"

const createBrandSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(200),
  logo: z.string().max(500).optional().nullable().default(""),
})

export async function GET() {
  try {
    const brands = await prisma.brand.findMany({
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
    const result = await requireAdmin()
    if (result.error) return result.error

    const body = await req.json()
    const parseResult = createBrandSchema.safeParse(body)
    if (!parseResult.success) {
      const msg = parseResult.error.flatten().fieldErrors.name?.[0] ?? "Datos inválidos"
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    const { name, logo } = parseResult.data

    const slug = generateSlug(name)

    const existingBrand = await prisma.brand.findFirst({
      where: { OR: [{ name }, { slug }] },
    })

    if (existingBrand) {
      return NextResponse.json({ error: "Esta marca ya existe" }, { status: 400 })
    }

    const brand = await prisma.brand.create({
      data: { name, slug, logo: logo || null },
    })

    return NextResponse.json(brand)
  } catch (error) {
    console.error("Error creating brand:", error)
    return NextResponse.json({ error: "Error al crear marca" }, { status: 500 })
  }
}
