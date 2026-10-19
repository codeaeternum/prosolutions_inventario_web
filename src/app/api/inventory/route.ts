import { moveInventory } from "@/lib/domain/inventory"
import { businessFailure } from "@/lib/domain/http"
import { NextRequest, NextResponse } from "next/server"
import { assertBranchAllowed, assertOperationBranch, getSession, requireAdmin, requireModule } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { parseBusinessDateParam } from "@/lib/business-time"
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
        // El historial es del módulo inventario; product.costPrice solo llega
        // al ADMIN (abajo, en el select del movimiento).
        const result = await requireModule("inventario")
        if (result.error) return result.error
        const session = getSession(result)!
        const businessId = businessIdOf(session)

        const { searchParams } = new URL(request.url)
        const productId = searchParams.get("productId")
        const typeParam = searchParams.get("type")
        const branchId = searchParams.get("branchId")
        // El filtro de sucursal se valida contra allowedBranchIds: sin el
        // assert un empleado restringido podía ver movimientos ajenos.
        const deniedBranch = assertBranchAllowed(session, branchId)
        if (deniedBranch) return deniedBranch
        // Sin filtro explícito, el empleado con sucursales asignadas solo ve
        // los movimientos y reservas de las suyas.
        const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
        const branchScope = branchId ?? (allowed?.length ? { in: allowed } : undefined)
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50") || 50))
        const offset = Math.min(20000, Math.max(0, parseInt(searchParams.get("offset") || "0") || 0))

        // from/to: fecha corta "YYYY-MM-DD" = día completo del negocio
        // (00:00:00.000 / 23:59:59.999 en BUSINESS_TIME_ZONE, ver
        // business-time.ts); valores con hora/ISO completo pasan tal cual.
        // parseBusinessDateParam devuelve null tanto para ausente como para
        // inválido — el raw distingue el caso y un valor presente pero
        // inválido es 400.
        const fromRaw = searchParams.get("from")
        const toRaw = searchParams.get("to")
        const from = parseBusinessDateParam(fromRaw, "start")
        const to = parseBusinessDateParam(toRaw, "end")
        if ((fromRaw?.trim() && !from) || (toRaw?.trim() && !to)) {
            return NextResponse.json({ error: "Fechas inválidas: usa YYYY-MM-DD o ISO 8601 en from/to." }, { status: 400 })
        }
        const dateRange = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
        // Búsqueda libre: nombre/código del producto, motivo y notas (las
        // mermas llevan "merma:damaged"|"merma:lost" en notes, así q también
        // las alcanza). Tope de 100 chars para no armar LIKEs gigantes.
        const q = (searchParams.get("q") ?? "").trim().slice(0, 100)

        const movementWhere: Record<string, unknown> = { businessId }
        if (productId) movementWhere.productId = productId
        if (branchScope) movementWhere.branchId = branchScope
        if (from || to) movementWhere.createdAt = dateRange
        if (q) {
            const contains = { contains: q, mode: "insensitive" as const }
            movementWhere.AND = [{
                OR: [
                    { product: { name: contains } },
                    { product: { barcode: contains } },
                    { reason: contains },
                    { notes: contains },
                ],
            }]
        }

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
        } else if (typeParam === "OUT") {
            // "Salidas" honestas: OUT a secas NO incluye las ventas POS/bot
            // (paymentMethod no null), que se ven con type=SALE. Queda
            // equivalente a MERMAS — la UI retira la opción redundante.
            movementWhere.type = "OUT"
            movementWhere.paymentMethod = null
            onlyMovements = true
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

        // Reservas: su fecha visible es updatedAt (cuándo se completó/canceló),
        // así que el rango y la búsqueda se aplican sobre esa columna.
        const reservationFilters: Record<string, unknown> = { ...reservationWhere }
        if (productId) reservationFilters.productId = productId
        // Las filas fusionadas de reservas siguen el mismo recorte de sucursal
        // del empleado restringido (param explícito ya validado o { in: … }).
        if (allowed?.length) reservationFilters.branchId = branchId ?? { in: allowed }
        if (from || to) reservationFilters.updatedAt = dateRange
        if (q) {
            const contains = { contains: q, mode: "insensitive" as const }
            reservationFilters.AND = [{
                OR: [
                    { product: { name: contains } },
                    { product: { barcode: contains } },
                    { adminNotes: contains },
                ],
            }]
        }

        const [movements, reservations, totalMovements, totalReservations] = await Promise.all([
            onlyReservations ? Promise.resolve([]) : prisma.inventoryMovement.findMany({
                where: movementWhere,
                include: {
                    // El costo revela el margen real: solo lo recibe ADMIN (el
                    // panel muestra "Costo" únicamente cuando el campo llega).
                    product: { select: { id: true, name: true, barcode: true, ...(session.user.role === "ADMIN" ? { costPrice: true } : {}) } },
                    user: { select: { id: true, name: true, role: true } },
                    branch: { select: { id: true, name: true } },
                    toBranch: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: "desc" },
                take: offset + limit,
            }),
            onlyMovements ? Promise.resolve([]) : prisma.reservation.findMany({
                where: reservationFilters,
                include: {
                    product: { select: { id: true, name: true, barcode: true } },
                    user: { select: { id: true, name: true, role: true } },
                },
                orderBy: { updatedAt: "desc" },
                take: offset + limit,
            }),
            onlyReservations ? Promise.resolve(0) : prisma.inventoryMovement.count({ where: movementWhere }),
            onlyMovements ? Promise.resolve(0) : prisma.reservation.count({ where: reservationFilters }),
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
        // Devolvible por fila, en DOS lotes + los agregados por reserva:
        // - Salidas ligadas a una venta POS: el pendiente vive en
        //   SaleItem.returnedQuantity — un solo ledger compartido con
        //   /api/sales/return y las devoluciones del historial (delegan ahí).
        // - Salidas sin venta: los RETURN ligados por relatedId, en un solo
        //   groupBy (antes era un aggregate por fila).
        // - Reservas: RETURN por reservationId, agregado por fila como antes.
        const saleIds = [...new Set(
            combined.map(row => (row.source === "MOVEMENT" ? row.saleId : null)).filter((id): id is string => Boolean(id)),
        )]
        const movementIds = combined.filter(row => row.source === "MOVEMENT").map(row => row.id)
        const [sales, relatedReturns] = await Promise.all([
            saleIds.length
                ? prisma.sale.findMany({
                    where: { businessId, id: { in: saleIds } },
                    select: { id: true, status: true, items: { select: { productId: true, quantity: true, returnedQuantity: true } } },
                })
                : Promise.resolve([]),
            movementIds.length
                ? prisma.inventoryMovement.groupBy({
                    by: ["relatedId"],
                    where: { businessId, type: "RETURN", relatedId: { in: movementIds } },
                    _sum: { quantity: true },
                })
                : Promise.resolve([]),
        ])
        const saleById = new Map(sales.map(sale => [sale.id, sale]))
        const relatedReturnedById = new Map(
            relatedReturns.map(row => [row.relatedId, row._sum.quantity ?? 0] as const),
        )
        const enriched = await Promise.all(combined.map(async row => {
            if (row.source === "MOVEMENT") {
                const relatedReturned = relatedReturnedById.get(row.id) ?? 0
                if (row.saleId) {
                    const sale = saleById.get(row.saleId)
                    // Venta anulada: el IN de la anulación ya repuso el stock —
                    // no hay unidades por devolver aunque el OUT siga visible.
                    if (!sale || sale.status !== "COMPLETED") return { ...row, returnableQuantity: 0 }
                    // Ambos ledgers: lo devuelto por el POS (returnedQuantity)
                    // y lo devuelto por el camino viejo (relatedId) que pudo
                    // quedar grabado antes de la convergencia.
                    const remaining = sale.items
                        .filter(item => item.productId === row.productId)
                        .reduce((sum, item) => sum + item.quantity - item.returnedQuantity, 0) - relatedReturned
                    return { ...row, returnableQuantity: Math.max(0, Math.min(row.quantity, remaining)) }
                }
                return { ...row, returnableQuantity: Math.max(0, row.quantity - relatedReturned) }
            }
            const returned = await prisma.inventoryMovement.aggregate({ where: { businessId, type: "RETURN", reservationId: row.id }, _sum: { quantity: true } })
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
        // principal si ninguna llega) y el traspaso además la de destino. La
        // devolución sin sucursal explícita repone en la sucursal de la venta
        // original: el assert debe evaluar esa misma sucursal efectiva.
        const businessId = businessIdOf(session)
        const items = Array.isArray(body?.items) && body.items.length ? body.items : [body]
        for (const item of items) {
            let effectiveBranch = item?.branchId ?? body?.branchId
            if (!effectiveBranch && item?.type === "RETURN" && (item?.relatedId || item?.reservationId)) {
                const src = item.relatedId
                    ? await prisma.inventoryMovement.findFirst({ where: { id: item.relatedId, businessId }, select: { branchId: true } })
                    : await prisma.reservation.findFirst({ where: { id: item.reservationId, businessId }, select: { branchId: true } })
                effectiveBranch = src?.branchId ?? undefined
            }
            const denied = await assertOperationBranch(session, effectiveBranch, { homeFallback: false })
            if (denied) return denied
            const deniedDest = assertBranchAllowed(session, item?.toBranchId)
            if (deniedDest) return deniedDest
        }
        const result = await moveInventory(prisma, session.user.id, businessId, { ...body, idempotencyKey: body.idempotencyKey ?? request.headers.get("idempotency-key"), items: body.items ?? [body] })
        return NextResponse.json(body.items ? result : { ...result.movements[0], operationId: result.operationId }, { status: 201 })
    } catch (error) { return businessFailure(error) }
}
