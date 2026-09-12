import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { repairFolio } from "@/lib/workshop-labels"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

// Rastreo público de órdenes de reparación. Sin sesión: la identidad se prueba
// con folio + últimos 4 dígitos del teléfono para no exponer datos a cualquiera
// que adivine un folio consecutivo.
//
// Rate limit en memoria por IP (20 req/min). Es un proceso único: si el
// despliegue escala a multi-instancia hace falta un limiter compartido.
const WINDOW_MS = 60_000
const MAX_ATTEMPTS = 20

const NOT_FOUND = { error: "No encontramos una orden con esos datos." }
const NO_STORE = { "Cache-Control": "no-store" } as const

const onlyDigits = (value: string) => value.replace(/\D/g, "")

// El detalle de cada evento lo escribe el personal: antes de exponerlo se
// eliminan montos (el presupuesto aún no es público), nombres internos y la
// locación física del equipo (dato de custodia interno).
function publicDetail(detail: string): string {
  return detail
    .replace(/Presupuesto\s+[\d.,]+\s*MXN\.?/i, "Presupuesto registrado.")
    .replace(/Autorización registrada por el operador para\s+[\d.,]+\s*MXN\.?/i, "Presupuesto autorizado.")
    .replace(/Responsable:\s*[^.\n]+\.?/i, "Técnico asignado.")
    .replace(/,?\s*locación\s+[^.,\n]+/gi, "")
    .replace(/\$?\s*\d[\d,]*(\.\d{1,2})?\s*MXN/gi, "")
    .replace(/\$\s*\d[\d,]*(\.\d{1,2})?/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
}

export async function GET(req: Request) {
  try {
    if (!checkAndRecord("seguimiento", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas consultas. Intenta de nuevo en un minuto." },
        { status: 429, headers: NO_STORE },
      )
    }

    const query = new URL(req.url).searchParams
    // Mismo formato que /api/workshop: acepta "OT-000001", "000001" o "1".
    const folioMatch = /^(?:OT-)?0*(\d+)$/i.exec((query.get("folio") ?? "").trim())
    const number = folioMatch ? Number(folioMatch[1]) : NaN
    // Últimos 4 dígitos del teléfono registrado — obligatorio.
    const phone4 = onlyDigits((query.get("phone") ?? "").trim())

    if (!Number.isSafeInteger(number) || number > 2147483647 || !/^\d{4}$/.test(phone4)) {
      return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    }

    const order = await prisma.repairOrder.findUnique({
      where: { number },
      include: {
        currentBranch: { select: { name: true } },
        events: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
          select: { id: true, type: true, detail: true, isPublic: true, createdAt: true },
        },
      },
    })

    // Respuesta genérica: no revelar si falló el folio o el teléfono.
    if (!order || !onlyDigits(order.customerPhone).endsWith(phone4)) {
      return NextResponse.json(NOT_FOUND, { status: 404, headers: NO_STORE })
    }

    // Solo datos que el propio cliente ya conoce o puede ver en mostrador.
    // Nunca: nombre/teléfono completo, presupuesto (quoteCents), IDs internos,
    // location, aesthetics ni functionalConditions (custodia interna).
    // Las notas type=NOTE solo salen si el taller las marcó isPublic: las
    // privadas son bitácora interna (pueden traer locación o datos de plan).
    return NextResponse.json(
      {
        order: {
          folio: repairFolio(order.number),
          status: order.status,
          equipmentType: order.equipmentType,
          brand: order.brand,
          model: order.model,
          reportedIssue: order.reportedIssue,
          promisedAt: order.promisedAt,
          createdAt: order.createdAt,
          branch: order.currentBranch.name,
          events: order.events
            .filter(e => e.type !== "NOTE" || e.isPublic)
            .map(e => ({
              id: e.id,
              detail: publicDetail(e.detail),
              createdAt: e.createdAt,
              kind: e.type === "NOTE" ? ("MESSAGE" as const) : ("EVENT" as const),
            })),
        },
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error("[seguimiento] Error al consultar la orden:", error)
    return NextResponse.json(
      { error: "No pudimos consultar la orden. Intenta más tarde." },
      { status: 500, headers: NO_STORE },
    )
  }
}
