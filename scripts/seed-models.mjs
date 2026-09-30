/**
 * seed-models.mjs — Siembra modelos Apple (iPhone/iPad) en el catálogo del
 * negocio (antes era POST /api/seed-models).
 *
 * Uso: DATABASE_URL=... node scripts/seed-models.mjs --business <slug-o-id>
 */
import { PrismaClient } from "@prisma/client"

const businessRef = process.argv[process.argv.indexOf("--business") + 1] || null
if (!businessRef || process.argv.indexOf("--business") < 0) {
  console.error("Falta --business <slug-o-id>")
  process.exit(1)
}

const prisma = new PrismaClient()
const business = await prisma.business.findFirst({
  where: { OR: [{ id: businessRef }, { slug: businessRef }] },
  select: { id: true },
})
if (!business) {
  console.error("Negocio no encontrado:", businessRef)
  process.exit(1)
}
const businessId = business.id

let apple = await prisma.brand.findFirst({ where: { businessId, name: { equals: "Apple", mode: "insensitive" } } })
if (!apple) {
  apple = await prisma.brand.create({ data: { businessId, name: "Apple", slug: "apple" } })
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
  const slug = modelName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  const exists = await prisma.model.findFirst({
    where: {
      businessId,
      brandId: apple.id,
      OR: [{ name: { equals: modelName, mode: "insensitive" } }, { slug }],
    },
  })
  if (exists) { skipped++; continue }
  await prisma.model.create({ data: { businessId, name: modelName, slug, brandId: apple.id } })
  created++
}

console.log(`Modelos Apple sembrados. Created: ${created}, Skipped: ${skipped}`)
await prisma.$disconnect()
