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
        const limit = parseInt(searchParams.get("limit") || "50")
        const offset = parseInt(searchParams.get("offset") || "0")

        const movementWhere: Record<string, unknown> = {}
        if (productId) movementWhere.productId = productId

        let reservationWhere: { status: { in: ("COMPLETED" | "CANCELLED")[] } } | { status: "COMPLETED" } | { status: "CANCELLED" } = { status: { in: ["COMPLETED", "CANCELLED"] } }
        let movementTypeFilter: MovementType | null = null
        let onlyReservations = false
        let onlyMovements = false

        if (typeParam === "SALE") {
            onlyReservations = true
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
                take: limit,
                skip: offset,
            }),
            onlyMovements ? Promise.resolve([]) : prisma.reservation.findMany({
                where: reservationWhere,
                include: {
                    product: { select: { id: true, name: true, barcode: true } },
                    user: { select: { id: true, name: true } },
                },
                orderBy: { updatedAt: "desc" },
                take: limit,
                skip: offset,
            }),
            onlyReservations ? Promise.resolve(0) : prisma.inventoryMovement.count({ where: movementWhere }),
            onlyMovements ? Promise.resolve(0) : prisma.reservation.count({ where: reservationWhere }),
        ])

        // Merge and sort (movements/reservations already filtered above)
        const movementList = Array.isArray(movements) ? movements : []
        const reservationList = Array.isArray(reservations) ? reservations : []
        const combined = [
            ...movementList.map((m) => ({ ...m, source: "MOVEMENT" as const })),
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
            .slice(0, limit)

        const total = (typeof totalMovements === "number" ? totalMovements : 0) + (typeof totalReservations === "number" ? totalReservations : 0)
        return NextResponse.json({ movements: combined, total })
    } catch (error) {
        console.error("Error fetching movements:", error)
        return NextResponse.json({ error: "Error al cargar movimientos" }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const result = await requireAdmin()
        if (result.error) return result.error

        const { searchParams } = new URL(request.url)
        const id = searchParams.get("id")
        const source = searchParams.get("source")

        if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 })

        if (source === 'MOVEMENT') {
            await prisma.inventoryMovement.delete({ where: { id } })
        } else if (source === 'RESERVATION') {
            await prisma.reservation.delete({ where: { id } })
        } else {
            // Try to delete from movement if source not specified (compatibility)
            try {
                await prisma.inventoryMovement.delete({ where: { id } })
            } catch {
                await prisma.reservation.delete({ where: { id } }).catch(() => { })
            }
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Error deleting movement:", error)
        return NextResponse.json({ error: "Error al eliminar" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const result = await requireAdminOrEmployee()
        if (result.error) return result.error
        const session = getSession(result)!

        const body = await request.json()
        const { productId, type, quantity, reason, notes } = body

        if (!productId || !type || !quantity) {
            return NextResponse.json(
                { error: "Producto, tipo y cantidad son requeridos" },
                { status: 400 }
            )
        }

        // Get current product stock
        const product = await prisma.product.findUnique({
            where: { id: productId },
            select: { id: true, name: true, stock: true },
        })

        if (!product) {
            return NextResponse.json(
                { error: "Producto no encontrado" },
                { status: 404 }
            )
        }

        const previousStock = product.stock
        let newStock = previousStock

        // Calculate new stock based on movement type
        switch (type) {
            case "IN":
            case "ADJUSTMENT_IN":
            case "RETURN":
                newStock = previousStock + quantity
                break
            case "OUT":
            case "ADJUSTMENT_OUT":
            case "SALE":
            case "DAMAGED":
            case "LOST":
                newStock = previousStock - quantity
                break
        }

        // Prevent negative stock
        if (newStock < 0) {
            return NextResponse.json(
                { error: "Stock insuficiente. Stock actual: " + previousStock },
                { status: 400 }
            )
        }

        // Normalizar tipo UI → enum Prisma (IN, OUT, ADJUSTMENT, RETURN)
        const prismaType: MovementType =
            type === "ADJUSTMENT_IN" || type === "ADJUSTMENT_OUT" ? "ADJUSTMENT"
                : type === "SALE" || type === "DAMAGED" || type === "LOST" ? "OUT"
                    : (type === "IN" || type === "OUT" || type === "ADJUSTMENT" || type === "RETURN" ? type : "OUT") as MovementType

        // Create movement and update product stock in transaction
        const movement = await prisma.$transaction(async (tx) => {
            // Update product stock
            await tx.product.update({
                where: { id: productId },
                data: { stock: newStock },
            })

            // Create movement record
            const newMovement = await tx.inventoryMovement.create({
                data: {
                    productId,
                    type: prismaType,
                    quantity,
                    previousStock,
                    newStock,
                    reason,
                    notes,
                    unitPrice: body.unitPrice,
                    totalPrice: body.totalPrice,
                    userId: session.user.id,
                },
                include: {
                    product: {
                        select: { id: true, name: true, minStock: true },
                    },
                    user: {
                        select: { id: true, name: true },
                    },
                },
            })

            // Si es una Venta y hay ingresos, registrar en Caja Activa (si existe)
            if (type === "SALE" && body.totalPrice && body.totalPrice > 0) {
                const openRegister = await tx.cashRegister.findFirst({
                    where: { status: "OPEN" }
                });
                
                if (openRegister) {
                    await tx.cashMovement.create({
                        data: {
                            registerId: openRegister.id,
                            amount: body.totalPrice,
                            type: "IN",
                            description: `Venta Rápida: ${newMovement.product.name}`,
                            referenceType: "SALE",
                            referenceId: newMovement.id,
                            userId: session.user.id,
                        }
                    });
                }
            }

            return newMovement
        })

        // Notify Admins via Telegram (Fire and forget)
        if (movement) {
            (async () => {
                try {
                    const admins = await prisma.user.findMany({
                        where: { role: "ADMIN", telegramId: { not: null } },
                        select: { telegramId: true }
                    })

                    const token = process.env.TELEGRAM_BOT_TOKEN
                    if (!token) return

                    const icon = movement.newStock > movement.previousStock ? "📥" : "📤"
                    const diff = Math.abs(movement.newStock - movement.previousStock)
                    
                    const message = `📢 *Movimiento de Inventario*
                    
📦 *${movement.product.name}*
📝 Motivo: ${reason}
👤 Por: ${movement.user?.name || "Sistema"}

📊 Cantidad: ${diff}
📈 Nuevo stock: ${movement.newStock}`

                    for (const admin of admins) {
                        if (admin.telegramId) {
                            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    chat_id: admin.telegramId,
                                    text: message,
                                    parse_mode: 'Markdown'
                                })
                            }).catch(err => console.error("Failed to send TG msg", err))
                        }
                    }

                    // 🚨 Alerta de Inventario Bajo 🚨
                    if (movement.newStock <= movement.product.minStock && movement.previousStock > movement.product.minStock) {
                        const alertMsg = `⚠️ *ALERTA DE STOCK BAJO* ⚠️\n\nEl producto 📦 *${movement.product.name}* ha llegado a su nivel mínimo.\n\n📊 Stock actual: *${movement.newStock}*\n📉 Mínimo permitido: *${movement.product.minStock}*\n\n_Es necesario reabastecer pronto._`
                        for (const admin of admins) {
                            if (admin.telegramId) {
                                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ chat_id: admin.telegramId, text: alertMsg, parse_mode: "Markdown" }),
                                }).catch(() => { })
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error sending notifications:", e)
                }
            })()
        }

        return NextResponse.json(movement, { status: 201 })
    } catch (error) {
        console.error("Error creating movement:", error)
        return NextResponse.json(
            { error: "Error al crear movimiento" },
            { status: 500 }
        )
    }
}
