/**
 * fix-categories.mjs — Renombra categorías plurales a singular (migración
 * de una vez, antes era POST /api/fix-categories).
 *
 * Uso: DATABASE_URL=... node scripts/fix-categories.mjs --business <slug-o-id>
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

const renames = {
  "Pantallas OLED": "Pantalla OLED",
  "Pantallas LCD": "Pantalla LCD",
  "Baterias": "Batería",
  "Camaras traseras": "Cámara trasera",
  "Camaras frontales": "Cámara frontal",
  "Bocinas": "Bocina",
  "Botones": "Botón",
  "Marcos Housing": "Marco / Housing",
  "Tapas traseras": "Tapa trasera",
  "Conectores": "Conector",
  "Antenas": "Antena",
  "Sensores": "Sensor",
  "Herramientas": "Herramienta",
  "Accesorios": "Accesorio",
  "Micas de cristal": "Mica de cristal",
  "Fundas y Cases": "Funda / Case",
  "Cables y adaptadores": "Cable / Adaptador",
  "Altavoces externos": "Altavoz externo",
}

let updated = 0
let skipped = 0
for (const [oldName, newName] of Object.entries(renames)) {
  const cat = await prisma.category.findFirst({
    where: { businessId, name: { equals: oldName, mode: "insensitive" } },
  })
  if (!cat) { skipped++; continue }
  const exists = await prisma.category.findFirst({
    where: { businessId, name: { equals: newName, mode: "insensitive" }, NOT: { id: cat.id } },
  })
  if (exists) { skipped++; continue }
  await prisma.category.update({ where: { id: cat.id }, data: { name: newName } })
  updated++
}

console.log(`Categorías renombradas. Updated: ${updated}, Skipped: ${skipped}`)
await prisma.$disconnect()
