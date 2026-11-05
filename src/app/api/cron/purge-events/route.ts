import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { purgeOldEvents } from "@/lib/event-retention"

/**
 * GET /api/cron/purge-events — Retención de bitácoras: borra eventos viejos.
 *
 *   - AuditEvent    → AUDIT_RETENTION_DAYS    (default 90,  clamp 30–365)
 *   - PlatformEvent → PLATFORM_RETENTION_DAYS (default 365, clamp 90–730)
 *
 * Auth: igual que /api/cron/purge-pending-signups — CRON_SECRET por
 * `Authorization: Bearer` o `x-cron-secret` con timingSafeEqual.
 * El bot corre la misma purga a diario vía purgeOldEvents() — este
 * endpoint es el disparo manual/externo.
 */
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

  try {
    const result = await purgeOldEvents(prisma)
    console.log(
      `[cron:purge-events] auditDeleted=${result.auditDeleted} platformDeleted=${result.platformDeleted} ` +
        `auditCutoff=${result.auditCutoff.toISOString()} platformCutoff=${result.platformCutoff.toISOString()}`
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron:purge-events] error: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
