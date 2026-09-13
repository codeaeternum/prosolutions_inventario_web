import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getDefaultBusinessId } from "@/lib/settings"
import { sendNotificationToAdmins } from "@/app/api/notifications/stream/route"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"

const registerSchema = z
  .object({
    name: z.string().min(1, "El nombre es requerido").max(200),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().max(50).optional().or(z.literal("")),
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    customerType: z.enum(["TECHNICIAN", "STORE", "NORMAL"]).default("NORMAL"),
  })
  .refine((data) => data.email?.trim() || data.phone?.trim(), {
    message: "Correo electrónico o teléfono es requerido",
    path: ["email"],
  })

const REGISTER_WINDOW_MS = 15 * 60 * 1000
const REGISTER_MAX_ATTEMPTS = 5

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req)
    if (!checkAndRecord("register", ip, REGISTER_WINDOW_MS, REGISTER_MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Demasiados intentos de registro. Espera unos minutos." },
        { status: 429 }
      )
    }
    const body = await req.json()
    const parseResult = registerSchema.safeParse(body)
    if (!parseResult.success) {
      const first = parseResult.error.flatten().fieldErrors
      const message =
        first.name?.[0] ?? first.password?.[0] ?? first.email?.[0] ?? "Datos inválidos"
      return NextResponse.json(
        { error: typeof message === "string" ? message : "Datos inválidos" },
        { status: 400 }
      )
    }
    const { name, email, phone, password, customerType: requestedType } = parseResult.data
    const emailOrNull = email?.trim() || null
    const phoneOrNull = phone?.trim() || null
    const businessId = await getDefaultBusinessId()

    if (emailOrNull) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email: emailOrNull, businessId },
      })
      if (existingByEmail) {
        return NextResponse.json(
          { error: "Este correo ya está registrado" },
          { status: 400 }
        )
      }
    }

    if (phoneOrNull) {
      const existingByPhone = await prisma.user.findFirst({
        where: { phone: phoneOrNull, businessId },
      })
      if (existingByPhone) {
        return NextResponse.json(
          { error: "Este teléfono ya está registrado" },
          { status: 400 }
        )
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12)

    // Create user with PENDING status
    // requestedCustomerType guarda lo que el cliente solicita
    // customerType se establece como RETAIL por defecto (admin puede cambiarlo)
    const user = await prisma.user.create({
      data: {
        businessId,
        name,
        email: emailOrNull,
        phone: phoneOrNull,
        password: hashedPassword,
        role: "CUSTOMER",
        customerType: "NORMAL",
        requestedCustomerType: requestedType,
        status: "PENDING",
      },
    })

    // Enviar notificación a admins
    sendNotificationToAdmins({
      type: "user_registered",
      title: "👤 Nueva solicitud de cuenta",
      message: `${name} solicita cuenta de tipo ${requestedType === "TECHNICIAN" ? "Técnico" : requestedType === "STORE" ? "Tienda" : "Particular"}`,
      data: {
        userId: user.id,
        name,
        email,
        phone,
        requestedType,
      },
    })

    return NextResponse.json({
      message: "Solicitud enviada correctamente",
      userId: user.id,
    })
  } catch (error) {
    console.error("Registration error:", error)
    return NextResponse.json(
      { error: "Error al procesar la solicitud" },
      { status: 500 }
    )
  }
}
