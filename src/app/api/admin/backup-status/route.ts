import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import {
  isoOrNull,
  readBackupStatus,
  readRestoreDrill,
  type RestoreDrillFile,
  type RestoreDrillSummary,
} from "@/lib/backup-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface BackupArtifact {
  ok: boolean
  bytes: number
  error: string | null
  // Entradas del TOC verificadas por `pg_restore --list` (solo el artefacto db).
  tocEntries: number | null
}

/** Quita rutas absolutas del host (D:\Backups\...) de los errores antes de servirlos. */
function scrubPaths(message: string, backupRoot: string): string {
  const out = backupRoot ? message.split(backupRoot).join("<backup>") : message
  return out.replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>")
}

function artifact(value: unknown, backupRoot: string): BackupArtifact {
  const raw = (value ?? {}) as Record<string, unknown>
  const error = typeof raw.error === "string" && raw.error ? scrubPaths(raw.error, backupRoot) : null
  return {
    ok: raw.ok === true,
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    error,
    tocEntries: typeof raw.tocEntries === "number" && Number.isFinite(raw.tocEntries) ? raw.tocEntries : null,
  }
}

interface RestoreDrillResponse {
  configured: boolean
  ok: boolean
  finishedAt: string | null
  ageHours: number | null
  stale: boolean
  tocEntries: number | null
  error: string | null
}

/**
 * Resumen del simulacro de restauración semanal: misma regla que artifact(),
 * el `error` viaja con las rutas del host ya fregadas (dumpFile/backupRoot y
 * demás campos internos del archivo no salen nunca en la respuesta).
 */
function drillSummary(drill: RestoreDrillSummary & { raw?: RestoreDrillFile }): RestoreDrillResponse {
  const backupRoot = typeof drill.raw?.backupRoot === "string" ? drill.raw.backupRoot : ""
  const rawError = drill.raw?.error
  const error = typeof rawError === "string" && rawError ? scrubPaths(rawError, backupRoot) : null
  return {
    configured: drill.configured,
    ok: drill.ok,
    finishedAt: drill.finishedAt,
    ageHours: drill.ageHours,
    stale: drill.stale,
    tocEntries: drill.tocEntries,
    error,
  }
}

const noStore = { "Cache-Control": "private, no-store" }

// GET /api/admin/backup-status — estado del backup nocturno del N5 más el
// simulacro semanal de restauración. Los scripts del host copian sus JSON
// dentro del volumen prosolutions_payment_proofs como .backup-status.json y
// .restore-drill.json; aquí se leen desde el dir de comprobantes
// (paymentProofDirectory, PAYMENT_PROOFS_DIR).
// Es endpoint de monitoreo: nunca responde 500 por los archivos — si faltan o
// no se pueden parsear contesta configured:false + stale:true en cada parte.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const [status, drill] = await Promise.all([readBackupStatus(), readRestoreDrill()])
  const restoreDrill = drillSummary(drill)
  if (!status.configured || !status.raw) {
    return NextResponse.json(
      { configured: false, ok: false, ageHours: null, stale: true, restoreDrill },
      { headers: noStore },
    )
  }

  const raw = status.raw
  const backupRoot = typeof raw.backupRoot === "string" ? raw.backupRoot : ""
  const startedAt = isoOrNull(raw.startedAt)

  return NextResponse.json(
    {
      configured: true,
      ok: status.ok,
      startedAt,
      finishedAt: status.finishedAt,
      ageHours: status.ageHours,
      stale: status.stale,
      artifacts: {
        db: artifact(raw.db, backupRoot),
        uploads: artifact(raw.uploads, backupRoot),
        proofs: artifact(raw.proofs, backupRoot),
        evidence: artifact(raw.evidence, backupRoot),
      },
      restoreDrill,
    },
    { headers: noStore },
  )
}
