import { promises as fs } from "node:fs"
import path from "node:path"
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { paymentProofDirectory } from "@/lib/payment-proofs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** El backup corre a diario: si el último terminó hace más de 48 h está stale. */
const STALE_AFTER_HOURS = 48
const STATUS_FILENAME = ".backup-status.json"

interface BackupArtifact {
  ok: boolean
  bytes: number
  error: string | null
}

/** El JSON del host trae más campos (host, backupRoot, file absolutos): no se exponen. */
interface BackupStatusFile {
  ok?: unknown
  startedAt?: unknown
  finishedAt?: unknown
  backupRoot?: unknown
  db?: unknown
  uploads?: unknown
  proofs?: unknown
  evidence?: unknown
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/** Quita rutas absolutas del host (D:\Backups\...) de los errores antes de servirlos. */
function scrubPaths(message: string, backupRoot: string): string {
  const out = backupRoot ? message.split(backupRoot).join("<backup>") : message
  return out.replace(/[A-Za-z]:[\\/][^\s"']*/g, "<path>")
}

function artifact(value: unknown, backupRoot: string): BackupArtifact {
  const raw = (value ?? {}) as Record<string, unknown>
  const error = typeof raw.error === "string" && raw.error ? scrubPaths(raw.error, backupRoot) : null
  return { ok: raw.ok === true, bytes: typeof raw.bytes === "number" ? raw.bytes : 0, error }
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

  let status: BackupStatusFile
  try {
    // Set-Content -Encoding UTF8 (Windows PowerShell 5.1) deja BOM; se remueve.
    const raw = (await fs.readFile(path.join(paymentProofDirectory(), STATUS_FILENAME), "utf8")).replace(/^\uFEFF/, "")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("status no es objeto")
    status = parsed as BackupStatusFile
  } catch {
    return NextResponse.json({ configured: false, ok: false, ageHours: null, stale: true }, { headers: noStore })
  }

  const startedAt = isoOrNull(status.startedAt)
  const finishedAt = isoOrNull(status.finishedAt)
  const reference = finishedAt ?? startedAt
  const ageHours = reference === null
    ? null
    : Math.max(0, Math.round(((Date.now() - Date.parse(reference)) / 3_600_000) * 10) / 10)
  const stale = ageHours === null || ageHours > STALE_AFTER_HOURS
  const backupRoot = typeof status.backupRoot === "string" ? status.backupRoot : ""

  return NextResponse.json(
    {
      configured: true,
      ok: status.ok === true,
      startedAt,
      finishedAt,
      ageHours,
      stale,
      artifacts: {
        db: artifact(status.db, backupRoot),
        uploads: artifact(status.uploads, backupRoot),
        proofs: artifact(status.proofs, backupRoot),
        evidence: artifact(status.evidence, backupRoot),
      },
    },
    { headers: noStore },
  )
}
