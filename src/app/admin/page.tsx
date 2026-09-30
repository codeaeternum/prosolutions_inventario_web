import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import { businessIdOf } from "@/lib/tenant"

// Prevent static generation - requires database at runtime
export const dynamic = 'force-dynamic'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import {
  Package,
  ShoppingCart,
  AlertTriangle,
  UserPlus,
  Clock,
  TrendingUp,
  Boxes,
  Plus,
  ArrowRightLeft,
  Wrench,
  Wallet,
  ClipboardList,
} from "lucide-react"
import { formatPrice, formatDate } from "@/lib/utils"
import { PriceDisplay } from "@/components/price-display"
import { OnboardingCard } from "@/components/admin/onboarding-card"
import { getPendientes, type PendienteSeverity } from "@/lib/pendientes"

async function getDashboardStats() {
  try {
    const session = await auth()
    if (!session) throw new Error("Sin sesión")
    const businessId = businessIdOf(session)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      totalProducts,
      totalUsers,
      pendingUsers,
      pendingReservations,
      allProducts,
      totalBrands,
      recentReservations,
      todaysSales,
      activeRegister,
      activeRepairs,
      readyRepairs,
      overdueRepairs
    ] = await Promise.all([
      prisma.product.count({ where: { businessId, isActive: true } }),
      prisma.user.count({ where: { businessId, role: "CUSTOMER" } }),
      prisma.user.count({ where: { businessId, status: "PENDING" } }),
      prisma.reservation.count({ where: { businessId, status: "PENDING" } }),
      prisma.product.findMany({
        where: { businessId, isActive: true },
        select: { stock: true, minStock: true },
      }),
      prisma.brand.count({ where: { businessId } }),
      prisma.reservation.findMany({
        where: { businessId, status: { in: ["PENDING", "DEPOSIT_VERIFIED"] } },
        include: {
          user: { select: { name: true, email: true } },
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      // Ventas de hoy
      prisma.inventoryMovement.aggregate({
        _sum: { totalPrice: true },
        where: {
          businessId,
          type: "OUT",
          reason: { contains: "Venta" },
          createdAt: { gte: today }
        }
      }),
      // Caja activa
      prisma.cashRegister.findFirst({
        where: { businessId, status: "OPEN" },
        include: { movements: true }
      }),
      prisma.repairOrder.count({ where: { businessId, status: { notIn: ["DELIVERED", "CANCELLED"] } } }),
      prisma.repairOrder.count({ where: { businessId, status: "READY" } }),
      prisma.repairOrder.count({ where: { businessId, status: { notIn: ["DELIVERED", "CANCELLED", "NOT_REPAIRED", "NOT_AUTHORIZED"] }, promisedAt: { lt: new Date() } } })
    ])

    // Contar productos con stock bajo en JS
    const lowStockProducts = allProducts.filter(p => p.stock <= p.minStock).length
    
    // Total caja activa
    let cashTotal = activeRegister?.initialAmount || 0;
    if (activeRegister) {
        cashTotal = activeRegister.movements.reduce((sum, mov) => {
            return mov.type === "IN" ? sum + mov.amount : sum - mov.amount
        }, cashTotal)
    }

    return {
      totalProducts,
      totalUsers,
      pendingUsers,
      pendingReservations,
      lowStockProducts,
      totalBrands,
      recentReservations,
      todaysSales: todaysSales._sum.totalPrice || 0,
      cashTotal,
      isRegisterOpen: !!activeRegister,
      activeRepairs,
      readyRepairs,
      overdueRepairs
    }
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    return {
      totalProducts: 0,
      totalUsers: 0,
      pendingUsers: 0,
      pendingReservations: 0,
      lowStockProducts: 0,
      totalBrands: 0,
      recentReservations: [],
      todaysSales: 0,
      cashTotal: 0,
      isRegisterOpen: false,
      activeRepairs: 0,
      readyRepairs: 0,
      overdueRepairs: 0
    }
  }
}

async function getLowStockProducts() {
  try {
    const session = await auth()
    if (!session) throw new Error("Sin sesión")
    const businessId = businessIdOf(session)
    // Obtener productos con stock bajo (stock <= minStock)
    const products = await prisma.product.findMany({
      where: {
        businessId,
        isActive: true,
      },
      include: {
        models: {
          include: {
            model: { include: { brand: true } },
          },
          take: 1,
        },
        category: true,
      },
      orderBy: { stock: "asc" },
      take: 10,
    })
    // Filtrar en JS los que tienen stock <= minStock
    return products.filter(p => p.stock <= p.minStock).slice(0, 5)
  } catch (error) {
    console.error("Error fetching low stock products:", error)
    return []
  }
}

const SEVERITY_STYLE: Record<PendienteSeverity, { dot: string; label: string }> = {
  alta: { dot: "bg-rose-500", label: "Urgente" },
  media: { dot: "bg-amber-500", label: "Atención" },
  baja: { dot: "bg-sky-500", label: "Cuando puedas" },
}

export default async function AdminDashboard() {
  const session = await auth()
  const stats = await getDashboardStats()
  const lowStockProducts = await getLowStockProducts()
  const pendientes = session ? await getPendientes(session).catch(() => []) : []

  const statCards = [
    {
      title: "Ventas de Hoy",
      value: formatPrice(stats.todaysSales),
      description: "Ingresos del día actual",
      icon: TrendingUp,
      href: "/admin/ventas",
      alert: stats.todaysSales > 0 ? "¡Buen trabajo!" : null,
      alertClass: "text-green-500",
    },
    {
      title: "Caja Actual",
      value: stats.isRegisterOpen ? formatPrice(stats.cashTotal) : "Cerrada",
      description: stats.isRegisterOpen ? "Efectivo en turno" : "Abre caja para operar",
      icon: Wallet,
      href: "/admin/caja",
      alert: stats.isRegisterOpen ? "Turno activo" : "Requiere apertura",
      alertClass: stats.isRegisterOpen ? "text-green-500" : "text-amber-500",
    },
    {
      title: "Reservas",
      value: stats.pendingReservations,
      description: "Pendientes de aprobar/entregar",
      icon: Clock,
      href: "/admin/clientes?tab=pedidos",
      alert: stats.pendingReservations > 0 ? "Requiere atención" : null,
      alertClass: "text-amber-500",
    },
    {
      title: "Órdenes en taller",
      value: stats.activeRepairs,
      description: stats.overdueRepairs > 0 ? `${stats.overdueRepairs} atrasadas · ${stats.readyRepairs} listas` : stats.readyRepairs > 0 ? `${stats.readyRepairs} listas para entregar` : "Equipos en proceso",
      icon: Wrench,
      href: "/admin/taller",
      alert: stats.overdueRepairs > 0 ? `${stats.overdueRepairs} atrasadas` : stats.readyRepairs > 0 ? "Entregas pendientes" : null,
      alertClass: stats.overdueRepairs > 0 ? "text-rose-500" : "text-green-500",
    },
    {
      title: "Usuarios Nuevos",
      value: stats.pendingUsers,
      description: "Clientes por verificar",
      icon: UserPlus,
      href: "/admin/equipo?tab=usuarios",
      alert: stats.pendingUsers > 0 ? `${stats.pendingUsers} esperando` : null,
      alertClass: "text-amber-500",
    },
    {
      title: "Stock Bajo",
      value: stats.lowStockProducts,
      description: "Productos por reabastecer",
      icon: AlertTriangle,
      href: "/admin/inventario",
      alert: stats.lowStockProducts > 0 ? "Revisar inventario" : null,
      alertClass: "text-destructive",
    },
    {
      title: "Productos",
      value: stats.totalProducts,
      description: "Activos en el catálogo",
      icon: Package,
      href: "/admin/inventario",
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Resumen general y métricas de operación
        </p>
      </div>

      {/* Checklist de onboarding: solo ADMIN; se auto-oculta con dismissed */}
      {session?.user?.role === "ADMIN" && <OnboardingCard />}

      {/* Bandeja del día: todo lo que exige acción, de urgente a suave */}
      {pendientes.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Pendientes de hoy
            </CardTitle>
            <CardDescription>
              Lo que necesita tu atención ahora mismo
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {pendientes.map(item => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors"
              >
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${SEVERITY_STYLE[item.severity].dot}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">{item.title}</p>
                  {item.detail && <p className="text-xs text-muted-foreground truncate">{item.detail}</p>}
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {SEVERITY_STYLE[item.severity].label}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Accesos rápidos */}
      <Card>
        <CardHeader>
          <CardTitle>Accesos rápidos</CardTitle>
          <CardDescription>
            Acciones frecuentes del día a día
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="gap-2">
              <Link href="/admin/ventas">
                <ShoppingCart className="h-4 w-4" />
                Punto de Venta
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/admin/caja">
                <Wallet className="h-4 w-4" />
                Caja
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/admin/inventario?tab=stock&captura=1">
                <Plus className="h-4 w-4" />
                Agregar producto
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/admin/clientes?tab=pedidos">
                <Clock className="h-4 w-4" />
                Reservas
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/admin/inventario?tab=entradas">
                <ArrowRightLeft className="h-4 w-4" />
                Entradas y traspasos
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/admin/taller/recibir">
                <Wrench className="h-4 w-4" />
                Recibir equipo
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link href="/admin/taller">
                <ClipboardList className="h-4 w-4" />
                Tablero del taller
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {statCards.map((stat) => (
          <Link key={stat.title} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                  <stat.icon className="h-4 w-4" />
                </span>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">
                  {stat.description}
                </p>
                <p className={`text-xs mt-2 min-h-[20px] ${stat.alertClass || "text-destructive"}`}>
                  {stat.alert ? stat.alert : ""}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Pending Users */}
        {stats.pendingUsers > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Solicitudes de Cuenta
              </CardTitle>
              <CardDescription>
                Usuarios esperando aprobación
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-warning">
                  {stats.pendingUsers}
                </span>
                <Button asChild>
                  <Link href="/admin/equipo?tab=usuarios&filter=pending">
                    Revisar
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Reservations */}
        <Card className={stats.pendingUsers > 0 ? "" : "md:col-span-2"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Reservas Pendientes
            </CardTitle>
            <CardDescription>
              Reservas que requieren verificación
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.recentReservations.length > 0 ? (
              <div className="space-y-4">
                {stats.recentReservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    className="flex items-center justify-between border-b pb-2 last:border-0"
                  >
                    <div>
                      <p className="font-medium">{reservation.user.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {reservation.product.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(reservation.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          reservation.status === "DEPOSIT_VERIFIED"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {reservation.status === "DEPOSIT_VERIFIED"
                          ? "Anticipo"
                          : "Pendiente"}
                      </Badge>
                      <p className="text-sm font-medium mt-1">
                        <PriceDisplay price={reservation.totalPrice} />
                      </p>
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/admin/clientes?tab=pedidos">Ver y gestionar reservas</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No hay reservas recientes.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alert — mismo estilo que otras cards, sin botón destacado */}
      {lowStockProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Alerta de Stock Bajo
            </CardTitle>
            <CardDescription>
              Productos que necesitan reabastecimiento
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted"
                >
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {product.models[0]?.model.brand.name} {product.models[0]?.model.name} - {product.category.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant={product.stock === 0 ? "destructive" : "secondary"}>
                      {product.stock} UD
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      Mínimo: {product.minStock}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-4 gap-2" asChild>
              <Link href="/admin/inventario?tab=stock&lowStock=true">
                <Boxes className="h-4 w-4" />
                Ver productos con stock bajo
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Marcas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBrands}</div>
            <Button variant="link" className="p-0 h-auto" asChild>
              <Link href="/admin/inventario?tab=stock&herramienta=clasificacion&sub=marcas">Gestionar marcas</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
