import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"
import { prisma } from "@/lib/prisma"
import { normalizePhone } from "@/lib/utils"
import { CustomerType } from "@prisma/client"

/**
 * Directorio de clientes (role=CUSTOMER, status=APPROVED) con agregados de
 * actividad: reservas, ventas como cliente y órdenes de taller (ligadas por
 * customerId, con respaldo por teléfono para las históricas sin ligar).
 *
 * Staff (admin|empleado): el mostrador busca clientes al recibir equipos y
 * cobrar a crédito.
 */
export async function GET(req: Request) {
  try {
    const result = await requireAdminOrEmployee()
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const { searchParams } = new URL(req.url)
    const search = searchParams.get("search")?.trim()
    const typeParam = searchParams.get("customerType")
    const conDeuda = searchParams.get("conDeuda") === "true"
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20))

    const where = {
      businessId,
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
          _count: {
            select: {
              reservations: { where: { businessId } },
              salesAsCustomer: { where: { businessId } },
            },
          },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ])

    // Las órdenes de taller se ligan por FK (customerId) y, como respaldo para
    // las históricas sin ligar, por teléfono normalizado (customerPhone o
    // customerPhoneAlt). Se deduplica por orden: el mismo número puede estar
    // en ambos campos y una orden puede llegar por los dos caminos.
    const orderPhones = await prisma.repairOrder.findMany({
      where: { businessId },
      select: { id: true, customerId: true, customerPhone: true, customerPhoneAlt: true },
    })
    const repairsByPhone = new Map<string, Set<string>>()
    const repairsByCustomer = new Map<string, Set<string>>()
    for (const order of orderPhones) {
      if (order.customerId) {
        let set = repairsByCustomer.get(order.customerId)
        if (!set) {
          set = new Set()
          repairsByCustomer.set(order.customerId, set)
        }
        set.add(order.id)
      }
      for (const raw of [order.customerPhone, order.customerPhoneAlt]) {
        const norm = normalizePhone(raw)
        if (!norm) continue
        let set = repairsByPhone.get(norm)
        if (!set) {
          set = new Set()
          repairsByPhone.set(norm, set)
        }
        set.add(order.id)
      }
    }

    const clientes = users.map(({ _count, ...u }) => ({
      ...u,
      reservationsCount: _count.reservations,
      salesCount: _count.salesAsCustomer,
      repairsCount: new Set([
        ...(repairsByPhone.get(normalizePhone(u.phone)) ?? []),
        ...(repairsByCustomer.get(u.id) ?? []),
      ]).size,
    }))

    const totalPages = Math.ceil(total / limit) || 1
    return NextResponse.json({ clientes, total, page, limit, totalPages }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 })
  }
}
