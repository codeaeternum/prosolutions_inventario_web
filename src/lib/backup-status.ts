import { promises as fs } from "node:fs"
import path from "node:path"
import { paymentProofDirectory } from "@/lib/payment-proofs"

/**
 * Lectura del status JSON que deja scripts/backup-n5.ps1: el script corre en
 * el host (N5) y copia last-backup-status.json dentro del volumen
 * prosolutions_payment_proofs como .backup-status.json. Compartido entre
 * GET /api/admin/backup-status (tenant) y getPlatformHealth (plataforma).
 */

export const BACKUP_STALE_AFTER_HOURS = 48
export const BACKUP_STATUS_FILENAME = ".backup-status.json"

export interface BackupStatusSummary {
  /** false cuando el archivo no existe/ilegible — backup aún no configurado. */
  configured: boolean
  ok: boolean
  finishedAt: string | null
  /** Edad del último respaldo terminado (o iniciado), una cifra decimal. */
  ageHours: number | null
  stale: boolean
}

export interface BackupStatusFile {
  ok?: unknown
  startedAt?: unknown
  finishedAt?: unknown
  backupRoot?: unknown
  db?: unknown
  uploads?: unknown
  proofs?: unknown
  evidence?: unknown
}

export function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/** Nunca lanza: archivo ausente/corrupto → configured:false + stale:true. */
export async function readBackupStatus(): Promise<BackupStatusSummary & { raw?: BackupStatusFile }> {
  let status: BackupStatusFile
  try {
    // Set-Content -Encoding UTF8 (Windows PowerShell 5.1) deja BOM; se remueve.
    const raw = (await fs.readFile(path.join(paymentProofDirectory(), BACKUP_STATUS_FILENAME), "utf8")).replace(/^\uFEFF/, "")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("status no es objeto")
    status = parsed as BackupStatusFile
  } catch {
    return { configured: false, ok: false, finishedAt: null, ageHours: null, stale: true }
  }

  const finishedAt = isoOrNull(status.finishedAt)
  const startedAt = isoOrNull(status.startedAt)
  const reference = finishedAt ?? startedAt
  const ageHours = reference === null
    ? null
    : Math.max(0, Math.round(((Date.now() - Date.parse(reference)) / 3_600_000) * 10) / 10)

  return {
    configured: true,
    ok: status.ok === true,
    finishedAt,
    ageHours,
    stale: ageHours === null || ageHours > BACKUP_STALE_AFTER_HOURS,
    raw: status,
  }
}
