#!/usr/bin/env node
// Carga el catálogo de modelos de dispositivo (marca/modelo/código) desde
// prisma/seed-data/device-models.json — fuente: bsthen/device-models (Apache-2.0,
// derivado de la lista pública de dispositivos soportados de Google Play).
// Idempotente: upsert por (brand, model). Uso: node scripts/seed-device-models.mjs
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const models = JSON.parse(readFileSync(join(root, "prisma/seed-data/device-models.json"), "utf8"))
const prisma = new PrismaClient()

const BATCH = 200
let upserted = 0
for (let i = 0; i < models.length; i += BATCH) {
  await prisma.$transaction(
    models.slice(i, i + BATCH).map(({ brand, model, code, type }) =>
      prisma.deviceModel.upsert({
        where: { brand_model: { brand, model } },
        create: { brand, model, code, type },
        update: { code: code ?? undefined, type },
      }),
    ),
  )
  upserted += Math.min(BATCH, models.length - i)
  console.log(`…${upserted}/${models.length}`)
}
console.log(`Listo: ${upserted} modelos en catálogo`)
await prisma.$disconnect()
