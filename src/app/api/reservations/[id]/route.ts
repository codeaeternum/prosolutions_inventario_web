import { NextResponse } from "next/server"
import { getSession, requireAuth, requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getSettings } from "@/lib/settings"
import { sendNotificationToAdmins } from "../../notifications/stream/route"

// GET - Obtener una reserva específica
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAuth()
    if (result.error) return result.error
    const session = getSession(result)!
    const { id } = await params

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        product: {
          include: {
            category: true,
            models: {
              include: {
                model: {
                  include: { brand: true },
                },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            customerType: true,
          },
        },
      },
    })

    if (!reservation) {
      return NextResponse.json(
        { error: "Reserva no encontrada" },
        { status: 404 }
      )
    }

    // Solo el dueño o admin puede ver la reserva
    if (reservation.userId !== session.user.id && session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 })
    }

    return NextResponse.json(reservation)
  } catch (error) {
    console.error("Error fetching reservation:", error)
    return NextResponse.json(
      { error: "Error al obtener reserva" },
      { status: 500 }
    )
  }
}

// PATCH - Actualizar reserva (admin: verificar/aprobar/rechazar, cliente: cancelar)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error
    const session = getSession(result)!
    const { id } = await params

    const body = await req.json()
    const { action, adminNotes } = body

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { product: true },
    })

    if (!reservation) {
      return NextResponse.json(
        { error: "Reserva no encontrada" },
        { status: 404 }
      )
    }

    const isAdmin = session.user.role === "ADMIN"
    const isOwner = reservation.userId === session.user.id

    // Acciones disponibles según rol
    switch (action) {
      case "cancel": {
        // Cliente puede cancelar su propia reserva si está pendiente
        if (!isOwner && !isAdmin) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 })
        }

        if (!["PENDING", "DEPOSIT_VERIFIED", "APPROVED"].includes(reservation.status)) {
          return NextResponse.json(
            { error: "Esta reserva no se puede cancelar" },
            { status: 400 }
          )
        }

        // Devolver stock
        await prisma.product.update({
          where: { id: reservation.productId },
          data: { stock: { increment: reservation.quantity } },
        })

        // Registrar movimiento
        await prisma.inventoryMovement.create({
          data: {
            productId: reservation.productId,
            userId: session.user.id,
            type: "IN",
            quantity: reservation.quantity,
            previousStock: reservation.product.stock,
            newStock: reservation.product.stock + reservation.quantity,
            reason: `Cancelación de reserva #${reservation.id.slice(-8)}`,
          },
        })

        const updated = await prisma.reservation.update({
          where: { id },
          data: {
            status: "CANCELLED",
            adminNotes: adminNotes || reservation.adminNotes,
          },
          include: { user: { select: { name: true } } },
        })

        // Notificar a admins si un cliente cancela su reserva
        if (!isAdmin) {
          sendNotificationToAdmins({
            type: "reservation_updated",
            title: "❌ Reserva cancelada",
            message: `${updated.user.name} canceló su reserva #${id.slice(-8)}`,
            data: { reservationId: id },
          })
        }

        return NextResponse.json(updated)
      }

      case "verify_deposit": {
        // Solo admin puede verificar depósito
        if (!isAdmin) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 })
        }

        if (reservation.type !== "DEPOSIT" || reservation.status !== "PENDING") {
          return NextResponse.json(
            { error: "Esta reserva no puede ser verificada" },
            { status: 400 }
          )
        }

        // Obtener configuración para nueva expiración
        const settings = await getSettings()
        const depositHours = settings.depositReservationHours

        const updated = await prisma.reservation.update({
          where: { id },
          data: {
            status: "DEPOSIT_VERIFIED",
            depositPaid: true,
            adminNotes,
            expiresAt: new Date(Date.now() + depositHours * 60 * 60 * 1000),
          },
        })

        return NextResponse.json(updated)
      }

      case "approve": {
        // Solo admin puede aprobar
        if (!isAdmin) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 })
        }

        if (!["PENDING", "DEPOSIT_VERIFIED"].includes(reservation.status)) {
          return NextResponse.json(
            { error: "Esta reserva no puede ser aprobada" },
            { status: 400 }
          )
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: {
            status: "APPROVED",
            adminNotes,
          },
        })

        return NextResponse.json(updated)
      }

      case "reject": {
        // Solo admin puede rechazar
        if (!isAdmin) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 })
        }

        // Devolver stock
        await prisma.product.update({
          where: { id: reservation.productId },
          data: { stock: { increment: reservation.quantity } },
        })

        // Registrar movimiento
        await prisma.inventoryMovement.create({
          data: {
            productId: reservation.productId,
            userId: session.user.id,
            type: "IN",
            quantity: reservation.quantity,
            previousStock: reservation.product.stock,
            newStock: reservation.product.stock + reservation.quantity,
            reason: `Reserva rechazada #${reservation.id.slice(-8)}`,
          },
        })

        const updated = await prisma.reservation.update({
          where: { id },
          data: {
            status: "REJECTED",
            adminNotes,
          },
        })

        return NextResponse.json(updated)
      }

      case "complete": {
        // Solo admin puede marcar como completada
        if (!isAdmin) {
          return NextResponse.json({ error: "No autorizado" }, { status: 403 })
        }

        if (!["APPROVED", "DEPOSIT_VERIFIED"].includes(reservation.status)) {
          return NextResponse.json(
            { error: "Esta reserva no puede ser completada" },
            { status: 400 }
          )
        }

        const updated = await prisma.reservation.update({
          where: { id },
          data: {
            status: "COMPLETED",
            adminNotes,
          },
        })

        return NextResponse.json(updated)
      }

      default:
        return NextResponse.json(
          { error: "Acción no válida" },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error("Error updating reservation:", error)
    return NextResponse.json(
      { error: "Error al actualizar reserva" },
      { status: 500 }
    )
  }
}
