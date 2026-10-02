import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import {
  findPendingSignupCandidates,
  pendingSignupDays,
  purgePendingSignups,
} from "@/lib/pending-signup-purge"

/**
 * GET /api/cron/purge-pending-signups — Purga altas de negocio abandonadas.
 *
 * /api/signup crea el Business + su User ADMIN con status=PENDING hasta que
 * verifique correo o teléfono. Un owner PENDING no puede loguearse, así que
 * si TODOS los users del tenant siguen ADMIN+PENDING después de N días, el
 * alta nunca operó y solo contiene filas semilla (User, SystemSettings,
 * WorkshopService, Branch) + cascadas (VerificationCode, DeviceModel,
 * Notification/NotificationRead). Esas altas de broma/basura se borran aquí.
 *
 * Antigüedad configurable con SIGNUP_PENDING_PURGE_DAYS (default 7, mín. 1).
 * `?dry=1` lista los candidatos sin borrar nada. La misma lógica corre diario
 * dentro del bot (node-cron) — este endpoint sirve para forzarla a mano y
 * para schedulers externos.
 *
 * Auth: igual que /api/reservations/check-expiring — CRON_SECRET por
 * `Authorization: Bearer` o `x-cron-secret` con timingSafeEqual.
 */

const DAY_MS = 24 * 60 * 60 * 1000

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

  const days = pendingSignupDays()
  const dry = ["1", "true"].includes(new URL(req.url).searchParams.get("dry") ?? "")

  if (dry) {
    const { purgeable, skipped } = await findPendingSignupCandidates(prisma, days)
    const now = Date.now()
    return NextResponse.json({
      dry: true,
      pendingDays: days,
      candidates: purgeable.map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        createdAt: b.createdAt,
        pendingDays: Math.floor((now - b.createdAt.getTime()) / DAY_MS),
      })),
      skipped,
    })
  }

  const { purged, skipped, tenants } = await purgePendingSignups(prisma, days)
  return NextResponse.json({ purged, skipped, tenants })
}

export const POST = GET
