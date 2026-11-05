import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * GET /api/cron/purge-events — Retención de bitácoras: borra eventos viejos.
 *
 *   - AuditEvent    → AUDIT_RETENTION_DAYS    (default 90,  clamp 30–365)
 *   - PlatformEvent → PLATFORM_RETENTION_DAYS (default 365, clamp 90–730)
 *
 * Auth: igual que /api/cron/purge-pending-signups — CRON_SECRET por
 * `Authorization: Bearer` o `x-cron-secret` con timingSafeEqual.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function retentionDays(raw: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: "Cron no configurado" }, { status: 503 })
  }
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer /, "") ??
    req.headers.get("x-cron-secret") ??
    ""
  const a = Buffer.from(expected)
  const b = Buffer.from(provided)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const auditDays = retentionDays(process.env.AUDIT_RETENTION_DAYS, 90, 30, 365)
  const platformDays = retentionDays(process.env.PLATFORM_RETENTION_DAYS, 365, 90, 730)
  const now = Date.now()
  const auditCutoff = new Date(now - auditDays * DAY_MS)
  const platformCutoff = new Date(now - platformDays * DAY_MS)

  try {
    const [audit, platform] = await Promise.all([
      prisma.auditEvent.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
      prisma.platformEvent.deleteMany({ where: { createdAt: { lt: platformCutoff } } }),
    ])
    console.log(
      `[cron:purge-events] auditDeleted=${audit.count} platformDeleted=${platform.count} ` +
        `auditCutoff=${auditCutoff.toISOString()} platformCutoff=${platformCutoff.toISOString()}`
    )
    return NextResponse.json({
      ok: true,
      auditDeleted: audit.count,
      platformDeleted: platform.count,
      auditCutoff,
      platformCutoff,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron:purge-events] error: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
