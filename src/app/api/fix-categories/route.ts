import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// POST /api/fix-categories — Rename all categories to singular form (one-time migration)
export async function POST() {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const renames: Record<string, string> = {
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
        where: { name: { equals: oldName, mode: "insensitive" } },
      })
      if (cat) {
        // Check if target name already exists (avoid unique constraint)
        const exists = await prisma.category.findFirst({
          where: { name: { equals: newName, mode: "insensitive" }, NOT: { id: cat.id } },
        })
        if (exists) {
          skipped++
          continue
        }
        await prisma.category.update({
          where: { id: cat.id },
          data: { name: newName },
        })
        updated++
      } else {
        skipped++
      }
    }

    return NextResponse.json({
      message: `Categories renamed to singular. Updated: ${updated}, Skipped: ${skipped}`,
      updated,
      skipped,
    })
  } catch (error) {
    console.error("Error fixing categories:", error)
    return NextResponse.json({ error: "Error al renombrar categorías" }, { status: 500 })
  }
}
