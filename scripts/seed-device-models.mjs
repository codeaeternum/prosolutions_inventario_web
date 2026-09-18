#!/usr/bin/env node
// Carga el catálogo GLOBAL de modelos de dispositivo (marca/modelo/código) desde
// prisma/seed-data/device-models.json — fuente: bsthen/device-models (Apache-2.0,
// derivado de la lista pública de dispositivos soportados de Google Play).
// Idempotente: dedup por (businessId NULL, brand, model) — el índice único
// compuesto no cubre filas globales (Postgres NULL != NULL), así que se hace
// findFirst + create/update por fila.
// Prisma 7 usa driver adapters: PrismaClient necesita PrismaPg + pg.Pool.
// Uso: node scripts/seed-device-models.mjs
import "dotenv/config"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const models = JSON.parse(readFileSync(join(root, "prisma/seed-data/device-models.json"), "utf8"))

const connectionString = process.env.DATABASE_URL ||
  "postgresql://prosolutions:prosolutions123@localhost:5432/prosolutions_db"
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const BATCH = 200
let processed = 0
let created = 0
let updated = 0
for (let i = 0; i < models.length; i += BATCH) {
  const batch = models.slice(i, i + BATCH)
  await prisma.$transaction(async tx => {
    for (const { brand, model, code, type } of batch) {
      const existing = await tx.deviceModel.findFirst({
        where: { businessId: null, brand, model },
        select: { id: true },
      })
      if (existing) {
        updated += 1
        await tx.deviceModel.update({ where: { id: existing.id }, data: { code: code ?? undefined, type } })
      } else {
        created += 1
        await tx.deviceModel.create({ data: { businessId: null, brand, model, code, type } })
      }
    }
  }, { timeout: 30_000 })
  processed += batch.length
  console.log(`…${processed}/${models.length} (${created} nuevos, ${updated} actualizados)`)
}
console.log(`Listo: ${created} creados, ${updated} actualizados (${models.length} en archivo)`)
await prisma.$disconnect()
await pool.end()
