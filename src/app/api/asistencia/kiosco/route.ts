import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { businessFailure } from "@/lib/domain/http"
import { transaction } from "@/lib/domain/operations"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { JORNADA_MAX_MS } from "@/lib/asistencia"

// Mismo doble-tap que el checador personal: repetir la misma checada a <60 s
// de la última devuelve el evento existente (idempotente).
const DEDUP_MS = 60_000

const NO_STORE = { "Cache-Control": "private, no-store" } as const

// Hash bcrypt válido (costo 12, como los quickPin reales) que no corresponde
// a ningún PIN: bcrypt.compare corre igual cuando el usuario no existe o no
// tiene PIN, para no filtrar existencia ni configuración por timing.
const DUMMY_PIN_HASH = "$2b$12$zKjquZ2mImBQPuve9.jrXORH1KkrtQGyuaNbUjQSOq9Ut9zEgH9kW"

const kioscoSchema = z.object({
  userId: z.string().min(1).max(64),
  // El formato 4-6 dígitos se valida aparte: debe responder el 401 genérico
  // (mismo mensaje que usuario inválido), no el 400 del catch de zod.
  pin: z.string().min(1).max(12),
  type: z.enum(["IN", "OUT"]).optional(),
  note: z.string().trim().max(280).optional(),
})

/**
 * POST /api/asistencia/kiosco — checador compartido de mostrador.
 *
 * La tableta queda abierta con la sesión del operador (cualquier staff
 * ADMIN/EMPLOYEE) y cada persona marca SU entrada/salida con su PIN rápido
 * sin cambiar de cuenta: el ClockEvent se crea para el usuario del PIN,
 * nunca para el de la sesión, y siempre dentro del negocio de la sesión.
 *
 * Replica las reglas de POST /api/asistencia para el usuario objetivo:
 * - `type` ausente = automático: OUT si hay jornada abierta, IN si no.
 * - OUT exige jornada abierta (IN a ≤16 h sin OUT posterior); IN con una
 *   abierta → 409; IN abandonado hace >16 h ya no cuenta como abierta.
 * - Mismo tipo a <60 s del último evento → devuelve el existente.
 * - branchId = homeBranchId del TARGET (la sucursal de la sesión es del
 *   operador de mostrador y no aplica).
 *
 * Anti-enumeración: usuario inexistente/ajeno/inactivo, PIN sin formato y
 * PIN incorrecto corren el mismo bcrypt y comparten el mensaje "PIN
 * incorrecto o usuario inválido" (el 404/401 no filtra nada nuevo: el id
 * del staff ya es visible en /api/staff para operar el kiosco).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminOrEmployee()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const businessId = businessIdOf(session)
    const body = kioscoSchema.parse(await request.json())

    // Freno compartido: 8 intentos/min por IP+usuario objetivo (fuerza bruta
    // de un PIN concreto) y 30/min por sesión de mostrador (la tableta checa
    // a varias personas por minuto, pero no a este ritmo sostenido).
    if (
      !checkAndRecord("asistencia-kiosco", `${getClientIp(request)}:${body.userId}`, 60_000, 8) ||
      !checkAndRecord("asistencia-kiosco-s", session.user.id, 60_000, 30)
    ) {
      return NextResponse.json({ error: "Demasiados intentos, espera un momento" }, { status: 429 })
    }

    // Solo staff APPROVED del MISMO negocio: un id de otro tenant, cliente
    // o cuenta suspendida cae aquí como "no encontrado".
    const target = await prisma.user.findFirst({
      where: { id: body.userId, businessId, status: "APPROVED", role: { in: ["ADMIN", "EMPLOYEE"] } },
      select: { id: true, name: true, role: true, quickPin: true, homeBranchId: true },
    })

    const coincide = await bcrypt.compare(body.pin, target?.quickPin ?? DUMMY_PIN_HASH)
    const pinOk = /^\d{4,6}$/.test(body.pin) && coincide

    if (!target) {
      return NextResponse.json({ error: "PIN incorrecto o usuario inválido" }, { status: 404 })
    }
    if (!target.quickPin) {
      return NextResponse.json(
        { error: "Este usuario no tiene PIN rápido configurado", code: "PIN_NOT_SET" },
        { status: 400 }
      )
    }
    if (!pinOk) {
      return NextResponse.json({ error: "PIN incorrecto o usuario inválido" }, { status: 401 })
    }

    // A partir del PIN válido: mismas reglas que POST /api/asistencia pero
    // con userId del target (el actor del evento es quien checó, no quien
    // sostiene la tableta). Leer `last` y crear el evento van en una
    // transacción SERIALIZABLE con reintento: la tableta y el teléfono de
    // la misma persona — o un doble-tap con lag — pueden checar a la vez;
    // sin tx ambos leen el mismo `last` e insertan, dejando un IN fantasma
    // que abandona la jornada real o un OUT duplicado. El commit perdedor
    // aborta, reintenta y relee: dedup o 409, jamás duplicado.
    const result = await transaction(prisma, async tx => {
      const last = await tx.clockEvent.findFirst({
        where: { businessId, userId: target.id },
        orderBy: { at: "desc" },
      })
      const now = new Date()
      const jornadaAbierta = last?.type === "IN" && now.getTime() - last.at.getTime() <= JORNADA_MAX_MS
      const type = body.type ?? (jornadaAbierta ? "OUT" : "IN")

      if (last && last.type === type && now.getTime() - last.at.getTime() < DEDUP_MS) {
        return { kind: "dedup" as const, event: last }
      }
      if (type === "OUT" && !jornadaAbierta) return { kind: "sin-jornada" as const }
      if (type === "IN" && jornadaAbierta) return { kind: "jornada-abierta" as const, since: last!.at }

      const event = await tx.clockEvent.create({
        data: {
          businessId,
          userId: target.id,
          branchId: target.homeBranchId ?? null,
          type,
          note: body.note ?? null,
        },
      })
      return { kind: "creado" as const, event }
    })

    if (result.kind === "dedup") {
      return NextResponse.json(
        { event: result.event, userName: target.name, openShift: result.event.type === "IN" ? { since: result.event.at } : null, deduplicated: true },
        { headers: NO_STORE }
      )
    }
    if (result.kind === "sin-jornada") {
      return NextResponse.json(
        { error: "No hay una jornada abierta: primero registra tu entrada (IN)." },
        { status: 409 }
      )
    }
    if (result.kind === "jornada-abierta") {
      return NextResponse.json(
        { error: "Ya tienes una jornada abierta: registra tu salida (OUT) antes de volver a entrar.", since: result.since },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { event: result.event, userName: target.name, openShift: result.event.type === "IN" ? { since: result.event.at } : null, deduplicated: false },
      { status: 201, headers: NO_STORE }
    )
  } catch (error) {
    return businessFailure(error)
  }
}
