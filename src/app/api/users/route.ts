import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { resolveWorkshopSlug } from "./slug-utils"
import bcrypt from "bcryptjs"
import { UserRole } from "@prisma/client"

export async function GET(req: Request) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const roleParam = searchParams.get("role")
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? searchParams.get("pageSize") ?? "20", 10) || 20))

    const searchQuery = searchParams.get("search")

    const where = {
      ...(status && { status: status as "PENDING" | "APPROVED" | "REJECTED" }),
      ...(roleParam && { role: roleParam as UserRole }),
      ...(searchQuery && {
        OR: [
          { name: { contains: searchQuery, mode: "insensitive" as const } },
          { email: { contains: searchQuery, mode: "insensitive" as const } },
          { phone: { contains: searchQuery, mode: "insensitive" as const } },
        ],
      }),
    }

    const select = {
      id: true,
      name: true,
      email: true,
      phone: true,
      telegramId: true,
      customerType: true,
      status: true,
      role: true,
      jobTitle: true,
      publicSlug: true,
      creditLimit: true,
      creditBalance: true,
      homeBranchId: true,
      homeBranch: { select: { id: true, name: true } },
      createdAt: true,
      _count: { select: { reservations: true } },
    }

    const orderBy = [
      { role: "asc" as const },
      { status: "asc" as const },
      { createdAt: "desc" as const },
    ]

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ])

    const totalPages = Math.ceil(total / limit) || 1
    return NextResponse.json({
      users,
      total,
      page,
      limit,
      totalPages,
    })
  } catch (error) {
    console.error("Error fetching users:", error)
    return NextResponse.json({ error: "Error al obtener usuarios" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const body = await req.json()
    const { name, email, password, role, customerType, homeBranchId, jobTitle, quickPin, publicSlug } = body

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      )
    }

    // Puesto visible del staff (opcional, texto libre de hasta 60 caracteres)
    const cleanJobTitle = typeof jobTitle === "string" ? jobTitle.trim() : ""
    if (cleanJobTitle.length > 60) {
      return NextResponse.json({ error: "El puesto no puede exceder 60 caracteres" }, { status: 400 })
    }

    // PIN rápido para cambio de usuario (opcional, 4-6 dígitos; se guarda hasheado)
    let hashedPin: string | null = null
    if (quickPin !== undefined && quickPin !== null && quickPin !== "") {
      if (typeof quickPin !== "string" || !/^\d{4,6}$/.test(quickPin)) {
        return NextResponse.json({ error: "El PIN rápido debe tener de 4 a 6 dígitos" }, { status: 400 })
      }
      hashedPin = await bcrypt.hash(quickPin, 12)
    }

    if (homeBranchId) {
      const branch = await prisma.branch.findUnique({ where: { id: homeBranchId } })
      if (!branch || !branch.isActive) {
        return NextResponse.json({ error: "Sucursal inválida" }, { status: 400 })
      }
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: "El correo ya está registrado" },
        { status: 400 }
      )
    }

    // Link público del taller aliado: solo aplica a role WORKSHOP; vacío = sin vitrina.
    let cleanPublicSlug: string | null = null
    if (role === "WORKSHOP") {
      const resolved = await resolveWorkshopSlug(publicSlug)
      if (resolved instanceof NextResponse) return resolved
      cleanPublicSlug = resolved
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role as UserRole,
        customerType: customerType || "NORMAL",
        homeBranchId: homeBranchId || null,
        jobTitle: cleanJobTitle || null,
        publicSlug: cleanPublicSlug,
        quickPin: hashedPin,
        status: "APPROVED", // Admin created users are auto-approved
      },
    })

    // Respuesta whitelist: nunca exponemos password ni el hash del PIN rápido.
    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      customerType: user.customerType,
      status: user.status,
      jobTitle: user.jobTitle,
      publicSlug: user.publicSlug,
      homeBranchId: user.homeBranchId,
      createdAt: user.createdAt,
    })
  } catch (error) {
    console.error("Error creating user:", error)
    return NextResponse.json({ error: "Error al crear usuario" }, { status: 500 })
  }
}
