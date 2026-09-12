import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { CustomerType } from "@prisma/client"

/**
 * Directorio de clientes (role=CUSTOMER, status=APPROVED) con agregados de
 * actividad: reservas, ventas como cliente y órdenes de taller (que se
 * identifican por teléfono porque RepairOrder no tiene userId).
 */
export async function GET(req: Request) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error

    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")?.trim()
    const typeParam = searchParams.get("customerType")
    const conDeuda = searchParams.get("conDeuda") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20))

    const where = {
      role: "CUSTOMER" as const,
      status: "APPROVED" as const,
      ...(typeParam && { customerType: typeParam as CustomerType }),
      ...(conDeuda && { creditBalance: { gt: 0 } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search, mode: "insensitive" as const } },
          { businessName: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          telegramId: true,
          businessName: true,
          customerType: true,
          creditLimit: true,
          creditBalance: true,
          totalPurchases: true,
          createdAt: true,
          _count: { select: { reservations: true, salesAsCustomer: true } },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ])

    // Las órdenes de taller se ligan al cliente por customerPhone.
    const phones = users.map((u) => u.phone).filter((p): p is string => !!p)
    const repairsByPhone = phones.length
      ? await prisma.repairOrder.groupBy({
          by: ["customerPhone"],
          where: { customerPhone: { in: phones } },
          _count: { _all: true },
        })
      : []
    const repairsMap = new Map(repairsByPhone.map((r) => [r.customerPhone, r._count._all]))

    const clientes = users.map(({ _count, ...u }) => ({
      ...u,
      reservationsCount: _count.reservations,
      salesCount: _count.salesAsCustomer,
      repairsCount: u.phone ? repairsMap.get(u.phone) ?? 0 : 0,
    }))

    const totalPages = Math.ceil(total / limit) || 1
    return NextResponse.json({ clientes, total, page, limit, totalPages })
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 })
  }
}
