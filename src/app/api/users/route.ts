import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
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
    const { name, email, password, role, customerType, homeBranchId } = body

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { error: "Faltan campos requeridos" },
        { status: 400 }
      )
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

    const hashedPassword = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role as UserRole,
        customerType: customerType || "NORMAL",
        homeBranchId: homeBranchId || null,
        status: "APPROVED", // Admin created users are auto-approved
      },
    })

    const { password: _, ...userWithoutPassword } = user

    return NextResponse.json(userWithoutPassword)
  } catch (error) {
    console.error("Error creating user:", error)
    return NextResponse.json({ error: "Error al crear usuario" }, { status: 500 })
  }
}
