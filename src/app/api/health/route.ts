import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"
import { prisma } from "@/lib/prisma"
import { paymentProofDirectory } from "@/lib/payment-proofs"

export const dynamic = "force-dynamic"

// Mínimo de espacio libre en el volumen de comprobantes: por debajo de esto
// las subidas de evidencia/comprobantes empiezan a fallar a mitad de operación.
const MIN_FREE_BYTES = 500 * 1024 * 1024

interface DiskHealth {
  ok: boolean
  writable: boolean
  /** Bytes libres para un usuario sin privilegios (bavail*bsize); null si no se pudo medir. */
  freeBytes: number | null
  minFreeBytes: number
}

/**
 * Salud del storage de comprobantes de pago (PAYMENT_PROOFS_DIR — el mismo
 * path que usa writePaymentProof). Un statfs + access es barato (~µs, sin
 * I/O de datos): seguro correrlo en cada healthcheck.
 *
 * Se hace mkdir -p primero — igual que writePaymentProof — porque el
 * directorio puede no existir antes del primer upload (volumen recién
 * montado); lo que se mide es "¿podría escribirse ahora?", no "¿existe ya?".
 * El path absoluto NO se devuelve: el endpoint es público y no hace falta
 * filtrar la estructura del filesystem para monitorearlo.
 */
async function checkProofsDisk(): Promise<DiskHealth> {
  const directory = paymentProofDirectory()
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const stats = await fs.statfs(directory)
    const freeBytes = Number(stats.bavail) * Number(stats.bsize)
    await fs.access(directory, fs.constants.W_OK)
    return { ok: freeBytes >= MIN_FREE_BYTES, writable: true, freeBytes, minFreeBytes: MIN_FREE_BYTES }
  } catch {
    // Sin statfs/acceso no se puede asegurar que el storage sirva: degradado.
    return { ok: false, writable: false, freeBytes: null, minFreeBytes: MIN_FREE_BYTES }
  }
}

export async function GET() {
  const timestamp = new Date().toISOString()
  const headers = { "Cache-Control": "no-store" }
  const disk = await checkProofsDisk()
  try {
    // Validate critical tables and the required migration, without exposing records.
    const [failedMigrations] = await prisma.$transaction([
      // A missing _prisma_migrations table or a failed row means the schema was
      // not created with `migrate deploy` (or a migration is stuck): not ready.
      prisma.$queryRaw`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NULL LIMIT 1`,
      prisma.$queryRaw`SELECT "id", "stock" FROM "Product" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "businessVersion", "paymentMethod" FROM "InventoryMovement" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "version", "status" FROM "RepairOrder" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "type" FROM "RepairEvent" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "role", "status" FROM "User" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "status", "businessVersion" FROM "Reservation" LIMIT 0`,
      prisma.$queryRaw`SELECT "key", "requestHash", "response" FROM "BusinessOperation" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "amount" FROM "CreditMovement" LIMIT 0`,
      prisma.$queryRaw`SELECT "id", "amount" FROM "CashMovement" LIMIT 0`,
    ])
    if (Array.isArray(failedMigrations) && failedMigrations.length > 0) {
      return NextResponse.json(
        { status: "degraded", ok: false, schema: "migration_failed", disk, timestamp },
        { status: 503, headers },
      )
    }
    if (!disk.ok) {
      // Disco lleno o no escribible: el schema puede estar listo pero las
      // subidas de comprobantes/evidencias fallarían — el servicio no está sano.
      return NextResponse.json(
        { status: "degraded", ok: false, schema: "ready", disk, timestamp },
        { status: 503, headers },
      )
    }
    return NextResponse.json({ status: "ok", ok: true, schema: "ready", disk, timestamp }, { headers })
  } catch {
    return NextResponse.json(
      { status: "degraded", ok: false, schema: "unavailable", disk, timestamp },
      { status: 503, headers },
    )
  }
}
