import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getSession, requireAdmin } from "@/lib/api-auth"
import { businessIdOf } from "@/lib/tenant"

// Tipo para status de reserva (del schema)
type ReservationStatusType = "PENDING" | "PENDING_PAYMENT" | "DEPOSIT_VERIFIED" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED" | "EXPIRED"

export async function GET(req: NextRequest) {
  try {
    const result = await requireAdmin()
    if (result.error) return result.error
    const businessId = businessIdOf(getSession(result)!)

    const { searchParams } = new URL(req.url)
    const fromDate = searchParams.get("from")
    const toDate = searchParams.get("to")

    // Filtros de fecha para reservas
    const dateFilter = {
      ...(fromDate && { gte: new Date(fromDate) }),
      ...(toDate && { lte: new Date(toDate + "T23:59:59.999Z") }),
    }
    const hasDateFilter = fromDate || toDate

    // Obtener estadísticas en paralelo
    const [
      // Productos
      totalProducts,
      totalActiveProducts,
      allProducts,
      // Usuarios
      totalUsers,
      activeUsers,
      pendingUsers,
      // Reservas
      totalReservations,
      reservationsByStatus,
      // Catálogo
      totalBrands,
      totalCategories,
      totalModels,
      // Top productos (por reservas)
      topProductsData,
      // Top marcas
      topBrandsData,
      // Últimas reservas
      recentReservations,
      // Top clientes
      topClientsData,
      // Stock por categoría
      categoriesWithStock,
    ] = await Promise.all([
      // Productos
      prisma.product.count({ where: { businessId } }),
      prisma.product.count({ where: { businessId, isActive: true } }),
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: { stock: true, minStock: true, wholesalePrice: true },
      }),
      // Usuarios
      prisma.user.count({ where: { businessId, role: "CUSTOMER" } }),
      prisma.user.count({ where: { businessId, role: "CUSTOMER", status: "APPROVED" } }),
      prisma.user.count({ where: { businessId, status: "PENDING" } }),
      // Reservas (con filtro de fecha si aplica)
      prisma.reservation.count({
        where: hasDateFilter ? { businessId, createdAt: dateFilter } : { businessId },
      }),
      prisma.reservation.groupBy({
        by: ["status"],
        _count: { status: true },
        where: hasDateFilter ? { businessId, createdAt: dateFilter } : { businessId },
      }),
      // Catálogo
      prisma.brand.count({ where: { businessId } }),
      prisma.category.count({ where: { businessId } }),
      prisma.model.count({ where: { businessId } }),
      // Top productos
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: {
          id: true,
          name: true,
          stock: true,
          _count: {
            select: {
              reservations: hasDateFilter
                ? { where: { businessId, createdAt: dateFilter } }
                : { where: { businessId } },
            },
          },
        },
        orderBy: {
          reservations: { _count: "desc" },
        },
        take: 5,
      }),
      // Top marcas
      prisma.brand.findMany({
        where: { businessId },
        select: {
          id: true,
          name: true,
          _count: {
            select: { models: true },
          },
        },
        orderBy: {
          models: { _count: "desc" },
        },
        take: 5,
      }),
      // Últimas reservas
      prisma.reservation.findMany({
        where: hasDateFilter ? { businessId, createdAt: dateFilter } : { businessId },
        include: {
          user: { select: { name: true } },
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      // Top clientes
      prisma.user.findMany({
        where: { businessId, role: "CUSTOMER", status: "APPROVED" },
        select: {
          id: true,
          name: true,
          email: true,
          customerType: true,
          _count: {
            select: {
              reservations: hasDateFilter
                ? { where: { businessId, createdAt: dateFilter, status: "COMPLETED" } }
                : { where: { businessId, status: "COMPLETED" } },
            },
          },
        },
        orderBy: {
          reservations: { _count: "desc" },
        },
        take: 10,
      }),
      // Stock bajo por categoría
      prisma.category.findMany({
        where: { businessId },
        select: {
          id: true,
          name: true,
          products: {
            where: { businessId, isActive: true },
            select: {
              id: true,
              name: true,
              stock: true,
              minStock: true,
            },
          },
        },
      }),
    ])

    // Calcular estadísticas de stock
    let totalStock = 0
    let totalStockValue = 0
    let lowStockProducts = 0
    let outOfStockProducts = 0

    for (const product of allProducts) {
      totalStock += product.stock
      totalStockValue += product.stock * (product.wholesalePrice ?? 0)
      if (product.stock <= product.minStock) {
        lowStockProducts++
      }
      if (product.stock === 0) {
        outOfStockProducts++
      }
    }

    // Mapear estados de reservas
    const statusMap = new Map<ReservationStatusType, number>(
      reservationsByStatus.map((s: { status: ReservationStatusType; _count: { status: number } }) => [s.status, s._count.status])
    )

    // Formatear top productos
    const topProducts = topProductsData.map((p: { id: string; name: string; stock: number; _count: { reservations: number } }) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      reservationCount: p._count.reservations,
    }))

    // Formatear top marcas (contamos productos a través de modelos)
    const topBrands: { id: string; name: string; productCount: number }[] = await Promise.all(
      topBrandsData.map(async (b: { id: string; name: string; _count: { models: number } }) => {
        const productCount = await prisma.product.count({
          where: {
            businessId,
            models: {
              some: {
                model: { brandId: b.id },
              },
            },
          },
        })
        return {
          id: b.id,
          name: b.name,
          productCount,
        }
      })
    )

    // Ordenar por cantidad de productos
    topBrands.sort((a: { productCount: number }, b: { productCount: number }) => b.productCount - a.productCount)

    // Formatear top clientes
    type TopClientData = {
      id: string
      name: string
      email: string | null
      customerType: string
      _count: { reservations: number }
    }
    const topClients = (topClientsData as TopClientData[])
      .filter(c => c._count.reservations > 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        customerType: c.customerType,
        completedReservations: c._count.reservations,
      }))

    // Formatear stock bajo por categoría
    type CategoryWithStock = {
      id: string
      name: string
      products: Array<{
        id: string
        name: string
        stock: number
        minStock: number
      }>
    }
    const lowStockByCategory = (categoriesWithStock as CategoryWithStock[])
      .map(cat => {
        const lowStockItems = cat.products.filter(p => p.stock <= p.minStock)
        return {
          id: cat.id,
          name: cat.name,
          totalProducts: cat.products.length,
          lowStockCount: lowStockItems.length,
          outOfStockCount: cat.products.filter(p => p.stock === 0).length,
          products: lowStockItems.slice(0, 5).map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
            minStock: p.minStock,
          })),
        }
      })
      .filter(cat => cat.lowStockCount > 0)
      .sort((a, b) => b.lowStockCount - a.lowStockCount)

    // Tipo para las reservas recientes
    type RecentReservation = {
      id: string
      createdAt: Date
      status: ReservationStatusType
      totalPrice: number
      user: { name: string }
      product: { name: string }
    }

    const response = {
      totalProducts,
      totalActiveProducts,
      totalStock,
      totalStockValue,
      lowStockProducts,
      outOfStockProducts,
      totalUsers,
      activeUsers,
      pendingUsers,
      totalReservations,
      pendingReservations: statusMap.get("PENDING") || 0,
      completedReservations: statusMap.get("COMPLETED") || 0,
      cancelledReservations: statusMap.get("CANCELLED") || 0,
      expiredReservations: statusMap.get("EXPIRED") || 0,
      totalBrands,
      totalCategories,
      totalModels,
      topProducts,
      topBrands,
      topClients,
      lowStockByCategory,
      recentReservations: (recentReservations as RecentReservation[]).map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        status: r.status,
        totalPrice: r.totalPrice,
        user: { name: r.user.name },
        product: { name: r.product.name },
      })),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("Error fetching reports:", error)
    return NextResponse.json(
      { error: "Error al obtener reportes" },
      { status: 500 }
    )
  }
}
