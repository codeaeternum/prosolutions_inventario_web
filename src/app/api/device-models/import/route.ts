import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSuperAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { businessFailure } from "@/lib/domain/http"

const MAX_ROWS = 20_000
const BATCH_SIZE = 500
const MAX_ERRORS = 10

// Una fila del CSV: marca,modelo,codigo,tipo (código y tipo opcionales).
const rowSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(120),
  code: z.string().trim().max(60).nullish(),
  type: z.string().trim().max(40).nullish(),
})

const bodySchema = z.object({
  rows: z.array(z.unknown()).max(MAX_ROWS).optional(),
  mode: z.enum(["upsert", "bundled"]).default("upsert"),
})

// Separador NUL: no puede aparecer en texto CSV y evita colisiones al
// concatenar marca+modelo en la clave de deduplicación.
const keyOf = (brand: string, model: string) => `${brand}\u0000${model}`

// POST /api/device-models/import — importación masiva del catálogo GLOBAL de
// modelos de equipo (solo superadmin de plataforma: el catálogo es compartido
// por todos los tenants y un admin de tenant no debe pisarlo).
// mode="upsert": body.rows trae las filas ya parseadas
// (máx. 20,000). mode="bundled": lee prisma/seed-data/device-models.json del
// disco del servidor, útil para resembrar la base incluida sin correr el script.
// Upsert por la clave única (brand, model) en transacciones de 500 filas.
export async function POST(req: Request) {
  try {
    const auth = await requireSuperAdmin()
    if (auth.error) return auth.error

    const { rows, mode } = bodySchema.parse(await req.json())

    let source: unknown[]
    if (mode === "bundled") {
      const filePath = join(process.cwd(), "prisma", "seed-data", "device-models.json")
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: "No se encontró la base de datos incluida en el servidor." }, { status: 404 })
      }
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: "La base de datos incluida no tiene el formato esperado." }, { status: 400 })
      }
      source = parsed
    } else {
      if (!rows || rows.length === 0) {
        return NextResponse.json({ error: "No hay filas para importar." }, { status: 400 })
      }
      source = rows
    }

    // Validación fila a fila: las inválidas o duplicadas dentro del archivo se
    // omiten y se reportan (máx. 10 errores). La deduplicación es por
    // marca+modelo normalizados, igual que la clave única del modelo.
    const valid: { brand: string; model: string; code: string | null; type: string | null }[] = []
    const errors: { row: number; message: string }[] = []
    const seen = new Set<string>()
    let skipped = 0
    source.forEach((raw, index) => {
      const line = index + 1
      const parsed = rowSchema.safeParse(raw)
      if (!parsed.success) {
        skipped += 1
        if (errors.length < MAX_ERRORS) {
          errors.push({ row: line, message: parsed.error.issues[0]?.message ?? "Fila inválida" })
        }
        return
      }
      const key = keyOf(parsed.data.brand.toLowerCase(), parsed.data.model.toLowerCase())
      if (seen.has(key)) {
        skipped += 1
        if (errors.length < MAX_ERRORS) {
          errors.push({ row: line, message: `Duplicada en el archivo: ${parsed.data.brand} ${parsed.data.model}` })
        }
        return
      }
      seen.add(key)
      valid.push({
        brand: parsed.data.brand,
        model: parsed.data.model,
        code: parsed.data.code || null,
        type: parsed.data.type || null,
      })
    })

    // Por lotes de 500: primero se consultan las claves (brand, model) ya
    // presentes para distinguir creados de actualizados, luego se hace upsert
    // de todo el lote en una sola transacción.
    let created = 0
    let updated = 0
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE)
      const existing = await prisma.deviceModel.findMany({
        where: {
          brand: { in: [...new Set(batch.map(row => row.brand))] },
          model: { in: [...new Set(batch.map(row => row.model))] },
        },
        select: { brand: true, model: true },
      })
      const existingKeys = new Set(existing.map(item => keyOf(item.brand, item.model)))
      await prisma.$transaction(
        batch.map(row => {
          if (existingKeys.has(keyOf(row.brand, row.model))) updated += 1
          else created += 1
          return prisma.deviceModel.upsert({
            where: { brand_model: { brand: row.brand, model: row.model } },
            create: { brand: row.brand, model: row.model, code: row.code, type: row.type ?? "SMARTPHONE" },
            // En actualización solo se pisan código/tipo si la fila los trae,
            // para no borrar datos cuando el CSV solo tiene marca y modelo.
            update: {
              ...(row.code !== null ? { code: row.code } : {}),
              ...(row.type !== null ? { type: row.type } : {}),
            },
          })
        }),
        { timeout: 30_000 },
      )
    }

    return NextResponse.json({ created, updated, skipped, errors })
  } catch (error) { return businessFailure(error) }
}
