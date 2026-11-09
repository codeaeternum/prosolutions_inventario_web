import { NextResponse } from "next/server"
import { getSession, requireAuth, assertModuleAllowed } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { ACTIVE_RESERVATIONS, TERMINAL_RESERVATIONS, createReservations } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"
import { checkAndRecord } from "@/lib/rate-limit"
import type { Prisma, ReservationStatus } from "@prisma/client"

// Crear una reserva descuenta existencias reales (takeStock): sin tope, un
// cliente podía inmovilizar el inventario creando reservas en ráfaga. El
// límite es por usuario (mismo patrón que cotizacion-decision por IP).
const RESERVATION_WINDOW_MS = 60 * 60 * 1000
const MAX_RESERVATIONS = 10

const NO_STORE = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const

export const reservationInclude = {
  product: { select: { id: true, name: true, images: true, category: { select: { name: true } }, models: { select: { model: { select: { name: true, brand: { select: { name: true } } } } } } } },
  user: { select: { id: true, name: true, phone: true, customerType: true } },
} satisfies Prisma.ReservationInclude

export async function GET(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    // El staff ve todas las reservas del negocio: exige el módulo reservas.
    if (["ADMIN", "EMPLOYEE"].includes(session.user.role)) {
      const denied = assertModuleAllowed(session, "reservas")
      if (denied) return denied
    }
    const query = new URL(req.url).searchParams
    const page = Math.max(1, Number.parseInt(query.get("page") ?? "1") || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.get("limit") ?? query.get("pageSize") ?? "20") || 20))
    const view = query.get("view")
    const status = query.get("status")
    const allowed = [...ACTIVE_RESERVATIONS, ...TERMINAL_RESERVATIONS] as string[]
    if (status && !allowed.includes(status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    const type = query.get("type")
    if (type && !["TEMPORARY", "DEPOSIT"].includes(type)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
    const isStaff = ["ADMIN", "EMPLOYEE"].includes(session.user.role)
    // Empleado con sucursales asignadas: el listado se recorta a las suyas.
    const allowedBranches = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const where: Prisma.ReservationWhereInput = {
      businessId: businessIdOf(session),
      // Staff (admin|empleado) opera el mostrador y ve todas las reservas del
      // negocio; los clientes solo ven las propias.
      ...(!isStaff ? { userId: session.user.id } : {}),
      ...(isStaff && allowedBranches?.length ? { branchId: { in: allowedBranches } } : {}),
      ...(status ? { status: status as ReservationStatus } : view === "active" ? { status: { in: [...ACTIVE_RESERVATIONS] } } : view === "history" ? { status: { in: [...TERMINAL_RESERVATIONS] } } : {}),
      ...(type ? { type: type as "TEMPORARY" | "DEPOSIT" } : {}),
    }
    const [reservations, total] = await Promise.all([
      prisma.reservation.findMany({ where, include: reservationInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.reservation.count({ where }),
    ])
    return NextResponse.json({ reservations, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) }, { headers: NO_STORE })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    // Mostrador (admin|empleado) requiere el módulo; clientes se autoreservan.
    if (["ADMIN", "EMPLOYEE"].includes(session.user.role)) {
      const denied = assertModuleAllowed(session, "reservas")
      if (denied) return denied
    }
    if (!checkAndRecord("reservations", session.user.id, RESERVATION_WINDOW_MS, MAX_RESERVATIONS)) {
      return NextResponse.json({ error: "Demasiadas reservas. Intenta de nuevo en una hora." }, { status: 429 })
    }
    const body = await req.json()
    const result = await createReservations(prisma, session.user.id, businessIdOf(session), { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") })
    return NextResponse.json(body.items ? result : { ...result.reservations[0], operationId: result.operationId }, { status: 201, headers: NO_STORE })
  } catch (error) { return businessFailure(error) }
}
