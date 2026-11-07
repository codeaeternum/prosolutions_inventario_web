import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { reconcileDelegations } from "@/lib/domain/delegation-reconcile"

/**
 * GET /api/cron/reconcile-delegations — Reconciliación de delegaciones
 * cross-tenant (orden local del captador ↔ orden espejo del taller).
 *
 * La delegación escribe en DOS commits (espejo en el tenant reparador, marca
 * en la local): un fallo intermedio deja vínculos divergentes que la
 * idempotencia solo cubre si alguien reintenta. Este barrido detecta
 * espejos faltantes/huérfanas, marcas incompletas y estados divergentes —
 * NO corrige nada: devuelve los issues y deja un RepairEvent privado de
 * alerta en cada orden afectada (dedupe 24 h). La reparación es manual.
 *
 * `?dry=1` corre el barrido sin escribir las alertas (solo reporta).
 * Antigüedad de divergencia: DELEGATION_RECONCILE_STALE_DAYS (default 7d).
 *
 * Auth: igual que /api/cron/purge-events — CRON_SECRET por
 * `Authorization: Bearer` o `x-cron-secret` con timingSafeEqual.
 * El bot corre el mismo barrido a diario (04:35) vía reconcileDelegations().
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

  const dry = ["1", "true"].includes(new URL(req.url).searchParams.get("dry") ?? "")

  try {
    const result = await reconcileDelegations(prisma, { annotate: !dry })
    console.log(
      `[cron:reconcile-delegations] checked=${result.checked} issues=${result.issues.length} annotated=${result.annotated}${dry ? " (dry)" : ""}`
    )
    if (result.issues.length > 0) {
      console.warn("[cron:reconcile-delegations] issues:", result.issues)
    }
    return NextResponse.json({ ok: true, dry, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron:reconcile-delegations] error: ${message}`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = GET
