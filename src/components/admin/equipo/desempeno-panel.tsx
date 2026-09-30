"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Clock, History, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react"
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    try {
      const res = await fetch(`/api/actividad/desempeno?dias=${dias}`)
      if (res.status === 401 || res.status === 403) {
        setForbidden(true)
        setUsuarios([])
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setUsuarios(data.usuarios ?? [])
    } catch {
      setError("No se pudo cargar el desempeño del equipo")
    } finally {
      setLoading(false)
    }
  }, [dias])

  useEffect(() => {
    const t = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(t)
  }, [load])

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
        <div className="flex items-center gap-2">
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !loading && usuarios.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin empleados registrados.</p>
        )}
        {usuarios.length > 0 && (
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
                {usuarios.map(u => (
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
      </CardContent>
    </Card>
  )
}
