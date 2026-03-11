import { NextResponse } from "next/server"
import { z } from "zod"
import { getSession, requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getSettings } from "@/lib/settings"
import { sendNotificationToAdmins } from "../notifications/stream/route"

const createReservationSchema = z.object({
  productId: z.string().min(1, "El producto es requerido"),
  quantity: z.coerce.number().int().min(1).default(1),
  type: z.enum(["TEMPORARY", "DEPOSIT"]).default("TEMPORARY"),
  paymentProofUrl: z.string().optional(),
  paymentMethod: z.enum(["STORE", "TRANSFER", "CREDIT"]).optional(),
})

// GET - Obtener reservas (admin: todas, cliente: las suyas)
export async function GET(req: Request) {
  try {
    const result = await requireAuth()
    if (result.error) return result.error
    const session = getSession(result)!

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const type = searchParams.get("type")
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20", 10) || 20))

    const isAdmin = session.user.role === "ADMIN"

    // Filtros base
    const where: Record<string, unknown> = {}

    // Si no es admin, solo ve sus reservas
    if (!isAdmin) {
      where.userId = session.user.id
    }

    // Filtros opcionales
    if (status) {
      where.status = status
    }
    if (type) {
      where.type = type
    }

    const include = {
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
    }

    const [reservations, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        include,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reservation.count({ where }),
    ])

    const totalPages = Math.ceil(total / limit) || 1
    return NextResponse.json({
      reservations,
      total,
      page,
      limit,
      totalPages,
    })
  } catch (error) {
    console.error("Error fetching reservations:", error)
    return NextResponse.json(
      { error: "Error al obtener reservas" },
      { status: 500 }
    )
  }
}

// POST - Crear nueva reserva
export async function POST(req: Request) {
  try {
    const result = await requireAuth()
    if (result.error) return result.error
    const session = getSession(result)!

    if (session.user.status !== "APPROVED") {
      return NextResponse.json(
        { error: "Tu cuenta debe ser aprobada para hacer reservas" },
        { status: 403 }
      )
    }

    const body = await req.json()
    const parseResult = createReservationSchema.safeParse(body)
    if (!parseResult.success) {
      const first = parseResult.error.flatten().fieldErrors
      const message = first.productId?.[0] ?? first.quantity?.[0] ?? parseResult.error.message
      return NextResponse.json(
        { error: typeof message === "string" ? message : "Datos inválidos" },
        { status: 400 }
      )
    }
    const { productId, quantity, type, paymentProofUrl, paymentMethod } = parseResult.data

    // Obtener producto
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product) {
      return NextResponse.json(
        { error: "Producto no encontrado" },
        { status: 404 }
      )
    }

    if (product.stock < quantity) {
      return NextResponse.json(
        { error: "Stock insuficiente" },
        { status: 400 }
      )
    }

    // Obtener configuración (usa valores por defecto si la tabla no existe)
    const settings = await getSettings()
    const tempMinutes = settings.tempReservationMinutes
    const depositPercentage = settings.depositPercentage
    const pendingHours = settings.pendingVerificationHours

    // Calcular precio según tipo de cliente (STORE = mayoreo)
    const unitPrice = session.user.customerType === "STORE"
      ? product.wholesalePrice
      : product.retailPrice
    const totalPrice = unitPrice * quantity

    // Calcular fecha de expiración según tipo de reserva
    let expiresAt: Date
    let depositAmount: number | null = null
    const status: "PENDING" | "DEPOSIT_VERIFIED" = "PENDING"

    if (type === "TEMPORARY") {
      // Reserva temporal: expira en X minutos
      expiresAt = new Date(Date.now() + tempMinutes * 60 * 1000)
    } else {
      // Reserva con depósito: expira en X horas para verificación
      expiresAt = new Date(Date.now() + pendingHours * 60 * 60 * 1000)
      depositAmount = (totalPrice * depositPercentage) / 100

      // Validar que tenga comprobante
      if (!paymentProofUrl) {
        return NextResponse.json(
          { error: "Se requiere comprobante de pago para reserva con depósito" },
          { status: 400 }
        )
      }
    }

    // Si es a crédito: validar límite y saldo
    if (paymentMethod === "CREDIT") {
      const userWithCredit = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { creditLimit: true, creditBalance: true },
      })
      const limit = userWithCredit?.creditLimit ?? 0
      const currentBalance = userWithCredit?.creditBalance ?? 0
      if (limit == null || limit <= 0) {
        return NextResponse.json(
          { error: "No tienes línea de crédito asignada. Contacta al administrador." },
          { status: 400 }
        )
      }
      if (currentBalance + totalPrice > limit) {
        return NextResponse.json(
          { error: `Superas tu límite de crédito (saldo: $${currentBalance.toLocaleString()}, límite: $${limit.toLocaleString()})` },
          { status: 400 }
        )
      }
    }

    // Crear reserva
    const reservation = await prisma.reservation.create({
      data: {
        userId: session.user.id,
        productId,
        quantity,
        totalPrice,
        depositAmount,
        type,
        status,
        paymentProofUrl: paymentMethod === "CREDIT" ? null : paymentProofUrl,
        paymentMethod: paymentMethod ?? null,
        expiresAt,
      },
      include: {
        product: true,
        user: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    })

    // Si es a crédito: registrar movimiento y actualizar saldo
    if (paymentMethod === "CREDIT") {
      await prisma.$transaction([
        prisma.creditMovement.create({
          data: {
            userId: session.user.id,
            amount: totalPrice,
            type: "DEBT",
            referenceType: "RESERVATION",
            referenceId: reservation.id,
            notes: `Reserva #${reservation.id.slice(-8)} - ${product.name} x${quantity}`,
          },
        }),
        prisma.user.update({
          where: { id: session.user.id },
          data: { creditBalance: { increment: totalPrice } },
        }),
      ])
    }

    // Reducir stock temporalmente
    await prisma.product.update({
      where: { id: productId },
      data: { stock: { decrement: quantity } },
    })

    // Registrar movimiento de inventario
    await prisma.inventoryMovement.create({
      data: {
        productId,
        userId: session.user.id,
        type: "OUT",
        quantity,
        previousStock: product.stock,
        newStock: product.stock - quantity,
        reason: `Reserva ${type === "TEMPORARY" ? "temporal" : "con depósito"} #${reservation.id.slice(-8)}`,
      },
    })

    // Enviar notificación a admins
    sendNotificationToAdmins({
      type: type === "DEPOSIT" ? "deposit_received" : "new_reservation",
      title: type === "DEPOSIT" ? "🏦 Nueva reserva con depósito" : "🛒 Nueva reserva temporal",
      message: `${reservation.user.name} reservó ${quantity}x ${product.name}`,
      data: {
        reservationId: reservation.id,
        productName: product.name,
        quantity,
        totalPrice,
        userName: reservation.user.name,
      },
    })

    return NextResponse.json(reservation, { status: 201 })
  } catch (error) {
    console.error("Error creating reservation:", error)
    return NextResponse.json(
      { error: "Error al crear reserva" },
      { status: 500 }
    )
  }
}
