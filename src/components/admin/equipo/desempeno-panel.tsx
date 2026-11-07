"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, Download, History, RefreshCw, Search, ShieldAlert, TrendingUp } from "lucide-react"
import { csvCell } from "@/lib/csv"
import { formatPrice } from "@/lib/utils"

interface UsuarioDesempeno {
  id: string
  name: string
  role: string
  jobTitle: string | null
  ventas: number
  ventasCount: number
  piezasVendidas: number
  ordenesCreadas: number
  ordenesEntregadas: number
  movimientos: number
  acciones: number
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  EMPLOYEE: "Empleado",
  WORKSHOP: "Taller aliado",
  CUSTOMER: "Cliente",
}

/**
 * Desempeño (solo ADMIN): producción por empleado en el periodo — qué vendió,
 * qué OTs capturó/entregó y cuánto movió en inventario, más su total de
 * acciones en el sistema. Responde "¿qué produjo Kevin esta semana?" sin
 * cruzar tres pantallas. Consume GET /api/actividad/desempeno.
 */
export function DesempenoPanel() {
  const [usuarios, setUsuarios] = useState<UsuarioDesempeno[]>([])
  const [dias, setDias] = useState("30")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    try {
      const res = await fetch(`/api/actividad/desempeno?dias=${dias}`, { signal })
      if (signal?.aborted) return
      if (res.status === 401 || res.status === 403) {
        setForbidden(true)
        setUsuarios([])
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (signal?.aborted) return
      setUsuarios(data.usuarios ?? [])
    } catch {
      if (!signal?.aborted) setError("No se pudo cargar el desempeño del equipo")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [dias])

  useEffect(() => {
    const controller = new AbortController()
    const t = setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [load])

  const filteredUsuarios = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return usuarios
    return usuarios.filter((u) => {
      const puesto = (u.jobTitle?.trim() || ROLE_LABELS[u.role] || u.role).toLowerCase()
      return (
        u.name.toLowerCase().includes(q) ||
        (u.jobTitle ?? "").toLowerCase().includes(q) ||
        puesto.includes(q)
      )
    })
  }, [usuarios, searchQuery])

  const resumenEquipo = useMemo(() => {
    // ventas llega en pesos (Float): el total del equipo se acumula en
    // centavos enteros y se expone en pesos.
    const acc = filteredUsuarios.reduce(
      (acc, u) => ({
        ventasCents: acc.ventasCents + Math.round(u.ventas * 100),
        ventasCount: acc.ventasCount + u.ventasCount,
        ordenesCreadas: acc.ordenesCreadas + u.ordenesCreadas,
        ordenesEntregadas: acc.ordenesEntregadas + u.ordenesEntregadas,
        piezasVendidas: acc.piezasVendidas + u.piezasVendidas,
      }),
      {
        ventasCents: 0,
        ventasCount: 0,
        ordenesCreadas: 0,
        ordenesEntregadas: 0,
        piezasVendidas: 0,
      }
    )
    const { ventasCents, ...rest } = acc
    return { ...rest, ventas: ventasCents / 100 }
  }, [filteredUsuarios])

  const handleExportCsv = () => {
    if (filteredUsuarios.length === 0) return
    const headers = [
      "Empleado",
      "Rol",
      "Puesto",
      "Monto Ventas",
      "Núm. Ventas",
      "Piezas Vendidas",
      "OT Creadas",
      "OT Entregadas",
      "Movimientos Inventario",
      "Acciones Totales",
    ]
    const rows = filteredUsuarios.map((u) => [
      u.name,
      ROLE_LABELS[u.role] || u.role,
      u.jobTitle?.trim() || "",
      u.ventas,
      u.ventasCount,
      u.piezasVendidas,
      u.ordenesCreadas,
      u.ordenesEntregadas,
      u.movimientos,
      u.acciones,
    ])
    const lines = [
      headers.map(csvCell).join(","),
      ...rows.map((r) => r.map(csvCell).join(",")),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `desempeno-equipo-${dias}d-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-center">
          Solo administradores pueden ver el desempeño del equipo
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="h-5 w-5" />
            Desempeño
          </CardTitle>
          <CardDescription>
            Qué produjo cada quien en el periodo: ventas, taller e inventario
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || filteredUsuarios.length === 0}
            aria-label="Exportar desempeño del equipo a CSV"
          >
            <Download className="h-4 w-4 mr-2" />
            Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !loading && usuarios.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin empleados registrados.</p>
        )}
        {usuarios.length > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Ventas totales del equipo</div>
                <div className="text-lg font-semibold mt-0.5">{formatPrice(resumenEquipo.ventas)}</div>
                <div className="text-xs text-muted-foreground">
                  {resumenEquipo.ventasCount} {resumenEquipo.ventasCount === 1 ? "venta" : "ventas"}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">OTs creadas / entregadas</div>
                <div className="text-lg font-semibold mt-0.5">
                  {resumenEquipo.ordenesCreadas} / {resumenEquipo.ordenesEntregadas}
                </div>
                <div className="text-xs text-muted-foreground">
                  {resumenEquipo.ordenesCreadas} creadas · {resumenEquipo.ordenesEntregadas} entregadas
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Piezas vendidas</div>
                <div className="text-lg font-semibold mt-0.5">{resumenEquipo.piezasVendidas}</div>
                <div className="text-xs text-muted-foreground">
                  En {dias} días
                </div>
              </div>
            </div>

            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o puesto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar empleado por nombre o puesto"
                className="pl-9"
              />
            </div>

            {filteredUsuarios.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin empleados que coincidan con &ldquo;{searchQuery}&rdquo;.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empleado</TableHead>
                      <TableHead className="text-right">Ventas</TableHead>
                      <TableHead className="text-right">Piezas</TableHead>
                      <TableHead className="text-right">OT creadas</TableHead>
                      <TableHead className="text-right">OT entregadas</TableHead>
                      <TableHead className="text-right">Movs. inventario</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsuarios.map(u => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {u.jobTitle?.trim() || ROLE_LABELS[u.role] || u.role}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-semibold">{formatPrice(u.ventas)}</div>
                          <div className="text-xs text-muted-foreground">
                            {u.ventasCount} {u.ventasCount === 1 ? "venta" : "ventas"}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{u.piezasVendidas}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{u.ordenesCreadas}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{u.ordenesEntregadas}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{u.movimientos}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{u.acciones}</Badge>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" asChild title="Ver su actividad">
                            <Link href={`/admin/equipo?tab=actividad&actor=${u.id}&anombre=${encodeURIComponent(u.name)}`}>
                              <History className="h-4 w-4 mr-1" />
                              Actividad
                            </Link>
                          </Button>
                          <Button variant="ghost" size="sm" asChild title="Ver turnos del equipo">
                            <Link href="/admin/equipo?tab=turnos">
                              <Clock className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
