import { moveInventory } from "@/lib/domain/inventory"
import { businessFailure } from "@/lib/domain/http"
import { NextRequest, NextResponse } from "next/server"
import { assertBranchAllowed, assertOperationBranch, getSession, requireAdmin, requireAdminOrEmployee, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
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
        case "TRANSFER":
            return uiType as MovementType
        default:
            return null
    }
}

export async function GET(request: NextRequest) {
    try {
        const result = await requireAdminOrEmployee()
        if (result.error) return result.error
        const businessId = businessIdOf(getSession(result)!)

        const { searchParams } = new URL(request.url)
        const productId = searchParams.get("productId")
        const typeParam = searchParams.get("type")
        const branchId = searchParams.get("branchId")
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50") || 50))
        const offset = Math.min(20000, Math.max(0, parseInt(searchParams.get("offset") || "0") || 0))

        const movementWhere: Record<string, unknown> = { businessId }
        if (productId) movementWhere.productId = productId
        if (branchId) movementWhere.branchId = branchId

        let reservationWhere: { businessId: string; status: { in: ("COMPLETED" | "CANCELLED")[] } } | { businessId: string; status: "COMPLETED" } | { businessId: string; status: "CANCELLED" } = { businessId, status: { in: ["COMPLETED", "CANCELLED"] } }
        let movementTypeFilter: MovementType | null = null
        let onlyReservations = false
        let onlyMovements = false

        if (typeParam === "SALE") {
            movementWhere.type = "OUT"
            movementWhere.paymentMethod = { not: null }
            reservationWhere = { businessId, status: "COMPLETED" }
        } else if (typeParam === "CANCELLED") {
            onlyReservations = true
            reservationWhere = { businessId, status: "CANCELLED" }
        } else if (typeParam === "DAMAGED" || typeParam === "LOST" || typeParam === "MERMAS") {
            // DAMAGED/LOST se persisten como OUT (el enum MovementType no los
            // incluye). Las mermas nuevas llevan notes "merma:damaged"|"merma:lost"
            // para distinguir el subtipo. paymentMethod null excluye las ventas
            // POS/bot, que también se guardan como OUT. MERMAS = todas las salidas
            // que no son venta (incluye mermas antiguas sin marca y salidas de uso interno).
            movementWhere.type = "OUT"
            movementWhere.paymentMethod = null
            if (typeParam !== "MERMAS") {
                movementWhere.notes = { startsWith: `merma:${typeParam.toLowerCase()}` }
            }
            onlyMovements = true
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
                    product: { select: { id: true, name: true, barcode: true, costPrice: true } },
                    user: { select: { id: true, name: true } },
                    branch: { select: { id: true, name: true } },
                    toBranch: { select: { id: true, name: true } },
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
            const returned = await prisma.inventoryMovement.aggregate({ where: { businessId, type: "RETURN", ...(row.source === "RESERVATION" ? { reservationId: row.id } : { relatedId: row.id }) }, _sum: { quantity: true } })
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
        const auth = await requireModule("inventario")
        if (auth.error) return auth.error
        const session = getSession(auth)!
        const body = await request.json()
        // Cada partida toca su sucursal (item.branchId ?? body.branchId, o la
        // principal si ninguna llega) y el traspaso además la de destino.
        const items = Array.isArray(body?.items) && body.items.length ? body.items : [body]
        for (const item of items) {
            const denied = await assertOperationBranch(session, item?.branchId ?? body?.branchId, { homeFallback: false })
            if (denied) return denied
            const deniedDest = assertBranchAllowed(session, item?.toBranchId)
            if (deniedDest) return deniedDest
        }
        const result = await moveInventory(prisma, session.user.id, businessIdOf(session), { ...body, idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"), items: body.items ?? [body] })
        return NextResponse.json(body.items ? result : { ...result.movements[0], operationId: result.operationId }, { status: 201 })
    } catch (error) { return businessFailure(error) }
}
