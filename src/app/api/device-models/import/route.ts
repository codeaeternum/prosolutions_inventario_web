import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
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
  // "global" (default) = catálogo de plataforma, solo superadmin;
  // "tenant" = catálogo privado del negocio del admin que importa.
  scope: z.enum(["global", "tenant"]).default("global"),
})

// Separador NUL: no puede aparecer en texto CSV y evita colisiones al
// concatenar marca+modelo en la clave de deduplicación.
const keyOf = (brand: string, model: string) => `${brand}\u0000${model}`

// POST /api/device-models/import — importación masiva de modelos de equipo.
// scope="global" (default): catálogo compartido por todos los tenants, solo
// superadmin de plataforma. scope="tenant": catálogo privado del negocio del
// admin autenticado.
// mode="upsert": body.rows trae las filas ya parseadas
// (máx. 20,000). mode="bundled": lee prisma/seed-data/device-models.json del
// disco del servidor, útil para resembrar la base incluida sin correr el script.
export async function POST(req: Request) {
  try {
    // Primero staff autenticado; el scope decide la elevación después.
    const auth = await requireModule("taller")
    if (auth.error) return auth.error
    const session = getSession(auth)!

    const { rows, mode, scope } = bodySchema.parse(await req.json())

    // scope="global": solo superadmin de plataforma. scope="tenant": solo el
    // admin del negocio — su businessId sale de la sesión, nunca del body.
    let businessId: string | null
    if (scope === "tenant") {
      if (session.user.role !== "ADMIN") {
        return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
      }
      businessId = businessIdOf(session)
    } else {
      if (session.user.isSuperAdmin !== true) {
        return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
      }
      businessId = null
    }

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

    // Por lotes de 500.
    // Scope tenant: upsert por la clave compuesta (businessId, brand, model) —
    // primero se consultan las claves ya presentes para distinguir creados de
    // actualizados.
    // Scope global: businessId NULL hace que @@unique no deduplique (Postgres
    // NULL != NULL); hay que hacer findFirst + create/update por fila dentro
    // de la transacción — el índice parcial DeviceModel_global_brand_model_key
    // protege la carrera.
    let created = 0
    let updated = 0
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE)
      if (businessId === null) {
        await prisma.$transaction(async tx => {
          for (const row of batch) {
            const found = await tx.deviceModel.findFirst({
              where: { businessId: null, brand: row.brand, model: row.model },
              select: { id: true },
            })
            if (found) {
              updated += 1
              await tx.deviceModel.update({
                where: { id: found.id },
                // En actualización solo se pisan código/tipo si la fila los
                // trae, para no borrar datos cuando el CSV solo tiene
                // marca y modelo.
                data: {
                  ...(row.code !== null ? { code: row.code } : {}),
                  ...(row.type !== null ? { type: row.type } : {}),
                },
              })
            } else {
              created += 1
              await tx.deviceModel.create({
                data: { businessId: null, brand: row.brand, model: row.model, code: row.code, type: row.type ?? "SMARTPHONE" },
              })
            }
          }
        }, { timeout: 30_000 })
      } else {
        const tenantId: string = businessId
        const existing = await prisma.deviceModel.findMany({
          where: {
            businessId: tenantId,
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
              where: { businessId_brand_model: { businessId: tenantId, brand: row.brand, model: row.model } },
              create: { businessId: tenantId, brand: row.brand, model: row.model, code: row.code, type: row.type ?? "SMARTPHONE" },
              update: {
                ...(row.code !== null ? { code: row.code } : {}),
                ...(row.type !== null ? { type: row.type } : {}),
              },
            })
          }),
          { timeout: 30_000 },
        )
      }
    }

    return NextResponse.json({ created, updated, skipped, errors })
  } catch (error) { return businessFailure(error) }
}
