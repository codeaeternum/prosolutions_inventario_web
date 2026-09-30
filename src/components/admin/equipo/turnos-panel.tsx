"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, History, RefreshCw } from "lucide-react"

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

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/actividad/turnos?dias=${dias}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTurnos(data.turnos ?? [])
    } catch {
      setError("No se pudo cargar los turnos")
    } finally {
      setLoading(false)
    }
  }, [dias])

  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  // Agrupar por día para encabezados
  const porDia = new Map<string, TurnoDia[]>()
  for (const t of turnos) {
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
        <div className="flex items-center gap-2">
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="14">14 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="60">60 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !loading && turnos.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin actividad registrada en el período.</p>
        )}
        {[...porDia.entries()].map(([dia, rows]) => (
          <div key={dia} className="mb-6 last:mb-0">
            <h3 className="text-sm font-semibold text-muted-foreground capitalize mb-2">{fmtDia(dia)}</h3>
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
        ))}
      </CardContent>
    </Card>
  )
}
