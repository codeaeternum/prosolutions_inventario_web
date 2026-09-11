import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// POST /api/seed-models — Seed all Apple iPhone and iPad models
export async function POST() {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    // Ensure Apple brand exists
    let apple = await prisma.brand.findFirst({ where: { name: { equals: "Apple", mode: "insensitive" } } })
    if (!apple) {
      apple = await prisma.brand.create({
        data: { name: "Apple", slug: "apple" },
      })
    }

    const models = [
      // iPhones
      "iPhone 16 Pro Max", "iPhone 16 Pro", "iPhone 16 Plus", "iPhone 16",
      "iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15 Plus", "iPhone 15",
      "iPhone 14 Pro Max", "iPhone 14 Pro", "iPhone 14 Plus", "iPhone 14",
      "iPhone 13 Pro Max", "iPhone 13 Pro", "iPhone 13 mini", "iPhone 13",
      "iPhone 12 Pro Max", "iPhone 12 Pro", "iPhone 12 mini", "iPhone 12",
      "iPhone 11 Pro Max", "iPhone 11 Pro", "iPhone 11",
      "iPhone SE (3ra gen)", "iPhone SE (2da gen)",
      "iPhone XS Max", "iPhone XS", "iPhone XR", "iPhone X",
      "iPhone 8 Plus", "iPhone 8",
      "iPhone 7 Plus", "iPhone 7",
      "iPhone 6s Plus", "iPhone 6s",
      // iPads
      "iPad Pro 13\" M4", "iPad Pro 11\" M4",
      "iPad Pro 12.9\" (6ta gen)", "iPad Pro 11\" (4ta gen)",
      "iPad Air 13\" M3", "iPad Air 11\" M3",
      "iPad Air (5ta gen)",
      "iPad 10a gen", "iPad 9a gen", "iPad 8a gen",
      "iPad mini 7", "iPad mini 6",
    ]

    let created = 0
    let skipped = 0

    for (const modelName of models) {
      const slug = modelName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")

      const exists = await prisma.model.findFirst({
        where: {
          brandId: apple.id,
          OR: [
            { name: { equals: modelName, mode: "insensitive" } },
            { slug },
          ],
        },
      })

      if (exists) {
        skipped++
        continue
      }

      await prisma.model.create({
        data: {
          name: modelName,
          slug,
          brandId: apple.id,
        },
      })
      created++
    }

    return NextResponse.json({
      message: `Apple models seeded. Created: ${created}, Skipped (already exist): ${skipped}.`,
      created,
      skipped,
    })
  } catch (error) {
    console.error("Error seeding models:", error)
    return NextResponse.json({ error: "Error al sembrar modelos" }, { status: 500 })
  }
}
