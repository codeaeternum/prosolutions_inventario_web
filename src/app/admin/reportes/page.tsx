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
  Store,
  Wrench,
  PieChart,
  ChartLine,
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/admin/empty-state"
import { formatDate } from "@/lib/utils"
import { useCurrency } from "@/components/currency-provider"
import {
  BarChart,
  DonutChart,
  GroupedBars,
  HorizontalBars,
  LineChart,
} from "@/components/admin/charts"
import { repairLabels } from "@/lib/workshop-labels"

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

// Respuesta de /api/reports/marketplace-demand — todos los números los
// calcula el servidor.
interface MarketplaceDemandReport {
  generatedAt: string
  summary: {
    totalRequests: number
    pending: number
    approved: number
    rejected: number
    fulfilled: number
    distinctTalleres: number
    unmetProducts: number
    unmetQty: number
  }
  topProducts: Array<{
    productId: string
    name: string
    category: string | null
    stock: number
    minStock: number
    wholesalePrice: number | null
    totalQty: number
    requestCount: number
    tallerCount: number
    unmetQty: number
    estimatedValue: number | null
  }>
  byTaller: Array<{
    tallerName: string
    requestCount: number
    totalQty: number
    pending: number
    approved: number
    rejected: number
    fulfilled: number
    estimatedTotal: number
    purchasesCount: number
    purchasesTotal: number
  }>
  weekly: Array<{
    weekStart: string
    requests: number
    qty: number
  }>
}

// Respuesta de /api/reports?series=1 — todos los montos en centavos.
interface ReportSeries {
  generatedAt: string
  salesByDay: Array<{ day: string; salesCents: number; count: number }>
  cashByDay: Array<{ day: string; inCents: number; outCents: number }>
  repairMoney: Array<{ day: string; paymentsCents: number }>
  topModels: Array<{ label: string; count: number }>
  topParts: Array<{ label: string; count: number; revenueCents: number }>
  repairsByStatus: Array<{ status: string; count: number }>
  customersByMonth: Array<{ month: string; count: number }>
  topCustomers: Array<{ label: string; orders: number; spentCents: number }>
}

