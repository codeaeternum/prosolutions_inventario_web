"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Package,
  Users,
  DollarSign,
  CalendarCheck,
  ShoppingCart,
  AlertTriangle,
  Download,
  Calendar,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import { useCurrency } from "@/components/currency-provider"

interface ReportStats {
  totalProducts: number
  totalActiveProducts: number
  totalStock: number
  totalStockValue: number
  lowStockProducts: number
  outOfStockProducts: number
  totalUsers: number
  activeUsers: number
  pendingUsers: number
  totalReservations: number
  pendingReservations: number
  completedReservations: number
  cancelledReservations: number
  expiredReservations: number
  totalBrands: number
  totalCategories: number
  totalModels: number
  topProducts: Array<{
    id: string
    name: string
    reservationCount: number
    stock: number
  }>
  topBrands: Array<{
    id: string
    name: string
    productCount: number
  }>
  topClients: Array<{
    id: string
    name: string
    email: string | null
    customerType: string
    completedReservations: number
  }>
  lowStockByCategory: Array<{
    id: string
    name: string
    totalProducts: number
    lowStockCount: number
    outOfStockCount: number
    products: Array<{
      id: string
      name: string
      stock: number
      minStock: number
    }>
  }>
  recentReservations: Array<{
    id: string
    createdAt: string
    status: string
    totalPrice: number
    user: { name: string }
    product: { name: string }
  }>
}

