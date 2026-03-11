import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// GET /api/reservations/verify?code=xxx - Verificar reserva por código QR
export async function GET(request: NextRequest) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const { searchParams } = new URL(request.url)
    const qrCode = searchParams.get("code")

    if (!qrCode) {
      return NextResponse.json({ error: "Código QR requerido" }, { status: 400 })
    }

    const reservation = await prisma.reservation.findFirst({
      where: { OR: [{ id: qrCode }, { qrCode }] },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            images: true,
            retailPrice: true,
            wholesalePrice: true,
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
      return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    }

    // Verificar si está expirada
    const isExpired = new Date(reservation.expiresAt) < new Date()
    const canComplete = ["APPROVED", "DEPOSIT_VERIFIED"].includes(reservation.status) && !isExpired

    return NextResponse.json({
      reservation,
      isExpired,
      canComplete,
      message: isExpired
        ? "Esta reserva ha expirado"
        : canComplete
        ? "Reserva lista para entregar"
        : `Estado: ${reservation.status}`,
    })
  } catch (error) {
    console.error("Error verifying reservation:", error)
    return NextResponse.json(
      { error: "Error al verificar reserva" },
      { status: 500 }
    )
  }
}

// POST /api/reservations/verify - Completar reserva por código QR
export async function POST(request: NextRequest) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const body = await request.json()
    const { qrCode } = body

    if (!qrCode) {
      return NextResponse.json({ error: "Código QR requerido" }, { status: 400 })
    }

    const reservation = await prisma.reservation.findFirst({
      where: { OR: [{ id: qrCode }, { qrCode }] },
      include: {
        product: { select: { name: true } },
        user: { select: { name: true } },
      },
    })

    if (!reservation) {
      return NextResponse.json({ error: "Reserva no encontrada" }, { status: 404 })
    }

    // Verificar que se pueda completar
    if (!["APPROVED", "DEPOSIT_VERIFIED"].includes(reservation.status)) {
      return NextResponse.json(
        { error: `No se puede completar una reserva con estado: ${reservation.status}` },
        { status: 400 }
      )
    }

    // Verificar si está expirada
    if (new Date(reservation.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Esta reserva ha expirado" },
        { status: 400 }
      )
    }

    // Marcar como completada
    const updated = await prisma.reservation.update({
      where: { id: reservation.id },
      data: { status: "COMPLETED" },
      include: {
        product: { select: { name: true } },
        user: { select: { name: true } },
      },
    })

    return NextResponse.json({
      success: true,
      message: `Reserva de ${updated.user.name} completada exitosamente`,
      reservation: updated,
    })
  } catch (error) {
    console.error("Error completing reservation:", error)
    return NextResponse.json(
      { error: "Error al completar reserva" },
      { status: 500 }
    )
  }
}
