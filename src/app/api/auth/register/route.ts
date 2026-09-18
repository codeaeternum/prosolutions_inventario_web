import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getDefaultBusinessId } from "@/lib/settings"
import { sendNotificationToAdmins } from "@/app/api/notifications/stream/route"
import { checkAndRecord, getClientIp } from "@/lib/rate-limit"
import { normalizePhone } from "@/lib/utils"

/** Prisma P2002 (unique violado): email/phone ya existe en OTRO tenant. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  )
}

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
    // User.phone es único GLOBAL: se guarda normalizado (últimos 10 dígitos)
    // para que "+52 811 234 5678" y "811 234 5678" choquen en vez de evadirlo.
    const phoneOrNull = normalizePhone(phone) || null
    if (phone?.trim() && !phoneOrNull) {
      return NextResponse.json({ error: "El teléfono no tiene dígitos válidos" }, { status: 400 })
    }
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
      // User.phone es único en crudo: filas legacy guardadas como "+52 811…"
      // no empatan con la búsqueda exacta. Se compara normalizado en memoria
      // sobre los usuarios del tenant (volumen de piloto), igual que
      // linkCustomerByPhone en lib/domain/customers.
      const candidates = await prisma.user.findMany({
        where: { businessId, phone: { not: null } },
        select: { id: true, phone: true },
      })
      if (candidates.some((u) => normalizePhone(u.phone) === phoneOrNull)) {
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
    // User.email y User.phone son únicos GLOBALES: el chequeo previo solo
    // cubre este tenant; si el dato existe en otro negocio el create lanza
    // P2002 y se responde 409 (no un 500 genérico).
    let user
    try {
      user = await prisma.user.create({
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
    } catch (error) {
      if (isUniqueViolation(error)) {
        const target = (error as { meta?: { target?: unknown } }).meta?.target
        const onPhone = Array.isArray(target) ? target.includes("phone") : target === "phone"
        return NextResponse.json(
          { error: onPhone ? "Este teléfono ya está registrado" : "Este correo ya está registrado" },
          { status: 409 }
        )
      }
      throw error
    }

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
    }, businessId)

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
