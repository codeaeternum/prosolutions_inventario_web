import type { PrismaClient } from "@prisma/client"

/**
 * Retención de bitácoras (AuditEvent por tenant + PlatformEvent global).
 * Compartida entre el endpoint HTTP /api/cron/purge-events y el cron
 * diario del bot — ambos usan la misma lógica con su propio cliente Prisma.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function retentionDays(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export function auditRetentionDays(): number {
  return retentionDays(process.env.AUDIT_RETENTION_DAYS, 90, 30, 365)
}

export function platformRetentionDays(): number {
  return retentionDays(process.env.PLATFORM_RETENTION_DAYS, 365, 90, 730)
}

export interface EventPurgeResult {
  auditDeleted: number
  platformDeleted: number
  auditCutoff: Date
  platformCutoff: Date
}

export async function purgeOldEvents(db: PrismaClient): Promise<EventPurgeResult> {
  const now = Date.now()
  const auditCutoff = new Date(now - auditRetentionDays() * DAY_MS)
  const platformCutoff = new Date(now - platformRetentionDays() * DAY_MS)

  const [audit, platform] = await Promise.all([
    db.auditEvent.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
    db.platformEvent.deleteMany({ where: { createdAt: { lt: platformCutoff } } }),
  ])

  return {
    auditDeleted: audit.count,
    platformDeleted: platform.count,
    auditCutoff,
    platformCutoff,
  }
}
