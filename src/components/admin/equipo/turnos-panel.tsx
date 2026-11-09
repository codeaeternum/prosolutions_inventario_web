"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Clock, Download, History, RefreshCw, Search, AlertTriangle } from "lucide-react"
import { csvCell } from "@/lib/csv"
import { formatBusinessTime } from "@/lib/business-time"

interface TurnoDia {
  dia: string
  actorId: string
  actorName: string
  firstAt: string
  lastAt: string
  minutosActivo: number
  eventos: number
  porTipo: Record<string, number>
}

// Horas de turno en la zona del negocio (business-time), no en la del dispositivo.
const fmtHora = formatBusinessTime

const fmtDia = (dia: string) =>
  new Date(`${dia}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })

const fmtDuracion = (min: number) =>
  min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ""}`.trim()

/**
 * Turnos: no hay checador — la jornada se reconstruye del primer al último
 * movimiento registrado ese día (bitácora + operaciones). "Kevin estuvo de
 * 9:12 a 18:44 y movió 23 cosas" sin que nadie fiche nada.
 */
export function TurnosPanel() {
  const [turnos, setTurnos] = useState<TurnoDia[]>([])
  const [dias, setDias] = useState("14")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/actividad/turnos?dias=${dias}`, { signal })
      if (signal?.aborted) return
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (signal?.aborted) return
      setTurnos(data.turnos ?? [])
    } catch {
      if (!signal?.aborted) setError("No se pudo cargar los turnos")
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

  const filteredTurnos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return turnos
    return turnos.filter(t => t.actorName.toLowerCase().includes(q))
  }, [turnos, searchQuery])

  const handleExportCsv = () => {
    if (filteredTurnos.length === 0) return
    const headers = [
      "Fecha",
      "Empleado",
      "Primer Movimiento",
      "Último Movimiento",
      "Minutos Activo",
      "Duración",
      "Total Movimientos",
    ]
    const rows = filteredTurnos.map(t => [
      t.dia,
      t.actorName,
      fmtHora(t.firstAt),
      fmtHora(t.lastAt),
      t.minutosActivo,
      fmtDuracion(t.minutosActivo),
      t.eventos,
    ])
    const lines = [headers.map(csvCell).join(","), ...rows.map(r => r.map(csvCell).join(","))]
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `turnos-equipo-${dias}d-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Agrupar por día para encabezados
  const porDia = new Map<string, TurnoDia[]>()
  for (const t of filteredTurnos) {
    const list = porDia.get(t.dia) ?? []
    list.push(t)
    porDia.set(t.dia, list)
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" />
            Turnos
          </CardTitle>
          <CardDescription>
            De qué hora a qué hora se movió cada quien, reconstruido de su actividad real
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar por empleado..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Filtrar turnos por nombre de empleado"
              className="pl-8 h-9"
            />
          </div>
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="14">14 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="60">60 días</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={loading || filteredTurnos.length === 0}
            aria-label="Exportar turnos a CSV"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Exportar CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && turnos.length === 0 ? (
          // Skeleton con forma de filas de turno: la primera carga no deja
          // la tarjeta en blanco.
          <div className="space-y-4" aria-busy="true" aria-label="Cargando turnos">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <div className="rounded-lg border p-3 flex items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-6 w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        ) : (
          <>
        {turnos.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin actividad registrada en el período.</p>
        )}
        {turnos.length > 0 && filteredTurnos.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin resultados para &ldquo;{searchQuery.trim()}&rdquo;.</p>
        )}
        {[...porDia.entries()].map(([dia, rows]) => (
          <div key={dia} className="mb-6 last:mb-0">
            <h3 className="text-sm font-semibold text-muted-foreground capitalize mb-2">{fmtDia(dia)}</h3>
            {/* Vista móvil: tarjetas por empleado — la tabla no cabe en <768px */}
            <div className="grid gap-3 md:hidden">
              {rows.map(t => (
                <div key={`${t.actorId}-${t.dia}`} className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{t.actorName}</p>
                    <Badge variant="secondary">{fmtDuracion(t.minutosActivo)}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="tabular-nums">{fmtHora(t.firstAt)} – {fmtHora(t.lastAt)}</span>
                    <span className="text-xs">· {t.eventos} movimientos</span>
                  </div>
                  <Button variant="outline" size="sm" asChild className="w-full">
                    <Link href={`/admin/equipo?tab=actividad&actor=${t.actorId}&anombre=${encodeURIComponent(t.actorName)}`}>
                      <History className="h-4 w-4 mr-1" />
                      Ver actividad
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Primer movimiento</TableHead>
                  <TableHead>Último movimiento</TableHead>
                  <TableHead>Tiempo activo</TableHead>
                  <TableHead className="text-right">Movimientos</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(t => (
                  <TableRow key={`${t.actorId}-${t.dia}`}>
                    <TableCell className="font-medium">{t.actorName}</TableCell>
                    <TableCell>{fmtHora(t.firstAt)}</TableCell>
                    <TableCell>{fmtHora(t.lastAt)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{fmtDuracion(t.minutosActivo)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{t.eventos}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/equipo?tab=actividad&actor=${t.actorId}&anombre=${encodeURIComponent(t.actorName)}`}>
                          <History className="h-4 w-4 mr-1" />
                          Ver
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </div>
        ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}
