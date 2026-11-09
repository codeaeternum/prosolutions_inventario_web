import { promises as fs } from "node:fs"
import path from "node:path"
import { paymentProofDirectory } from "@/lib/payment-proofs"

/**
 * Lectura de los status JSON que dejan los scripts del host (N5):
 * - scripts/backup-n5.ps1 copia last-backup-status.json dentro del volumen
 *   prosolutions_payment_proofs como .backup-status.json (diario).
 * - scripts/verify-backup-restore.ps1 copia last-restore-drill.json como
 *   .restore-drill.json en el mismo volumen (simulacro semanal: restaura el
 *   último .pgdump en un postgres efímero y cuenta filas de tablas críticas).
 * Compartido entre GET /api/admin/backup-status (tenant) y getPlatformHealth
 * (plataforma).
 */

export const BACKUP_STALE_AFTER_HOURS = 48
export const BACKUP_STATUS_FILENAME = ".backup-status.json"
// El simulacro es semanal: 8 días (192 h) deja margen sobre los 7 esperados.
export const RESTORE_DRILL_STALE_AFTER_HOURS = 192
export const RESTORE_DRILL_FILENAME = ".restore-drill.json"

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

export interface RestoreDrillSummary {
  /** false cuando el archivo no existe/ilegible — simulacro aún no configurado. */
  configured: boolean
  ok: boolean
  finishedAt: string | null
  /** Edad del último simulacro terminado, una cifra decimal. */
  ageHours: number | null
  stale: boolean
  /** Entradas del TOC del dump restaurado (pg_restore --list). */
  tocEntries: number | null
}

/** Shape real de last-restore-drill.json (scripts/verify-backup-restore.ps1). */
export interface RestoreDrillFile {
  ok?: unknown
  startedAt?: unknown
  finishedAt?: unknown
  host?: unknown
  backupRoot?: unknown
  dumpFile?: unknown
  dumpBytes?: unknown
  tocEntries?: unknown
  container?: unknown
  tables?: unknown
  error?: unknown
  durationSec?: unknown
}

/**
 * Estado del simulacro de restauración semanal. Nunca lanza: archivo
 * ausente/corrupto → configured:false + stale:true. A diferencia del backup
 * diario, la edad se calcula solo sobre finishedAt: el script siempre lo
 * escribe al terminar (en el finally), incluso cuando el simulacro falla.
 */
export async function readRestoreDrill(): Promise<RestoreDrillSummary & { raw?: RestoreDrillFile }> {
  let drill: RestoreDrillFile
  try {
    // Mismo origen que .backup-status.json: Set-Content UTF8 deja BOM.
    const raw = (await fs.readFile(path.join(paymentProofDirectory(), RESTORE_DRILL_FILENAME), "utf8")).replace(/^﻿/, "")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("drill no es objeto")
    drill = parsed as RestoreDrillFile
  } catch {
    return { configured: false, ok: false, finishedAt: null, ageHours: null, stale: true, tocEntries: null }
  }

  const finishedAt = isoOrNull(drill.finishedAt)
  const ageHours = finishedAt === null
    ? null
    : Math.max(0, Math.round(((Date.now() - Date.parse(finishedAt)) / 3_600_000) * 10) / 10)

  return {
    configured: true,
    ok: drill.ok === true,
    finishedAt,
    ageHours,
    stale: ageHours === null || ageHours > RESTORE_DRILL_STALE_AFTER_HOURS,
    tocEntries: typeof drill.tocEntries === "number" && Number.isFinite(drill.tocEntries) ? drill.tocEntries : null,
    raw: drill,
  }
}
