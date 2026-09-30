/**
 * fix-catalog.mjs — Repara nombres/categorías del catálogo (antes era
 * GET/POST /api/fix-catalog). Corrige "IPhone"→"iPhone", género de colores
 * en "Pantalla" (Blanco→Blanca) y asignación LCD/OLED.
 *
 * Uso:
 *   DATABASE_URL=... node scripts/fix-catalog.mjs --business <slug-o-id>           (dry-run)
 *   DATABASE_URL=... node scripts/fix-catalog.mjs --business <slug-o-id> --apply   (aplica)
 */
import { PrismaClient } from "@prisma/client"

const businessRef = process.argv[process.argv.indexOf("--business") + 1] || null
if (!businessRef || process.argv.indexOf("--business") < 0) {
  console.error("Falta --business <slug-o-id>")
  process.exit(1)
}
const apply = process.argv.includes("--apply")

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

// LCD-only models: these never have OLED screens
// iPhone 11 (base, no Pro) is LCD, but 11 Pro/Pro Max is OLED
const LCD_MODELS_REGEX = /iPhone\s+(5|5s|5c|SE|6|6s|6\s*Plus|7|7\s*Plus|8|8\s*Plus|XR|SE\s*[23]?)\b/i
function isLCDModel(name) {
  if (/iPhone\s+11\b/i.test(name) && !/iPhone\s+11\s*Pro/i.test(name)) return true
  return LCD_MODELS_REGEX.test(name)
}

function fixProductName(name) {
  let fixed = name.trim()
  fixed = fixed.replace(/\b[Ii]Phone\b/g, "iPhone")
  if (fixed.startsWith("Pantalla")) {
    fixed = fixed.replace(/\bBlanco\s*$/i, "Blanca")
    fixed = fixed.replace(/\bNegros?\s*$/i, "Negra")
    fixed = fixed.replace(/\bNegro\s*$/i, "Negra")
  }
  return fixed
}

const products = await prisma.product.findMany({ where: { businessId }, include: { category: true } })
const lcdCategory = await prisma.category.findFirst({ where: { businessId, name: { contains: "LCD", mode: "insensitive" } } })
const oledCategory = await prisma.category.findFirst({ where: { businessId, name: { contains: "OLED", mode: "insensitive" } } })

const fixes = []
let updated = 0
for (const p of products) {
  const newName = fixProductName(p.name)
  let categoryChange
  let newCategoryId

  if (newName.startsWith("Pantalla") && p.category) {
    const shouldBeLCD = isLCDModel(newName) && !newName.toLowerCase().includes("oled")
    const isOLED = p.category.name.toLowerCase().includes("oled")
    const isLCD = p.category.name.toLowerCase().includes("lcd")
    if (shouldBeLCD && isOLED && lcdCategory) {
      categoryChange = { from: p.category.name, to: lcdCategory.name }
      newCategoryId = lcdCategory.id
    }
    const shouldBeOLED = /iPhone\s+(X(?!\w)|XS|XS\s*Max|1[1-6]\s*Pro|12|13|14|15|16)/i.test(newName) && !shouldBeLCD
    if (shouldBeOLED && isLCD && oledCategory) {
      categoryChange = { from: p.category.name, to: oledCategory.name }
      newCategoryId = oledCategory.id
    }
  }

  if (newName !== p.name || newCategoryId) {
    fixes.push({ id: p.id, oldName: p.name, newName, categoryChange })
    if (apply) {
      const data = {}
      if (newName !== p.name) data.name = newName
      if (newCategoryId) data.categoryId = newCategoryId
      await prisma.product.update({ where: { id: p.id, businessId }, data })
      updated++
    }
  }
}

console.log(JSON.stringify({ mode: apply ? "APPLIED" : "DRY_RUN", totalProducts: products.length, fixesNeeded: fixes.length, updated, fixes }, null, 2))
await prisma.$disconnect()
