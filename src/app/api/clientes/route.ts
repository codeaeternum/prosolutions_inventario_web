import { NextResponse } from "next/server"
import { getSession, requireAdminOrEmployee } from "@/lib/api-auth"
import { hasModule } from "@/lib/access"
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
    const session = getSession(result)!
    // El directorio también lo usa recepción de taller: vale clientes o taller.
    if (!hasModule(session.user, "clientes") && !hasModule(session.user, "taller")) {
      return NextResponse.json({ error: "No tienes acceso a este módulo." }, { status: 403 })
    }
    const businessId = businessIdOf(session)
    // El directorio es del negocio, pero los agregados de actividad
    // (apartados/ventas/reparaciones) se recortan a las sucursales asignadas.
    const allowed = session.user.role === "ADMIN" ? null : session.user.allowedBranchIds
    const branchScope = allowed?.length ? { in: allowed } : undefined

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
              reservations: { where: { businessId, ...(branchScope ? { branchId: branchScope } : {}) } },
              salesAsCustomer: { where: { businessId, ...(branchScope ? { branchId: branchScope } : {}) } },
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
    // customerPhoneAlt). UNA sola consulta agregada por la tripleta
    // (customerId, phone, phoneAlt): cada grupo reúne las órdenes con la misma
    // combinación, así el conteo por cliente se deduplica en memoria sin
    // materializar una fila por orden (antes leía toda la tabla del tenant).
    const orderGroups = await prisma.repairOrder.groupBy({
      by: ["customerId", "customerPhone", "customerPhoneAlt"],
      where: { businessId, ...(branchScope ? { currentBranchId: branchScope } : {}) },
      _count: { _all: true },
    })

    // Para el conteo por cliente se necesitan tres mapas:
    //  - byCustomer[cid]: órdenes ligadas por FK.
    //  - byPhone[p]: órdenes alcanzables por el teléfono normalizado p (un
    //    grupo con el mismo número en ambos campos solo cuenta una vez).
    //  - byCustomerPhone[`cid\np`]: la intersección — órdenes de cid cuyo
    //    teléfono también es p; se resta para no duplicar al unir A ∪ B.
    const repairsByCustomer = new Map<string, number>()
    const repairsByPhone = new Map<string, number>()
    const repairsByCustomerPhone = new Map<string, number>()
    for (const group of orderGroups) {
      const count = group._count._all
      const phones = new Set<string>()
      for (const raw of [group.customerPhone, group.customerPhoneAlt]) {
        const norm = normalizePhone(raw)
        if (norm) phones.add(norm)
      }
      if (group.customerId) {
        repairsByCustomer.set(group.customerId, (repairsByCustomer.get(group.customerId) ?? 0) + count)
        for (const phone of phones) {
          const key = `${group.customerId}\n${phone}`
          repairsByCustomerPhone.set(key, (repairsByCustomerPhone.get(key) ?? 0) + count)
        }
      }
      for (const phone of phones) {
        repairsByPhone.set(phone, (repairsByPhone.get(phone) ?? 0) + count)
      }
    }

    const clientes = users.map(({ _count, ...u }) => {
      const phone = normalizePhone(u.phone)
      const byCustomer = repairsByCustomer.get(u.id) ?? 0
      const byPhone = phone ? (repairsByPhone.get(phone) ?? 0) : 0
      const both = phone ? (repairsByCustomerPhone.get(`${u.id}\n${phone}`) ?? 0) : 0
      return {
        ...u,
        reservationsCount: _count.reservations,
        salesCount: _count.salesAsCustomer,
        // |A ∪ B| = |A| + |B| − |A∩B|: una orden ligada por FK y teléfono a
        // la vez se cuenta una sola vez, igual que el Set de ids anterior.
        repairsCount: byCustomer + byPhone - both,
      }
    })

    const totalPages = Math.ceil(total / limit) || 1
    return NextResponse.json({ clientes, total, page, limit, totalPages }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("Error fetching clientes:", error)
    return NextResponse.json({ error: "Error al obtener clientes" }, { status: 500 })
  }
}
