"use client"

import { useEffect, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/admin/empty-state"
import { useCurrency } from "@/components/currency-provider"
import {
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Store,
  Trophy,
} from "lucide-react"

// Respuesta de /api/reports/sucursales — los montos llegan en pesos.
interface BranchCompare {
  id: string
  name: string
  ventas: number
  ventasCount: number
  ticketPromedio: number
  piezasVendidas: number
  mermas: number
  mermasCosto: number
  stockPiezas: number
  productosConStock: number
  ordenesActivas: number
}

interface SucursalesReport {
  generatedAt: string
  dias: number
  desde: string
  branches: BranchCompare[]
}

interface MetricDef {
  key: string
  label: string
  get: (b: BranchCompare) => number
  format: (v: number) => string
  /** "high": el mayor gana (ventas); "low": el menor gana (mermas). */
  better: "high" | "low"
  /** Total de la última columna; por defecto suma los valores de la fila. */
  total?: (rows: BranchCompare[]) => number
}

const PERIODOS = [7, 30, 90] as const

export function ComparadorSucursales() {
  const { formatPrice } = useCurrency()
  const [data, setData] = useState<SucursalesReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dias, setDias] = useState<number>(30)

  const intFmt = (v: number) => v.toLocaleString("es-MX")

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/reports/sucursales?dias=${dias}`)
      if (!res.ok) throw new Error("Error al cargar comparador")
      setData(await res.json())
    } catch {
      setError("No se pudo cargar el comparador de sucursales")
    } finally {
      setLoading(false)
    }
  }

  // Fetch independiente: un fallo aquí no tumba el resto del reporte.
  useEffect(() => {
    queueMicrotask(() => void fetchData())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dias])

  const metrics: MetricDef[] = [
    { key: "ventas", label: `Ventas (${dias}d)`, get: (b) => b.ventas, format: formatPrice, better: "high" },
    { key: "ventasCount", label: "Núm. de ventas", get: (b) => b.ventasCount, format: intFmt, better: "high" },
    {
      key: "ticketPromedio",
      label: "Ticket promedio",
      get: (b) => b.ticketPromedio,
      format: formatPrice,
      better: "high",
      // Promedio ponderado del conjunto: total vendido / tickets, no la
      // media de los promedios por sucursal.
      total: (rows) => {
        const count = rows.reduce((s, b) => s + b.ventasCount, 0)
        return count > 0 ? rows.reduce((s, b) => s + b.ventas, 0) / count : 0
      },
    },
    { key: "piezasVendidas", label: "Piezas vendidas", get: (b) => b.piezasVendidas, format: intFmt, better: "high" },
    { key: "mermas", label: "Mermas (pzs)", get: (b) => b.mermas, format: intFmt, better: "low" },
    { key: "mermasCosto", label: "Costo de mermas", get: (b) => b.mermasCosto, format: formatPrice, better: "low" },
    { key: "stockPiezas", label: "Stock actual (pzs)", get: (b) => b.stockPiezas, format: intFmt, better: "high" },
    { key: "productosConStock", label: "Productos con stock", get: (b) => b.productosConStock, format: intFmt, better: "high" },
    { key: "ordenesActivas", label: "Órdenes de taller activas", get: (b) => b.ordenesActivas, format: intFmt, better: "high" },
  ]

  const branches = data?.branches ?? []
  const comparar = branches.length > 1

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5" />
              Comparador de Sucursales
            </CardTitle>
            <CardDescription>
              Ventas cobradas, piezas, mermas y taller por sucursal · últimos{" "}
              {dias} días
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border p-0.5 gap-0.5">
              {PERIODOS.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={dias === d ? "default" : "ghost"}
                  className="h-7 px-2.5"
                  onClick={() => setDias(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>
            <Button
              onClick={fetchData}
              variant="outline"
              size="sm"
              disabled={loading}
              aria-label="Actualizar comparador"
            >
              <RefreshCw
                className={`h-4 w-4${loading ? " animate-spin" : ""}`}
              />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error || !data ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-sm text-destructive">
              {error || "Error desconocido"}
            </p>
            <Button onClick={fetchData} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        ) : branches.length === 0 ? (
          <EmptyState
            icon={Store}
            title="No hay sucursales activas"
            description="Activa una sucursal para comparar sus ventas, inventario y taller."
          />
        ) : (
          <>
            <div className="rounded-lg border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[160px]">Métrica</TableHead>
                    {branches.map((b) => (
                      <TableHead key={b.id} className="text-right min-w-[110px]">
                        {b.name}
                      </TableHead>
                    ))}
                    {comparar && (
                      <TableHead className="text-right min-w-[110px] border-l">
                        Total
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map((m) => {
                    const values = branches.map((b) => m.get(b))
                    const best =
                      m.better === "low"
                        ? Math.min(...values)
                        : Math.max(...values)
                    // Si todas empatan no hay "mejor" que resaltar.
                    const empate = values.every((v) => v === values[0])
                    const total = m.total
                      ? m.total(branches)
                      : values.reduce((s, v) => s + v, 0)
                    return (
                      <TableRow key={m.key}>
                        <TableCell className="font-medium">
                          {m.label}
                        </TableCell>
                        {branches.map((b, i) => {
                          const v = values[i]
                          const isBest = comparar && !empate && v === best
                          const deltaPct =
                            comparar && !empate && v !== best && best !== 0
                              ? ((v - best) / best) * 100
                              : null
                          return (
                            <TableCell key={b.id} className="text-right">
                              <span
                                className={
                                  isBest
                                    ? "font-semibold text-green-600"
                                    : undefined
                                }
                              >
                                {m.format(v)}
                              </span>
                              {isBest && (
                                <Trophy className="ml-1 inline h-3 w-3 text-green-500" />
                              )}
                              {deltaPct !== null && (
                                <p className="text-[11px] text-muted-foreground">
                                  {deltaPct > 0 ? "+" : ""}
                                  {Math.round(deltaPct)}% vs mejor
                                </p>
                              )}
                            </TableCell>
                          )
                        })}
                        {comparar && (
                          <TableCell className="text-right font-medium border-l">
                            {m.format(total)}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Ventas COMPLETED de los últimos {dias} días; piezas netas de
              devoluciones. Mermas estimadas al costo actual del producto.
              Stock y órdenes de taller son el estado actual.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