export default function ReportsPage() {
  const { formatPrice } = useCurrency()
  const [stats, setStats] = useState<ReportStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [demand, setDemand] = useState<MarketplaceDemandReport | null>(null)
  const [demandLoading, setDemandLoading] = useState(true)
  const [demandError, setDemandError] = useState<string | null>(null)
  const [series, setSeries] = useState<ReportSeries | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(true)
  const [seriesError, setSeriesError] = useState<string | null>(null)

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

  // Demanda del marketplace: fetch independiente para que un fallo aquí
  // no tumbe el reporte general.
  const fetchDemand = async () => {
    try {
      setDemandLoading(true)
      setDemandError(null)
      const response = await fetch("/api/reports/marketplace-demand")
      if (!response.ok) throw new Error("Error al cargar demanda")
      setDemand(await response.json())
    } catch {
      setDemandError("No se pudo cargar la demanda del mercado")
    } finally {
      setDemandLoading(false)
    }
  }

  // Series para las gráficas: fetch independiente para que un fallo aquí
  // no tumbe el reporte general.
  const fetchSeries = async () => {
    try {
      setSeriesLoading(true)
      setSeriesError(null)
      const response = await fetch("/api/reports?series=1")
      if (!response.ok) throw new Error("Error al cargar series")
      setSeries(await response.json())
    } catch {
      setSeriesError("No se pudieron cargar las gráficas")
    } finally {
      setSeriesLoading(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void fetchStats()
      void fetchDemand()
      void fetchSeries()
    })
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

  const maxWeekQty = demand
    ? Math.max(1, ...demand.weekly.map((w) => w.qty))
    : 1

  // Las series llegan en centavos; formatPrice espera pesos.
  const money = (cents: number) => formatPrice(cents / 100)
  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("es-MX", {
      day: "2-digit",
      month: "short",
    })
  const monthLabel = (m: string) =>
    new Date(`${m}-15T12:00:00`).toLocaleDateString("es-MX", {
      month: "short",
      year: "2-digit",
    })
  const intFmt = (v: number) => v.toLocaleString("es-MX")

  const salesTotal = series?.salesByDay.reduce((s, d) => s + d.salesCents, 0) ?? 0
  const salesCount = series?.salesByDay.reduce((s, d) => s + d.count, 0) ?? 0
  const cashTotals = series?.cashByDay.reduce(
    (acc, d) => ({ inC: acc.inC + d.inCents, outC: acc.outC + d.outCents }),
    { inC: 0, outC: 0 }
  ) ?? { inC: 0, outC: 0 }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reportes</h1>
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

      {/* Demanda del Mercado — qué refacciones piden los talleres aliados */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-5 w-5" />
            Demanda del Mercado
          </CardTitle>
          <CardDescription>
            Refacciones que solicitan los talleres aliados en el marketplace
          </CardDescription>
        </CardHeader>
        <CardContent>
          {demandLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : demandError || !demand ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8">
              <p className="text-sm text-destructive">
                {demandError || "Error desconocido"}
              </p>
              <Button onClick={fetchDemand} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </div>
          ) : demand.summary.totalRequests === 0 ? (
            <EmptyState
              icon={Store}
              title="Aún no hay solicitudes de talleres aliados"
              description="Cuando un taller pida refacciones del marketplace, la demanda aparecerá aquí."
            />
          ) : (
            <div className="space-y-6">
              {/* Resumen */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {demand.summary.totalRequests} solicitudes
                </Badge>
                <Badge variant="secondary">
                  {demand.summary.distinctTalleres}{" "}
                  {demand.summary.distinctTalleres === 1 ? "taller" : "talleres"}
                </Badge>
                {demand.summary.pending > 0 && (
                  <Badge variant="warning">
                    {demand.summary.pending} pendientes
                  </Badge>
                )}
                {demand.summary.unmetQty > 0 && (
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {demand.summary.unmetQty} pzs sin stock suficiente (
                    {demand.summary.unmetProducts}{" "}
                    {demand.summary.unmetProducts === 1 ? "producto" : "productos"})
                  </Badge>
                )}
              </div>

              {/* Tendencia: piezas pedidas por semana (últimas 8) */}
              <div>
                <p className="text-sm font-medium mb-3">
                  Piezas pedidas por semana
                </p>
                <div className="flex items-end gap-1.5 h-28">
                  {demand.weekly.map((w) => (
                    <div
                      key={w.weekStart}
                      className="flex-1 h-full min-w-0 flex flex-col items-center justify-end gap-1"
                      title={`${w.requests} solicitudes · ${w.qty} piezas`}
                    >
                      <span className="text-[10px] font-medium text-muted-foreground">
                        {w.qty > 0 ? w.qty : ""}
                      </span>
                      <div
                        className={`w-full max-w-10 rounded-t ${w.qty > 0 ? "bg-primary/80" : "bg-muted"}`}
                        style={{
                          height: `${Math.max((w.qty / maxWeekQty) * 100, w.qty > 0 ? 6 : 2)}%`,
                        }}
                      />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(`${w.weekStart}T12:00:00`).toLocaleDateString(
                          "es-MX",
                          { day: "2-digit", month: "short" }
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top refacciones más pedidas */}
              <div>
                <p className="text-sm font-medium mb-3">
                  Refacciones más pedidas
                  {demand.topProducts.length > 15 && " (top 15)"}
                </p>
                <div className="rounded-lg border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Refacción</TableHead>
                        <TableHead className="text-center">Pedidas</TableHead>
                        <TableHead className="text-center">Solicitudes</TableHead>
                        <TableHead className="text-center">Talleres</TableHead>
                        <TableHead className="text-center">Tienes</TableHead>
                        <TableHead className="text-right">Valor est.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {demand.topProducts.slice(0, 15).map((p, index) => (
                        <TableRow key={p.productId}>
                          <TableCell className="text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell className="min-w-[160px]">
                            <p className="font-medium leading-snug">{p.name}</p>
                            {p.category && (
                              <p className="text-[11px] text-muted-foreground">
                                {p.category}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-center font-semibold">
                            {p.totalQty.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-center">
                            {p.requestCount}
                          </TableCell>
                          <TableCell className="text-center">
                            {p.tallerCount}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <span
                                className={
                                  p.stock === 0
                                    ? "font-semibold text-destructive"
                                    : "font-medium"
                                }
                              >
                                {p.stock}
                              </span>
                              {p.stock === 0 ? (
                                <Badge variant="destructive">Agotado</Badge>
                              ) : p.unmetQty > 0 ? (
                                <Badge variant="warning">
                                  Faltan {p.unmetQty}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            {p.estimatedValue !== null
                              ? formatPrice(p.estimatedValue)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Solicitudes por taller aliado */}
      {demand && demand.byTaller.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Solicitudes por Taller Aliado
            </CardTitle>
            <CardDescription>
              Actividad de cada taller: estados, valor estimado y compras surtidas
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Taller</TableHead>
                    <TableHead className="text-center">Solicitudes</TableHead>
                    <TableHead className="text-center">Piezas</TableHead>
                    <TableHead>Estados</TableHead>
                    <TableHead className="text-right">Total estimado</TableHead>
                    <TableHead className="text-right">Compras surtidas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demand.byTaller.map((t) => (
                    <TableRow key={t.tallerName}>
                      <TableCell className="font-medium min-w-[140px]">
                        {t.tallerName}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.requestCount}
                      </TableCell>
                      <TableCell className="text-center font-semibold">
                        {t.totalQty.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {t.pending > 0 && (
                            <Badge
                              variant="warning"
                              className="px-1.5 text-[10px]"
                            >
                              {t.pending} pend.
                            </Badge>
                          )}
                          {t.approved > 0 && (
                            <Badge
                              variant="success"
                              className="px-1.5 text-[10px]"
                            >
                              {t.approved} aprob.
                            </Badge>
                          )}
                          {t.fulfilled > 0 && (
                            <Badge className="px-1.5 text-[10px] border-transparent bg-violet-600 text-white">
                              {t.fulfilled} surt.
                            </Badge>
                          )}
                          {t.rejected > 0 && (
                            <Badge
                              variant="destructive"
                              className="px-1.5 text-[10px]"
                            >
                              {t.rejected} rech.
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {formatPrice(t.estimatedTotal)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {t.purchasesCount > 0 ? (
                          <>
                            <span className="font-medium">
                              {t.purchasesCount}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {formatPrice(t.purchasesTotal)}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Gráficas — series de los últimos 30 días y rankings del taller */}
      <div className="space-y-4 pt-4">
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <ChartLine className="h-5 w-5" />
          Gráficas
        </h2>

        {seriesLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : seriesError || !series ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-8">
              <p className="text-sm text-destructive">
                {seriesError || "Error desconocido"}
              </p>
              <Button onClick={fetchSeries} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" />
                Reintentar
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Ventas y cobros de taller — últimos 30 días */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Ventas
                  </CardTitle>
                  <CardDescription>
                    Últimos 30 días · {salesCount}{" "}
                    {salesCount === 1 ? "venta" : "ventas"} ·{" "}
                    {money(salesTotal)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LineChart
                    data={series.salesByDay.map((d) => ({
                      label: dayLabel(d.day),
                      value: d.salesCents,
                      hint: `${d.count} ${d.count === 1 ? "venta" : "ventas"}`,
                    }))}
                    format={money}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5" />
                    Cobros de Taller
                  </CardTitle>
                  <CardDescription>
                    Últimos 30 días · pagos confirmados
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <LineChart
                    data={series.repairMoney.map((d) => ({
                      label: dayLabel(d.day),
                      value: d.paymentsCents,
                    }))}
                    format={money}
                    color="#7c3aed"
                  />
                </CardContent>
              </Card>
            </div>

            {/* Ingresos vs egresos de caja */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Ingresos y Egresos de Caja
                </CardTitle>
                <CardDescription>
                  Últimos 30 días · Ganancia:{" "}
                  <span
                    className={
                      cashTotals.inC - cashTotals.outC < 0
                        ? "text-destructive font-medium"
                        : "text-green-600 font-medium"
                    }
                  >
                    {money(cashTotals.inC - cashTotals.outC)}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GroupedBars
                  data={series.cashByDay.map((d) => ({
                    label: dayLabel(d.day),
                    values: [d.inCents, d.outCents],
                  }))}
                  series={[
                    { name: "Ingresos", color: "#16a34a" },
                    { name: "Egresos", color: "#dc2626" },
                  ]}
                  format={money}
                />
              </CardContent>
            </Card>

            {/* Estado del taller y altas de clientes */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5" />
                    Reparaciones por Estado
                  </CardTitle>
                  <CardDescription>Todas las órdenes registradas</CardDescription>
                </CardHeader>
                <CardContent>
                  <DonutChart
                    data={series.repairsByStatus.map((s) => ({
                      label:
                        repairLabels[s.status as keyof typeof repairLabels] ??
                        s.status,
                      value: s.count,
                    }))}
                    format={intFmt}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Clientes Nuevos por Mes
                  </CardTitle>
                  <CardDescription>Últimos 6 meses</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarChart
                    data={series.customersByMonth.map((m) => ({
                      label: monthLabel(m.month),
                      value: m.count,
                    }))}
                    format={intFmt}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Rankings del taller */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Modelos Más Reparados</CardTitle>
                  <CardDescription>Top 10 · histórico</CardDescription>
                </CardHeader>
                <CardContent>
                  <HorizontalBars
                    data={series.topModels.map((m) => ({
                      label: m.label,
                      value: m.count,
                    }))}
                    format={intFmt}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Refacciones Más Usadas</CardTitle>
                  <CardDescription>Top 10 · piezas aprobadas</CardDescription>
                </CardHeader>
                <CardContent>
                  <HorizontalBars
                    data={series.topParts.map((p) => ({
                      label: p.label,
                      value: p.count,
                      hint: money(p.revenueCents),
                    }))}
                    format={(v) => `${intFmt(v)} pzs`}
                    color="#0891b2"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Clientes del Taller</CardTitle>
                  <CardDescription>Top 10 por órdenes</CardDescription>
                </CardHeader>
                <CardContent>
                  <HorizontalBars
                    data={series.topCustomers.map((c) => ({
                      label: c.label,
                      value: c.orders,
                      hint: `~${money(c.spentCents)}`,
                    }))}
                    format={(v) => `${intFmt(v)} ord.`}
                    color="#f59e0b"
                  />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
