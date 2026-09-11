// Preflight de arranque para la imagen de producción (Dockerfile, stage runner).
//
// La imagen final NO incluye Prisma CLI a propósito: el esquema se aplica con
// `prisma migrate deploy` desde la imagen dedicada "migrate" (Dockerfile target
// migrate / servicio migrate del compose) ANTES de promover la app.
//
// Este script falla de forma visible (exit 1) si la base de datos no está
// migrada, en lugar de arrancar una app que luego responde errores. Verifica:
//   1. La BD acepta conexiones (con reintentos cortos para arranques en frío).
//   2. _prisma_migrations existe y no tiene migraciones fallidas.
//   3. Existen las tablas/columnas que cubren TODAS las migraciones actuales.
// Si todo está listo, cede el control a server.js (Next standalone) dentro del
// mismo proceso, conservando node como PID 1 para el manejo de señales.
//
// Remediación cuando falla:
//   docker compose -f docker-compose.yml --profile migrate run --rm migrate
//   (o el paso equivalente documentado en PORTAINER-STACK.md)

import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { Pool } = require("pg")

const CONNECT_ATTEMPTS = 15
const CONNECT_RETRY_MS = 2000

// Debe cubrir la migración más reciente; si se agregan migraciones nuevas,
// añadir aquí un objeto que esa migración cree.
const REQUIRED_TABLES = [
  "User",
  "Brand",
  "Model",
  "Category",
  "Product",
  "ProductModel",
  "PriceHistory",
  "Reservation",
  "InventoryMovement",
  "CreditMovement",
  "Settings",
  "SystemSettings",
  "PushSubscription",
  "CashRegister",
  "CashMovement",
  "BusinessOperation", // 20260911000000_transactional_operations
  "WorkshopBranch", // 20260911020000_workshop_pilot
  "RepairOrder", // 20260911020000_workshop_pilot
  "RepairEvent", // 20260911020000_workshop_pilot
]

const REQUIRED_COLUMNS = [
  ["Reservation", "businessVersion"], // 20260911000000
  ["InventoryMovement", "businessVersion"], // 20260911010000_sale_metadata
  ["InventoryMovement", "paymentMethod"], // 20260911010000_sale_metadata
]

const REQUIRED_ENUM_VALUES = [
  ["CreditMovementType", "REVERSAL"], // 20260911030000_credit_reversals
]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fail(message) {
  console.error(`[preflight] ERROR: ${message}`)
  console.error(
    "[preflight] La base de datos no está migrada. Aplica el paso de migración " +
      "documentado (servicio/imagen 'migrate' → prisma migrate deploy) y vuelve a arrancar."
  )
  process.exit(1)
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    fail("DATABASE_URL no está definida en el entorno del contenedor.")
  }

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 })

  let client
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      client = await pool.connect()
      break
    } catch (err) {
      console.error(
        `[preflight] PostgreSQL no responde (intento ${attempt}/${CONNECT_ATTEMPTS}): ${err.message}`
      )
      if (attempt === CONNECT_ATTEMPTS) {
        await pool.end().catch(() => {})
        fail("No fue posible conectar a PostgreSQL.")
      }
      await sleep(CONNECT_RETRY_MS)
    }
  }

  try {
    // Migraciones registradas y sin fallos pendientes.
    let failedRows = null
    try {
      const res = await client.query(
        'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NULL'
      )
      failedRows = res.rows
    } catch {
      fail('No existe "_prisma_migrations": la BD no fue creada con prisma migrate deploy.')
    }
    if (failedRows.length > 0) {
      const names = failedRows.map((r) => r.migration_name).join(", ")
      fail(`Hay migraciones fallidas sin resolver: ${names}. Revisa los logs del servicio migrate.`)
    }

    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [REQUIRED_TABLES]
    )
    const present = new Set(tables.rows.map((r) => r.table_name))
    const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t))
    if (missingTables.length > 0) {
      fail(`Faltan tablas requeridas: ${missingTables.join(", ")}.`)
    }

    const columns = await client.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"
    )
    const presentCols = new Set(columns.rows.map((r) => `${r.table_name}.${r.column_name}`))
    const missingCols = REQUIRED_COLUMNS.filter(([t, c]) => !presentCols.has(`${t}.${c}`))
    if (missingCols.length > 0) {
      fail(`Faltan columnas requeridas: ${missingCols.map(([t, c]) => `${t}.${c}`).join(", ")}.`)
    }

    for (const [typeName, label] of REQUIRED_ENUM_VALUES) {
      const res = await client.query(
        "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 AND e.enumlabel = $2",
        [typeName, label]
      )
      if (res.rows.length === 0) {
        fail(`Falta el valor '${label}' en el enum ${typeName}. Ejecuta las migraciones pendientes.`)
      }
    }
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }

  console.log("[preflight] Esquema verificado; iniciando servidor.")
  await import(new URL("../server.js", import.meta.url))
}

main().catch((err) => {
  console.error(`[preflight] ERROR inesperado: ${err?.stack || err}`)
  process.exit(1)
})
