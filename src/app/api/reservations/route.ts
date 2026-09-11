import { NextResponse } from "next/server"
import { getSession, requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { ACTIVE_RESERVATIONS, TERMINAL_RESERVATIONS, createReservations } from "@/lib/domain/reservations"
import { businessFailure } from "@/lib/domain/http"
import type { Prisma, ReservationStatus } from "@prisma/client"

export const reservationInclude = {
  product: { select: { id: true, name: true, images: true, category: { select: { name: true } }, models: { select: { model: { select: { name: true, brand: { select: { name: true } } } } } } } },
  user: { select: { id: true, name: true, phone: true, customerType: true } },
} satisfies Prisma.ReservationInclude

export async function GET(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const session = getSession(auth)!
    const query = new URL(req.url).searchParams
    const page = Math.max(1, Number.parseInt(query.get("page") ?? "1") || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.get("limit") ?? query.get("pageSize") ?? "20") || 20))
    const view = query.get("view")
    const status = query.get("status")
    const allowed = [...ACTIVE_RESERVATIONS, ...TERMINAL_RESERVATIONS] as string[]
    if (status && !allowed.includes(status)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 })
    const type = query.get("type")
    if (type && !["TEMPORARY", "DEPOSIT"].includes(type)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
    const where: Prisma.ReservationWhereInput = {
      ...(session.user.role !== "ADMIN" ? { userId: session.user.id } : {}),
      ...(status ? { status: status as ReservationStatus } : view === "active" ? { status: { in: [...ACTIVE_RESERVATIONS] } } : view === "history" ? { status: { in: [...TERMINAL_RESERVATIONS] } } : {}),
      ...(type ? { type: type as "TEMPORARY" | "DEPOSIT" } : {}),
    }
    const [reservations, total] = await Promise.all([
      prisma.reservation.findMany({ where, include: reservationInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
      prisma.reservation.count({ where }),
    ])
    return NextResponse.json({ reservations, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) })
  } catch (error) { return businessFailure(error) }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAuth()
    if (auth.error) return auth.error
    const body = await req.json()
    const result = await createReservations(prisma, getSession(auth)!.user.id, { ...body, idempotencyKey: body.idempotencyKey ?? req.headers.get("idempotency-key") })
    return NextResponse.json(body.items ? result : { ...result.reservations[0], operationId: result.operationId }, { status: 201 })
  } catch (error) { return businessFailure(error) }
}
