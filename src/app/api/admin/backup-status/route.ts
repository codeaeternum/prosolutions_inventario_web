import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { isoOrNull, readBackupStatus } from "@/lib/backup-status"

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

const noStore = { "Cache-Control": "private, no-store" }

// GET /api/admin/backup-status — estado del backup nocturno del N5. El script
// scripts/backup-n5.ps1 copia last-backup-status.json dentro del volumen
// prosolutions_payment_proofs como .backup-status.json; aquí se lee desde el
// dir de comprobantes (paymentProofDirectory, PAYMENT_PROOFS_DIR).
// Es endpoint de monitoreo: nunca responde 500 por el archivo — si falta o no
// se puede parsear contesta configured:false + stale:true.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const status = await readBackupStatus()
  if (!status.configured || !status.raw) {
    return NextResponse.json(
      { configured: false, ok: false, ageHours: null, stale: true },
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
    },
    { headers: noStore },
  )
}