export default function ReportsPage() {
  const { formatPrice } = useCurrency()
  const [stats, setStats] = useState<ReportStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const fetchStats = async () => {
    try {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (dateFrom) params.append("from", dateFrom)
      if (dateTo) params.append("to", dateTo)

      const response = await fetch(`/api/reports?${params.toString()}`)
      if (!response.ok) throw new Error("Error al cargar estadísticas")

      const data = await response.json()
      setStats(data)
    } catch {
      setError("Error al cargar los reportes")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exportCSV = () => {
    if (!stats) return

    const headers = [
      "Métrica",
      "Valor",
    ]

    const rows = [
      ["Total Productos", stats.totalProducts.toString()],
      ["Productos Activos", stats.totalActiveProducts.toString()],
      ["Stock Total", stats.totalStock.toString()],
      ["Valor Total en Stock", `$${stats.totalStockValue.toFixed(2)}`],
      ["Productos Stock Bajo", stats.lowStockProducts.toString()],
      ["Productos Agotados", stats.outOfStockProducts.toString()],
      ["Total Usuarios", stats.totalUsers.toString()],
      ["Usuarios Activos", stats.activeUsers.toString()],
      ["Usuarios Pendientes", stats.pendingUsers.toString()],
      ["Total Reservas", stats.totalReservations.toString()],
      ["Reservas Pendientes", stats.pendingReservations.toString()],
      ["Reservas Completadas", stats.completedReservations.toString()],
      ["Reservas Canceladas", stats.cancelledReservations.toString()],
      ["Total Marcas", stats.totalBrands.toString()],
      ["Total Categorías", stats.totalCategories.toString()],
      ["Total Modelos", stats.totalModels.toString()],
    ]

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `reporte-${new Date().toISOString().split("T")[0]}.csv`
    link.click()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error || "Error desconocido"}</p>
        <Button onClick={fetchStats} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Reintentar
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reportes</h1>
          <p className="text-muted-foreground">
            Estadísticas y análisis del sistema
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchStats} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualizar
          </Button>
          <Button onClick={exportCSV} size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filtros de fecha */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Filtrar por Fecha
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="space-y-2">
              <Label htmlFor="dateFrom">Desde</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateTo">Hasta</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={fetchStats}>Aplicar</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumen de Inventario */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Productos</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalActiveProducts}</div>
            <p className="text-xs text-muted-foreground">
              de {stats.totalProducts} totales
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Total</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalStock.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              unidades en inventario
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor en Stock</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPrice(stats.totalStockValue)}
            </div>
            <p className="text-xs text-muted-foreground">
              precio mayoreo
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stock Bajo</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {stats.lowStockProducts}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.outOfStockProducts} agotados
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Usuarios y Reservas */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Usuarios
            </CardTitle>
            <CardDescription>Estadísticas de usuarios registrados</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold text-lg">{stats.totalUsers}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Activos</span>
              <Badge variant="default">{stats.activeUsers}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Pendientes</span>
              <Badge variant="secondary">{stats.pendingUsers}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5" />
              Reservas
            </CardTitle>
            <CardDescription>Estado de las reservas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total</span>
              <span className="font-bold text-lg">{stats.totalReservations}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Pendientes</span>
              <Badge variant="secondary">{stats.pendingReservations}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Completadas</span>
              <Badge className="bg-green-500 hover:bg-green-600">{stats.completedReservations}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Canceladas</span>
              <Badge variant="destructive">{stats.cancelledReservations}</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Expiradas</span>
              <Badge variant="outline">{stats.expiredReservations}</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Catálogo */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Marcas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalBrands}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Categorías</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCategories}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Modelos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalModels}</div>
          </CardContent>
        </Card>
      </div>

      {/* Top Productos y Marcas */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Productos Más Reservados
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topProducts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay datos disponibles</p>
            ) : (
              <div className="space-y-3">
                {stats.topProducts.map((product, index) => (
                  <div key={product.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm w-5">{index + 1}.</span>
                      <span className="text-sm truncate max-w-[200px]">{product.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{product.reservationCount} reservas</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Marcas con Más Productos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.topBrands.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay datos disponibles</p>
            ) : (
              <div className="space-y-3">
                {stats.topBrands.map((brand, index) => (
                  <div key={brand.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm w-5">{index + 1}.</span>
                      <span className="text-sm">{brand.name}</span>
                    </div>
                    <Badge variant="outline">{brand.productCount} productos</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clientes Frecuentes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Clientes Frecuentes
          </CardTitle>
          <CardDescription>Top 10 clientes con más compras completadas</CardDescription>
        </CardHeader>
        <CardContent>
          {!stats.topClients || stats.topClients.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay datos disponibles</p>
          ) : (
            <div className="space-y-3">
              {stats.topClients.map((client, index) => (
                <div key={client.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-sm w-5 font-medium">{index + 1}.</span>
                    <div>
                      <p className="text-sm font-medium">{client.name}</p>
                      <p className="text-xs text-muted-foreground">{client.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {client.customerType === "STORE" ? "Mayoreo" : "Menudeo"}
                    </Badge>
                    <Badge className="bg-green-500 hover:bg-green-600">
                      {client.completedReservations} compras
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stock Bajo por Categoría */}
      {stats.lowStockByCategory && stats.lowStockByCategory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Stock Bajo por Categoría
            </CardTitle>
            <CardDescription>Productos con stock bajo agrupados por categoría</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {stats.lowStockByCategory.map((category) => (
                <div key={category.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium">{category.name}</h4>
                    <div className="flex gap-2">
                      <Badge variant="secondary">{category.lowStockCount} bajo</Badge>
                      {category.outOfStockCount > 0 && (
                        <Badge variant="destructive">{category.outOfStockCount} agotados</Badge>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {category.products.map((product) => (
                      <div
                        key={product.id}
                        className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded"
                      >
                        <span className="truncate max-w-[250px]">{product.name}</span>
                        <span className={`font-medium ${product.stock === 0 ? "text-red-500" : "text-yellow-600"}`}>
                          {product.stock} / {product.minStock} UD
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Últimas Reservas */}
      <Card>
        <CardHeader>
          <CardTitle>Últimas Reservas</CardTitle>
          <CardDescription>Las 10 reservas más recientes</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentReservations.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay reservas</p>
          ) : (
            <div className="space-y-3">
              {stats.recentReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{reservation.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {reservation.user.name} • {formatDate(reservation.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {formatPrice(reservation.totalPrice)}
                    </span>
                    <Badge
                      variant={
                        reservation.status === "COMPLETED"
                          ? "default"
                          : reservation.status === "CANCELLED" || reservation.status === "EXPIRED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {reservation.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
