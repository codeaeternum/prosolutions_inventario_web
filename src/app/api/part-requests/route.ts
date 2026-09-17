import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { recordDirectoryEvent } from "@/lib/directory-events"
import { normalizePhone } from "@/lib/utils"

// POST /api/part-requests — PÚBLICO. Un visitante de /mercado pide una
// refacción que ningún negocio tiene publicada; el feed es a nivel
// plataforma (PartRequest no lleva businessId) y los negocios lo ven en
// /admin/mercado para contactar por WhatsApp.
//
// Anti-enumeración: siempre responde {ok:true} al aceptar — no confirma ni
// niega si el teléfono o la pieza ya existían. Rate limit agresivo por IP
// (5/15min): es un formulario anónimo que deja teléfonos, un bot podría
// sembrar basura o usarlo de relay.
const NO_STORE = { "Cache-Control": "no-store" } as const

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5

const createSchema = z.object({
  name: z.string().trim().min(2, "Describe qué refacción buscas").max(120),
  detail: z.string().trim().max(300).optional(),
  phone: z.string().trim().min(1, "Ingresa tu WhatsApp").max(30),
})

// Limpieza defensiva: sin caracteres de control ni espacios repetidos. El
// escaping lo hace React al renderizar; aquí solo se guarda texto legible.
const cleanText = (value: string) =>
  value.replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s{2,}/g, " ").trim()

const statuses = ["OPEN", "CONTACTED", "CLOSED"] as const

// GET /api/part-requests?status=&page= — staff only (ADMIN/EMPLOYEE). El
// feed es global pero el panel requiere staff autenticado con empresa.
// Orden: OPEN primero, dentro de cada estado las más recientes. take 50.
export async function GET(req: Request) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    businessIdOf(getSession(auth)!) // valida sesión con empresa asignada

    const params = new URL(req.url).searchParams
    const status = params.get("status")
    if (status && !(statuses as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400, headers: NO_STORE })
    }
    const page = Math.max(1, Number(params.get("page")) || 1)
    const take = 50

    const where = status ? { status: status as (typeof statuses)[number] } : {}
    const [requests, total, openCount] = await Promise.all([
      prisma.partRequest.findMany({
        where,
        // El enum se declara OPEN, CONTACTED, CLOSED: orden natural = abiertas primero.
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * take,
        take,
      }),
      prisma.partRequest.count({ where }),
      prisma.partRequest.count({ where: { status: "OPEN" } }),
    ])

    return NextResponse.json(
      {
        requests,
        total,
        page,
        totalPages: Math.ceil(total / take) || 1,
        openCount,
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error("[part-requests] Error al listar solicitudes:", error)
    return NextResponse.json(
      { error: "Error al obtener las solicitudes" },
      { status: 500, headers: NO_STORE },
    )
  }
}

// POST /api/part-requests  { name, detail?, phone }
// Registra la solicitud en OPEN y un DirectoryEvent kind="request" para la
// telemetría del directorio (inteligencia de mercado en /platform).
export async function POST(req: Request) {
  try {
    if (!checkAndRecord("part-requests", getClientIp(req), WINDOW_MS, MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." },
        { status: 429, headers: NO_STORE },
      )
    }

    const parseResult = createSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const first = parseResult.error.issues[0]
      return NextResponse.json(
        { error: first?.message ?? "Datos inválidos" },
        { status: 400, headers: NO_STORE },
      )
    }
    const input = parseResult.data

    // WhatsApp MX: normaliza a 10 dígitos locales ("+52 1 811…" → "811…").
    const phone = normalizePhone(input.phone)
    if (phone.length < 10) {
      return NextResponse.json(
        { error: "Ingresa un número de WhatsApp válido (10 dígitos)." },
        { status: 400, headers: NO_STORE },
      )
    }

    const name = cleanText(input.name)
    const detail = input.detail ? cleanText(input.detail) : ""
    if (name.length < 2) {
      return NextResponse.json(
        { error: "Describe qué refacción buscas" },
        { status: 400, headers: NO_STORE },
      )
    }

    await prisma.partRequest.create({
      data: { name, detail: detail || null, phone, status: "OPEN" },
    })

    // Telemetría del directorio (kind "request"): best-effort, nunca tumban
    // el registro — recordDirectoryEvent traga sus propios errores.
    void recordDirectoryEvent("request", { query: name })

    // Respuesta genérica: no revela si ya existía una solicitud igual.
    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE })
  } catch (error) {
    console.error("[part-requests] Error al registrar la solicitud:", error)
    return NextResponse.json(
      { error: "No pudimos registrar tu solicitud. Intenta más tarde." },
      { status: 500, headers: NO_STORE },
    )
  }
}
