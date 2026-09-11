import { moveInventory } from "@/lib/domain/inventory"
import { businessFailure } from "@/lib/domain/http"
import { NextRequest, NextResponse } from "next/server"
import { getSession, requireAdmin, requireAdminOrEmployee } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { MovementType } from "@prisma/client"

/** Mapea tipo de la UI al enum de Prisma (solo para movimientos de inventario). */
function toPrismaMovementType(uiType: string | null): MovementType | null {
    if (!uiType) return null
    switch (uiType) {
        case "ADJUSTMENT_IN":
        case "ADJUSTMENT_OUT":
            return "ADJUSTMENT"
        case "SALE":
        case "DAMAGED":
        case "LOST":
            return "OUT"
        case "IN":
        case "OUT":
        case "ADJUSTMENT":
        case "RETURN":
            return uiType as MovementType
        default:
            return null
    }
}

export async function GET(request: NextRequest) {
    try {
        const result = await requireAdminOrEmployee()
        if (result.error) return result.error

        const { searchParams } = new URL(request.url)
        const productId = searchParams.get("productId")
        const typeParam = searchParams.get("type")
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50") || 50))
        const offset = Math.min(20000, Math.max(0, parseInt(searchParams.get("offset") || "0") || 0))

        const movementWhere: Record<string, unknown> = {}
        if (productId) movementWhere.productId = productId

        let reservationWhere: { status: { in: ("COMPLETED" | "CANCELLED")[] } } | { status: "COMPLETED" } | { status: "CANCELLED" } = { status: { in: ["COMPLETED", "CANCELLED"] } }
        let movementTypeFilter: MovementType | null = null
        let onlyReservations = false
        let onlyMovements = false

        if (typeParam === "SALE") {
            movementWhere.type = "OUT"
            movementWhere.paymentMethod = { not: null }
            reservationWhere = { status: "COMPLETED" }
        } else if (typeParam === "CANCELLED") {
            onlyReservations = true
            reservationWhere = { status: "CANCELLED" }
        } else if (typeParam && typeParam !== "ALL") {
            movementTypeFilter = toPrismaMovementType(typeParam)
            if (movementTypeFilter) {
                movementWhere.type = movementTypeFilter
                onlyMovements = true
            }
        }

        const [movements, reservations, totalMovements, totalReservations] = await Promise.all([
            onlyReservations ? Promise.resolve([]) : prisma.inventoryMovement.findMany({
                where: movementWhere,
                include: {
                    product: { select: { id: true, name: true, barcode: true } },
                    user: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                take: offset + limit,
            }),
            onlyMovements ? Promise.resolve([]) : prisma.reservation.findMany({
                where: { ...reservationWhere, ...(productId ? { productId } : {}) },
                include: {
                    product: { select: { id: true, name: true, barcode: true } },
                    user: { select: { id: true, name: true } },
                },
                orderBy: { updatedAt: "desc" },
                take: offset + limit,
            }),
            onlyReservations ? Promise.resolve(0) : prisma.inventoryMovement.count({ where: movementWhere }),
            onlyMovements ? Promise.resolve(0) : prisma.reservation.count({ where: { ...reservationWhere, ...(productId ? { productId } : {}) } }),
        ])

        // Merge and sort (movements/reservations already filtered above)
        const movementList = Array.isArray(movements) ? movements : []
        const reservationList = Array.isArray(reservations) ? reservations : []
        const combined = [
            ...movementList.map((m) => ({ ...m, type: m.type === "OUT" && m.paymentMethod ? "SALE" : m.type, source: "MOVEMENT" as const })),
            ...reservationList.map((r) => ({
                id: r.id,
                type: r.status === "COMPLETED" ? "SALE" : "CANCELLED",
                quantity: r.quantity,
                previousStock: 0,
                newStock: 0,
                reason: `Reserva ${r.status === "COMPLETED" ? "Completada" : "Cancelada"}`,
                unitPrice: r.quantity ? r.totalPrice / r.quantity : null,
                totalPrice: r.totalPrice,
                createdAt: r.updatedAt,
                product: r.product,
                user: r.user,
                source: "RESERVATION" as const,
                notes: r.adminNotes,
            })),
        ]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(offset, offset + limit)

        const total = (typeof totalMovements === "number" ? totalMovements : 0) + (typeof totalReservations === "number" ? totalReservations : 0)
        const enriched = await Promise.all(combined.map(async row => {
            const returned = await prisma.inventoryMovement.aggregate({ where: { type: "RETURN", ...(row.source === "RESERVATION" ? { reservationId: row.id } : { relatedId: row.id }) }, _sum: { quantity: true } })
            return { ...row, returnableQuantity: Math.max(0, row.quantity - (returned._sum.quantity ?? 0)) }
        }))
        return NextResponse.json({ movements: enriched, total })
    } catch (error) {
        console.error("Error fetching movements:", error)
        return NextResponse.json({ error: "Error al cargar movimientos" }, { status: 500 })
    }
}

export async function DELETE() {
    const auth = await requireAdmin()
    if (auth.error) return auth.error
    return NextResponse.json({ error: "El historial no se elimina. Registra una devolución vinculada o un ajuste con motivo." }, { status: 405, headers: { Allow: "GET, POST" } })
}

export async function POST(request: NextRequest) {
    try {
        const auth = await requireAdminOrEmployee()
        if (auth.error) return auth.error
        const body = await request.json()
        const result = await moveInventory(prisma, getSession(auth)!.user.id, { idempotencyKey: body.idempotencyKey, items: body.items ?? [body] })
        return NextResponse.json(body.items ? result : { ...result.movements[0], operationId: result.operationId }, { status: 201 })
    } catch (error) { return businessFailure(error) }
}
