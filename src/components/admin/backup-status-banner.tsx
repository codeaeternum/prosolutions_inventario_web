"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, DatabaseBackup } from "lucide-react"
import { formatBackupAge, formatDate } from "@/lib/utils"

// Se re-exporta para no romper imports existentes (la lógica vive en utils
// para que también la use la consola de plataforma, que es server-side).
export { formatBackupAge }

/**
 * Estado del backup nocturno (GET /api/admin/backup-status). El archivo de
 * estado lo escribe scripts/backup-n5.ps1 en el host; la API lo resume así:
 * - fresco:   { configured: true, ok: true, stale: false, ageHours, ... }
 * - atrasado: { configured: true, stale: true } cuando ageHours > 48
 * - falló:    { configured: true, ok: false, stale: false, artifacts }
 * - sin datos: { configured: false, ok: false, stale: true } (archivo ausente)
 * Además trae restoreDrill: el simulacro semanal de restauración del host
 * (scripts/verify-backup-restore.ps1), que restaura el último .pgdump en un
 * postgres efímero. Es indicador secundario: nunca provoca banner por sí solo.
 */
export interface BackupArtifact {
  ok: boolean
  bytes: number
  error: string | null
  // Entradas del TOC del dump verificadas con pg_restore --list (solo db).
  tocEntries?: number | null
}

/** Resumen del simulacro de restauración tal como lo sirve la API. */
export interface RestoreDrillInfo {
  configured: boolean
  ok: boolean
  stale: boolean
  finishedAt: string | null
  ageHours: number | null
  tocEntries?: number | null
  error?: string | null
}

export interface BackupStatusResponse {
  configured: boolean
  ok: boolean
  stale: boolean
  ageHours: number | null
  startedAt?: string | null
  finishedAt?: string | null
  artifacts?: Partial<Record<"db" | "uploads" | "proofs" | "evidence", BackupArtifact>>
  restoreDrill?: RestoreDrillInfo
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
          tocEntries: typeof a.tocEntries === "number" && Number.isFinite(a.tocEntries) ? a.tocEntries : null,
        }
      }
    }
  }

  // El simulacro se añadió después: un payload viejo sin restoreDrill, o un
  // valor no-objeto, se tolera y queda undefined — nunca rompe el parseo.
  let restoreDrill: RestoreDrillInfo | undefined
  const d = raw.restoreDrill
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const drill = d as Record<string, unknown>
    restoreDrill = {
      configured: drill.configured === true,
      ok: drill.ok === true,
      stale: drill.stale === true,
      finishedAt: iso(drill.finishedAt),
      ageHours: typeof drill.ageHours === "number" && Number.isFinite(drill.ageHours) ? drill.ageHours : null,
      tocEntries: typeof drill.tocEntries === "number" && Number.isFinite(drill.tocEntries) ? drill.tocEntries : null,
      error: typeof drill.error === "string" ? drill.error : null,
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
    restoreDrill,
  }
}

export type BackupBannerView =
  | {
      kind: "fresh"
      ageLabel: string
      lastRun: string | null
      tocEntries: number | null
      /** Texto suave del simulacro ("simulacro OK hace 2 días" / "pendiente" / "falló"). */
      drillLabel: string | null
      /** Detalle del simulacro para el tooltip de la línea verde. */
      drillHint: string | null
    }
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

  // El simulacro solo se reporta en la línea del puntito verde: es un
  // indicador semanal y secundario — su retraso o fallo se muestra como
  // texto suave, nunca como banner ámbar/rojo (eso lo decide el backup
  // diario, que en los kinds stale/failed ignora el drill por completo).
  const drill = status.restoreDrill
  let drillLabel: string | null = null
  let drillHint: string | null = null
  if (drill) {
    if (!drill.configured) {
      drillLabel = "simulacro pendiente"
      drillHint = "El simulacro de restauración aún no reporta (corre semanal en el servidor)."
    } else if (!drill.ok) {
      drillLabel = "simulacro falló"
      drillHint = `El último simulacro de restauración falló${drill.finishedAt ? ` (${formatDate(drill.finishedAt)})` : ""}${drill.error ? `: ${drill.error}` : ""}`
    } else if (drill.stale) {
      drillLabel = "simulacro pendiente"
      drillHint = `El simulacro de restauración lleva más de 8 días sin correr${drill.finishedAt ? ` (último: ${formatDate(drill.finishedAt)})` : ""}.`
    } else {
      const age = formatBackupAge(drill.ageHours)
      drillLabel = `simulacro OK${age ? ` ${age}` : ""}`
      drillHint = drill.finishedAt ? `Último simulacro de restauración: ${formatDate(drill.finishedAt)}` : null
    }
  }
  return { kind: "fresh", ageLabel, lastRun, tocEntries: status.artifacts?.db?.tocEntries ?? null, drillLabel, drillHint }
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
    const title = [
      view.lastRun ? `Último respaldo: ${formatDate(view.lastRun)}` : null,
      view.drillHint,
    ].filter(Boolean).join("\n") || undefined
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground" title={title}>
        <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        Respaldo automático al día{view.ageLabel ? ` · último ${view.ageLabel}` : ""}
        {view.tocEntries ? ` · dump verificado (${view.tocEntries.toLocaleString("es-MX")} objetos)` : ""}
        {view.drillLabel ? ` · ${view.drillLabel}` : ""}
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
