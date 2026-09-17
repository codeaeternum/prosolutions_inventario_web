import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordDirectoryEvent } from "@/lib/directory-events"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { isValidSlug } from "@/lib/slug-rules"

/**
 * POST /api/directory/events — Telemetría pública del directorio.
 *
 * Solo acepta { kind: "click", slug }: los clicks a vitrinas se reportan
 * desde el cliente (sendBeacon / fetch keepalive en directory-track.ts).
 * Las búsquedas se registran server-side en /api/directory/products y las
 * solicitudes en su propio flujo — ninguna pasa por aquí.
 *
 * El slug se valida contra el directorio real (Business isActive &&
 * showInDirectory) antes de guardar: un slug suspendido o inexistente no
 * genera evento. Respuesta siempre vacía (204) con no-store — el cliente
 * nunca espera ni muestra nada de vuelta.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const

const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 60

const eventSchema = z.object({
  kind: z.literal("click"),
  slug: z.string().trim().min(1).max(60),
})

const empty = (status: number) =>
  new NextResponse(null, { status, headers: NO_STORE })

export async function POST(req: Request) {
  if (!checkAndRecord("directory-events", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
    return empty(429)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return empty(400)
  }

  const parsed = eventSchema.safeParse(body)
  if (!parsed.success || !isValidSlug(parsed.data.slug)) {
    return empty(400)
  }

  try {
    const business = await prisma.business.findUnique({
      where: { slug: parsed.data.slug },
      select: { id: true, isActive: true, showInDirectory: true },
    })
    if (!business?.isActive || !business.showInDirectory) {
      return empty(404)
    }

    await recordDirectoryEvent("click", { businessId: business.id })
    return empty(204)
  } catch (error) {
    console.error("[directory] Error registrando evento:", error)
    return empty(500)
  }
}
