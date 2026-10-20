"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, DatabaseBackup } from "lucide-react"
import { formatDate } from "@/lib/utils"

/**
 * Estado del backup nocturno (GET /api/admin/backup-status). El archivo de
 * estado lo escribe scripts/backup-n5.ps1 en el host; la API lo resume así:
 * - fresco:   { configured: true, ok: true, stale: false, ageHours, ... }
 * - atrasado: { configured: true, stale: true } cuando ageHours > 48
 * - falló:    { configured: true, ok: false, stale: false, artifacts }
 * - sin datos: { configured: false, ok: false, stale: true } (archivo ausente)
 */
export interface BackupArtifact {
  ok: boolean
  bytes: number
  error: string | null
}

export interface BackupStatusResponse {
  configured: boolean
  ok: boolean
  stale: boolean
  ageHours: number | null
  startedAt?: string | null
  finishedAt?: string | null
  artifacts?: Partial<Record<"db" | "uploads" | "proofs" | "evidence", BackupArtifact>>
}

export const BACKUP_ARTIFACT_LABELS = {
  db: "la base de datos",
  uploads: "los archivos subidos",
  proofs: "los comprobantes de pago",
  evidence: "las evidencias del taller",
} as const

/** Valida la respuesta del endpoint: cualquier payload raro se descarta. */
export function parseBackupStatus(json: unknown): BackupStatusResponse | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null
  const raw = json as Record<string, unknown>
  if (typeof raw.ok !== "boolean" || typeof raw.stale !== "boolean") return null

  const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null)
  const artifacts: BackupStatusResponse["artifacts"] = {}
  if (raw.artifacts && typeof raw.artifacts === "object" && !Array.isArray(raw.artifacts)) {
    for (const key of Object.keys(BACKUP_ARTIFACT_LABELS) as (keyof typeof BACKUP_ARTIFACT_LABELS)[]) {
      const a = (raw.artifacts as Record<string, unknown>)[key] as Record<string, unknown> | undefined
      if (a && typeof a === "object") {
        artifacts[key] = {
          ok: a.ok === true,
          bytes: typeof a.bytes === "number" ? a.bytes : 0,
          error: typeof a.error === "string" ? a.error : null,
        }
      }
    }
  }

  return {
    configured: raw.configured === true,
    ok: raw.ok,
    stale: raw.stale,
    ageHours: typeof raw.ageHours === "number" && Number.isFinite(raw.ageHours) ? raw.ageHours : null,
    startedAt: iso(raw.startedAt),
    finishedAt: iso(raw.finishedAt),
    artifacts,
  }
}

/** "hace 3 h" / "hace 2 días"; vacío cuando no hay edad conocida. */
export function formatBackupAge(ageHours: number | null): string {
  if (ageHours === null || !Number.isFinite(ageHours)) return ""
  if (ageHours < 1) return "hace menos de 1 h"
  if (ageHours < 24) return `hace ${Math.floor(ageHours)} h`
  const days = Math.round(ageHours / 24)
  return `hace ${days} ${days === 1 ? "día" : "días"}`
}

export type BackupBannerView =
  | { kind: "fresh"; ageLabel: string; lastRun: string | null }
  | { kind: "stale"; configured: boolean; ageLabel: string; lastRun: string | null; lastFailed: boolean }
  | { kind: "failed"; lastRun: string | null; failedLabels: string[] }

/** Qué se debe pintar según el estado: nada visible -> fresh es solo un puntito. */
export function backupBannerView(status: BackupStatusResponse): BackupBannerView {
  const lastRun = status.finishedAt ?? status.startedAt ?? null
  const ageLabel = formatBackupAge(status.ageHours)
  if (status.stale) {
    return {
      kind: "stale",
      configured: status.configured,
      ageLabel,
      lastRun,
      lastFailed: status.configured && !status.ok,
    }
  }
  if (!status.ok) {
    const failedLabels = (Object.keys(BACKUP_ARTIFACT_LABELS) as (keyof typeof BACKUP_ARTIFACT_LABELS)[])
      .filter((key) => status.artifacts?.[key]?.ok === false)
      .map((key) => BACKUP_ARTIFACT_LABELS[key])
    return { kind: "failed", lastRun, failedLabels }
  }
  return { kind: "fresh", ageLabel, lastRun }
}

const listEs = (items: string[]) =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`

const ACCION = "Revisa la tarea programada del respaldo en el servidor o ejecútalo a mano."

// Aviso del respaldo automático en el dashboard. El page solo lo monta para
// ADMIN; si la consulta falla (red, 401/403) no muestra nada, igual que
// OnboardingCard — es monitoreo, nunca debe estorbar ni parpadear.
export function BackupStatusBanner() {
  // null = cargando / sin respuesta útil -> no se renderiza nada.
  const [status, setStatus] = useState<BackupStatusResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/admin/backup-status", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!controller.signal.aborted) setStatus(parseBackupStatus(json))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  if (!status) return null
  const view = backupBannerView(status)

  // Sano: solo un puntito verde con la edad — la fecha exacta va en el tooltip.
  if (view.kind === "fresh") {
    return (
      <p
        className="flex items-center gap-2 text-xs text-muted-foreground"
        title={view.lastRun ? `Último respaldo: ${formatDate(view.lastRun)}` : undefined}
      >
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        Respaldo automático al día{view.ageLabel ? ` · último ${view.ageLabel}` : ""}
      </p>
    )
  }

  if (view.kind === "stale") {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <p className="font-medium">
            {view.configured
              ? "El respaldo automático lleva más de 48 h sin correr"
              : "El servidor no ha reportado el estado del respaldo"}
          </p>
          <p className="text-xs text-muted-foreground">
            {view.configured && view.lastRun
              ? `Último respaldo: ${formatDate(view.lastRun)}${view.ageLabel ? ` (${view.ageLabel})` : ""}. `
              : "No hay registro de un respaldo exitoso. "}
            {view.lastFailed ? "Además, el último intento terminó con errores. " : ""}
            {ACCION}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3"
    >
      <DatabaseBackup className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="text-sm">
        <p className="font-medium text-destructive">El último respaldo automático falló</p>
        <p className="text-xs text-muted-foreground">
          {view.lastRun ? `Intento del ${formatDate(view.lastRun)}: ` : ""}
          {view.failedLabels.length > 0
            ? `no se pudo respaldar ${listEs(view.failedLabels)}. `
            : "terminó con errores. "}
          {ACCION}
        </p>
      </div>
    </div>
  )
}
