"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertTriangle, History, LogIn, RefreshCw, Search, ShieldAlert } from "lucide-react"
import { businessDayKey } from "@/lib/business-time"

// Misma forma que JornadaDerivada de lib/asistencia (la respuesta del GET).
interface Jornada {
  inAt: string
  outAt: string | null
  /** null en jornada abandonada (openEnded): no se inventan minutos. */
  minutos: number | null
  /** IN sin OUT dentro de la ventana de 16 h: sigue corriendo. */
  open?: boolean
  /** Abandonada (>16 h sin cierre): no es una jornada vigente. */
  openEnded?: boolean
  source?: string
}

interface StaffUser {
  id: string
  name: string
  jobTitle: string | null
  role: string
}

const STAFF_ROLES = ["ADMIN", "EMPLOYEE", "WORKSHOP"] as const

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })

const fmtDuracion = (min: number) => {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} m` : `${h} h`
}

// Las llaves de día "YYYY-MM-DD" son días completos en la zona del negocio,
// mismo criterio que el rango from/to del endpoint.
const shiftDayKey = (key: string, days: number) => {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

type Preset = "hoy" | "ayer" | "7d"

const rangeFor = (preset: Preset): { from: string; to: string } => {
  const today = businessDayKey(new Date())
  switch (preset) {
    case "ayer": {
      const ayer = shiftDayKey(today, -1)
      return { from: ayer, to: ayer }
    }
    case "7d":
      return { from: shiftDayKey(today, -6), to: today }
    default:
      return { from: today, to: today }
  }
}

const fuenteLabel = (fuente: string) =>
  fuente === "reloj" ? "Reloj" : fuente === "actividad" ? "Actividad" : fuente

/**
 * Asistencia (solo ADMIN): checadas de entrada y salida de todo el equipo
 * agrupadas por persona, cruzadas con /api/users para listar también a
 * quien no ha marcado. A diferencia de Turnos (reconstruido de la
 * actividad), aquí la jornada la marca cada quien con el reloj.
 */
export function AsistenciaPanel() {
  const [staff, setStaff] = useState<StaffUser[]>([])
  // userId → jornadas del checador en el periodo (vienen agrupadas del GET).
  const [porUsuario, setPorUsuario] = useState<Map<string, { name: string; jornadas: Jornada[] }>>(new Map())
  const [preset, setPreset] = useState<Preset>("hoy")
  const [periodo, setPeriodo] = useState<{ from: string; to: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    setForbidden(false)
    try {
      const { from, to } = rangeFor(preset)
      const [asisRes, ...roleRes] = await Promise.all([
        fetch(`/api/asistencia?from=${from}&to=${to}`, { signal }),
        ...STAFF_ROLES.map(role =>
          fetch(`/api/users?role=${role}&status=APPROVED&limit=100`, { signal })
        ),
      ])
      if (signal?.aborted) return
      if (asisRes.status === 401 || asisRes.status === 403) {
        setForbidden(true)
        setStaff([])
        setPorUsuario(new Map())
        return
      }
      if (!asisRes.ok) throw new Error()
      const data = await asisRes.json()

      const list: StaffUser[] = []
      for (const r of roleRes) {
        if (!r.ok) continue
        const d = await r.json().catch(() => null)
        for (const u of d?.users ?? []) {
          list.push({ id: u.id, name: u.name, jobTitle: u.jobTitle ?? null, role: u.role })
        }
      }
      if (signal?.aborted) return

      // Respuesta: { period, users: [{ userId, name, events, jornadas }] }
      // — la vista de negocio solo incluye a quien sí checó en el rango.
      const mapa = new Map<string, { name: string; jornadas: Jornada[] }>()
      for (const u of data?.users ?? []) {
        mapa.set(u.userId, {
          name: typeof u.name === "string" ? u.name : "Usuario",
          jornadas: Array.isArray(u.jornadas) ? u.jornadas : [],
        })
      }
      setStaff(list.sort((a, b) => a.name.localeCompare(b.name)))
      setPorUsuario(mapa)
      setPeriodo({ from, to })
    } catch {
      if (!signal?.aborted) setError("No se pudo cargar la asistencia")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [preset])

  useEffect(() => {
    const controller = new AbortController()
    const t = setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [load])

  const anyOpen = [...porUsuario.values()].some(u => u.jornadas.some(j => j.open === true))

  // Reloj del "En turno desde…": un tick por minuto solo mientras haya
  // jornadas abiertas visibles.
  useEffect(() => {
    if (!anyOpen) return
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [anyOpen])

  const rows = useMemo(() => {
    const items = staff.map(user => {
      const js = (porUsuario.get(user.id)?.jornadas ?? []).slice().sort((a, b) => a.inAt.localeCompare(b.inAt))
      const open = js.find(j => j.open === true) ?? null
      const abandonadas = js.filter(j => j.openEnded === true).length
      const totalMin = js.reduce((sum, j) =>
        sum + (j.open === true
          // Jornada abierta: el tiempo vivo se calcula con `now` para que
          // el contador siga corriendo mientras la pestaña está abierta.
          ? Math.max(0, Math.round((now - new Date(j.inAt).getTime()) / 60_000))
          : (j.minutos ?? 0)), 0)
      // "Sin duración registrada" cuando todo lo marcado quedó abandonado.
      const hasTiempo = js.some(j => j.open === true || j.minutos !== null)
      const fuentes = [...new Set(js.map(j => j.source).filter((s): s is string => Boolean(s)))]
      return { user, jornadas: js, open, cerradas: js.length - (open ? 1 : 0), abandonadas, totalMin, hasTiempo, fuentes }
    })
    // Quien checó pero ya no aparece como staff vigente (suspendido después,
    // p. ej.): la bitácora del día no lo debe esconder — sale con el nombre
    // que devolvió la API, sin puesto.
    for (const [userId, m] of porUsuario) {
      if (!staff.some(s => s.id === userId)) {
        items.push({
          user: { id: userId, name: m.name, jobTitle: null, role: "" },
          jornadas: m.jornadas,
          open: m.jornadas.find(j => j.open === true) ?? null,
          cerradas: m.jornadas.filter(j => j.open !== true).length,
          abandonadas: m.jornadas.filter(j => j.openEnded === true).length,
          totalMin: m.jornadas.reduce((sum, j) => sum + (j.minutos ?? 0), 0),
          hasTiempo: m.jornadas.some(j => j.minutos !== null),
          fuentes: [...new Set(m.jornadas.map(j => j.source).filter((s): s is string => Boolean(s)))],
        })
      }
    }
    // Quien está en turno primero, luego los que marcaron (más tiempo
    // arriba) y al final los "Sin marcar" en orden alfabético.
    return items.sort((a, b) => {
      if (a.open && !b.open) return -1
      if (!a.open && b.open) return 1
      if ((a.jornadas.length > 0) !== (b.jornadas.length > 0)) return a.jornadas.length > 0 ? -1 : 1
      if (a.jornadas.length > 0 && b.jornadas.length > 0) return b.totalMin - a.totalMin
      return a.user.name.localeCompare(b.user.name)
    })
  }, [staff, porUsuario, now])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.user.name.toLowerCase().includes(q) || (r.user.jobTitle ?? "").toLowerCase().includes(q)
    )
  }, [rows, searchQuery])

  // La columna Fuente solo existe si el backend expone `source` en alguna
  // jornada; sin el campo se omite sin romper nada.
  const showFuente = rows.some(r => r.fuentes.length > 0)

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <ShieldAlert className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-center">
          Solo administradores pueden ver la asistencia del equipo
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LogIn className="h-5 w-5" />
            Asistencia
          </CardTitle>
          <CardDescription>
            Entradas y salidas marcadas por el equipo con el reloj de asistencia
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filtrar por empleado..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Filtrar asistencia por nombre o puesto"
              className="pl-8 h-9"
            />
          </div>
          <Select value={preset} onValueChange={v => setPreset(v as Preset)}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hoy">Hoy</SelectItem>
              <SelectItem value="ayer">Ayer</SelectItem>
              <SelectItem value="7d">Últimos 7 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="space-y-3" aria-busy="true" aria-label="Cargando asistencia">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border p-3 flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reintentar
            </Button>
          </div>
        )}
        {!loading && !error && staff.length === 0 && porUsuario.size === 0 && (
          <p className="text-sm text-muted-foreground">No hay personal registrado en el negocio.</p>
        )}
        {!loading && !error && staff.length > 0 && porUsuario.size === 0 && (
          <p className="text-sm text-muted-foreground">
            Nadie ha marcado asistencia aún — el registro por actividad sigue en{" "}
            <Link href="/admin/equipo?tab=turnos" className="text-primary hover:underline">Turnos</Link>.
          </p>
        )}
        {!loading && !error && porUsuario.size > 0 && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin resultados para &ldquo;{searchQuery.trim()}&rdquo;.</p>
        )}
        {!loading && !error && porUsuario.size > 0 && filtered.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Tiempo</TableHead>
                    {showFuente && <TableHead>Fuente</TableHead>}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow key={r.user.id}>
                      <TableCell>
                        <div className="font-medium">{r.user.name}</div>
                        {r.user.jobTitle && (
                          <div className="text-xs text-muted-foreground">{r.user.jobTitle}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.open ? (
                          <div>
                            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">
                              En turno desde {fmtHora(r.open.inAt)}
                            </Badge>
                            {r.cerradas > 0 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                + {r.cerradas} {r.cerradas === 1 ? "jornada cerrada" : "jornadas cerradas"}
                              </p>
                            )}
                          </div>
                        ) : r.jornadas.length > 0 ? (
                          <div>
                            <span className="text-sm">
                              {r.jornadas.length} {r.jornadas.length === 1 ? "jornada" : "jornadas"}
                              {r.hasTiempo && ` — ${fmtDuracion(r.totalMin)}`}
                            </span>
                            {r.abandonadas > 0 && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {r.abandonadas} {r.abandonadas === 1 ? "sin salida registrada" : "sin salida registradas"}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin marcar</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.hasTiempo ? fmtDuracion(r.totalMin) : "—"}
                      </TableCell>
                      {showFuente && (
                        <TableCell>
                          {r.fuentes.length > 0 && (
                            <Badge variant="outline">
                              {r.fuentes.length > 1 ? "Mixto" : fuenteLabel(r.fuentes[0])}
                            </Badge>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/equipo?tab=actividad&actor=${r.user.id}&anombre=${encodeURIComponent(r.user.name)}`}>
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
            <p className="text-xs text-muted-foreground">
              Periodo {periodo?.from} → {periodo?.to} · las horas de una jornada abierta cuentan hasta ahora.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
