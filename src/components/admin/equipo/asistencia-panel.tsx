"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertTriangle, DoorOpen, History, Loader2, LogIn, LogOut, Pencil, RefreshCw, Search, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { businessDayKey } from "@/lib/business-time"
import { JORNADA_MAX_MS } from "@/lib/asistencia"

// Misma forma que JornadaDerivada de lib/asistencia (la respuesta del GET).
interface Jornada {
  inEventId: string
  inAt: string
  outEventId: string | null
  outAt: string | null
  /** null en jornada abandonada (openEnded): no se inventan minutos. */
  minutos: number | null
  /** IN sin OUT dentro de la ventana de 16 h: sigue corriendo. */
  open?: boolean
  /** Abandonada (>16 h sin cierre): no es una jornada vigente. */
  openEnded?: boolean
  source?: string
}

// ClockEvent serializado del GET: las marcas crudas del periodo, con su id
// para PATCH /api/asistencia/[eventId].
interface ClockEventItem {
  id: string
  type: string
  at: string
  note: string | null
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

const fmtFechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" })

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

// datetime-local habla hora LOCAL del navegador (igual que los inputs del
// taller: toISOString daría UTC y el navegador compara literal).
const toLocalInput = (instant: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}T${pad(instant.getHours())}:${pad(instant.getMinutes())}`
}

/** Valor de un input datetime-local → ISO; null si no es fecha válida. */
const localInputToIso = (value: string): string | null => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * Sugerencia de cierre para una jornada abandonada: el fin del día en que
 * abrió, pero nunca más allá de la ventana de 16 h (una salida más tardía
 * derivaría otra vez en openEnded) ni en el futuro.
 */
const cierreSugerido = (inAt: string): Date => {
  const entrada = new Date(inAt)
  const finDelDia = new Date(entrada)
  finDelDia.setHours(23, 59, 0, 0)
  const maxVentana = new Date(entrada.getTime() + JORNADA_MAX_MS - 60_000)
  return new Date(Math.min(finDelDia.getTime(), maxVentana.getTime(), Date.now()))
}

/**
 * Asistencia (solo ADMIN): checadas de entrada y salida de todo el equipo
 * agrupadas por persona, cruzadas con /api/users para listar también a
 * quien no ha marcado. A diferencia de Turnos (reconstruido de la
 * actividad), aquí la jornada la marca cada quien con el reloj.
 *
 * Correcciones del dueño (quedan en la bitácora):
 * - "Cerrar turno" crea el OUT faltante de una jornada abierta/abandonada
 *   (POST /api/asistencia/cerrar) — la hora la elige el admin, nunca se
 *   inventa sola.
 * - "Corregir" lista las marcas del periodo y permite mover la hora de una
 *   o anotarla (PATCH /api/asistencia/[eventId]) sin invertir IN→OUT.
 */
export function AsistenciaPanel() {
  const [staff, setStaff] = useState<StaffUser[]>([])
  // userId → jornadas + marcas crudas del checador en el periodo.
  const [porUsuario, setPorUsuario] = useState<Map<string, { name: string; jornadas: Jornada[]; events: ClockEventItem[] }>>(new Map())
  const [preset, setPreset] = useState<Preset>("hoy")
  const [periodo, setPeriodo] = useState<{ from: string; to: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Diálogo "Cerrar turno": apunta a la jornada sin salida más antigua del
  // usuario (la misma candidata que el endpoint toma con outAt grande).
  const [cerrarTarget, setCerrarTarget] = useState<{ userId: string; name: string; inAt: string; openEnded: boolean } | null>(null)
  const [cerrarForm, setCerrarForm] = useState({ outAt: "", note: "" })
  const [cerrando, setCerrando] = useState(false)

  // Diálogo "Corregir": lista las marcas del usuario en el periodo; solo una
  // fila entra en edición a la vez.
  const [corregirTarget, setCorregirTarget] = useState<{ userId: string; name: string } | null>(null)
  const [editando, setEditando] = useState<{ id: string; at: string; note: string } | null>(null)
  const [guardando, setGuardando] = useState(false)

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
      const mapa = new Map<string, { name: string; jornadas: Jornada[]; events: ClockEventItem[] }>()
      for (const u of data?.users ?? []) {
        mapa.set(u.userId, {
          name: typeof u.name === "string" ? u.name : "Usuario",
          jornadas: Array.isArray(u.jornadas) ? u.jornadas : [],
          events: Array.isArray(u.events) ? u.events : [],
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
      const data = porUsuario.get(user.id)
      const js = (data?.jornadas ?? []).slice().sort((a, b) => a.inAt.localeCompare(b.inAt))
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
      // Jornada sin salida más antigua (abierta o abandonada): es la que
      // "Cerrar turno" sugiere corregir.
      const sinSalida = open ?? js.find(j => j.openEnded === true) ?? null
      return { user, jornadas: js, events: data?.events ?? [], open, sinSalida, cerradas: js.length - (open ? 1 : 0), abandonadas, totalMin, hasTiempo, fuentes }
    })
    // Quien checó pero ya no aparece como staff vigente (suspendido después,
    // p. ej.): la bitácora del día no lo debe esconder — sale con el nombre
    // que devolvió la API, sin puesto.
    for (const [userId, m] of porUsuario) {
      if (!staff.some(s => s.id === userId)) {
        const js = m.jornadas
        const open = js.find(j => j.open === true) ?? null
        items.push({
          user: { id: userId, name: m.name, jobTitle: null, role: "" },
          jornadas: js,
          events: m.events,
          open,
          sinSalida: open ?? js.find(j => j.openEnded === true) ?? null,
          cerradas: js.filter(j => j.open !== true).length,
          abandonadas: js.filter(j => j.openEnded === true).length,
          totalMin: js.reduce((sum, j) => sum + (j.minutos ?? 0), 0),
          hasTiempo: js.some(j => j.minutos !== null),
          fuentes: [...new Set(js.map(j => j.source).filter((s): s is string => Boolean(s)))],
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

  const openCerrar = (r: (typeof rows)[number]) => {
    if (!r.sinSalida) return
    const sugerida = r.sinSalida.open === true ? new Date() : cierreSugerido(r.sinSalida.inAt)
    setCerrarTarget({ userId: r.user.id, name: r.user.name, inAt: r.sinSalida.inAt, openEnded: r.sinSalida.openEnded === true })
    setCerrarForm({ outAt: toLocalInput(sugerida), note: "" })
  }

  const submitCerrar = async () => {
    if (!cerrarTarget) return
    const iso = localInputToIso(cerrarForm.outAt)
    if (!iso) {
      toast.error("Revisa la hora de salida: no es una fecha válida.")
      return
    }
    setCerrando(true)
    try {
      const res = await fetch("/api/asistencia/cerrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: cerrarTarget.userId,
          outAt: iso,
          note: cerrarForm.note.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) {
        toast.success("Jornada cerrada: se registró la salida corregida.")
        setCerrarTarget(null)
        void load()
        return
      }
      toast.error(data.error || "No se pudo cerrar la jornada")
    } catch {
      toast.error("Error de conexión")
    } finally {
      setCerrando(false)
    }
  }

  const openCorregir = (r: (typeof rows)[number]) => {
    setCorregirTarget({ userId: r.user.id, name: r.user.name })
    setEditando(null)
  }

  const submitCorreccion = async (event: ClockEventItem) => {
    if (!editando) return
    const iso = localInputToIso(editando.at)
    if (!iso) {
      toast.error("Revisa la hora: no es una fecha válida.")
      return
    }
    setGuardando(true)
    try {
      const res = await fetch(`/api/asistencia/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ at: iso, note: editando.note.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success("Marca corregida")
        setEditando(null)
        void load()
        return
      }
      toast.error(data.error || "No se pudo corregir la marca")
    } catch {
      toast.error("Error de conexión")
    } finally {
      setGuardando(false)
    }
  }

  // Eventos visibles en el diálogo de corrección: salen del mismo mapa para
  // que un PATCH exitoso se refleje al instante tras el refetch.
  const eventosCorregir = (corregirTarget ? porUsuario.get(corregirTarget.userId)?.events : undefined) ?? []

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
                        <div className="flex items-center justify-end gap-1">
                          {r.sinSalida && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openCerrar(r)}
                              title={r.open ? "Registrar la salida que falta" : "Cerrar una jornada sin salida"}
                            >
                              <DoorOpen className="h-4 w-4 mr-1" />
                              Cerrar turno
                            </Button>
                          )}
                          {r.events.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openCorregir(r)}
                              title="Corregir la hora o la nota de una marca"
                            >
                              <Pencil className="h-4 w-4 mr-1" />
                              Corregir
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/equipo?tab=actividad&actor=${r.user.id}&anombre=${encodeURIComponent(r.user.name)}`}>
                              <History className="h-4 w-4 mr-1" />
                              Ver
                            </Link>
                          </Button>
                        </div>
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

      {/* Cerrar turno: el admin elige la hora real de salida; el servidor
          decide a qué entrada sin pareja se la asigna (la más antigua
          compatible) y todo queda en la bitácora. */}
      <Dialog open={cerrarTarget !== null} onOpenChange={open => { if (!open && !cerrando) setCerrarTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar turno de {cerrarTarget?.name}</DialogTitle>
            <DialogDescription>
              {cerrarTarget && (
                <>
                  {cerrarTarget.openEnded
                    ? `La entrada del ${fmtFechaHora(cerrarTarget.inAt)} quedó sin salida.`
                    : `En turno desde las ${fmtHora(cerrarTarget.inAt)}.`}
                  {" "}Se registrará una salida (OUT) con la hora que indiques; si hay
                  varias jornadas sin salida se cierra la más antigua compatible.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="cerrar-out-at" className="text-xs">Hora de salida</Label>
              <Input
                id="cerrar-out-at"
                type="datetime-local"
                value={cerrarForm.outAt}
                min={cerrarTarget ? toLocalInput(new Date(cerrarTarget.inAt)) : undefined}
                max={toLocalInput(new Date())}
                onChange={e => setCerrarForm(f => ({ ...f, outAt: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="cerrar-note" className="text-xs">Nota (opcional)</Label>
              <Input
                id="cerrar-note"
                value={cerrarForm.note}
                maxLength={280}
                placeholder="Olvidó marcar la salida…"
                onChange={e => setCerrarForm(f => ({ ...f, note: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCerrarTarget(null)} disabled={cerrando}>
              Cancelar
            </Button>
            <Button onClick={() => void submitCerrar()} disabled={cerrando || !cerrarForm.outAt}>
              {cerrando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Registrar salida
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Corregir marcas: historial crudo del periodo con edición inline de
          hora y nota por evento. */}
      <Dialog open={corregirTarget !== null} onOpenChange={open => { if (!open && !guardando) { setCorregirTarget(null); setEditando(null) } }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Corregir marcas de {corregirTarget?.name}</DialogTitle>
            <DialogDescription>
              Ajusta la hora de una entrada o salida (p. ej. una checada tardía u
              olvidada) o edita su nota. Cada corrección queda en la bitácora.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto">
            {eventosCorregir.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin marcas en el periodo {periodo?.from} → {periodo?.to}.
              </p>
            )}
            {eventosCorregir.map(ev => (
              <div key={ev.id} className="rounded-lg border p-3">
                {editando?.id === ev.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {ev.type === "OUT"
                        ? <LogOut className="h-4 w-4 text-muted-foreground" />
                        : <LogIn className="h-4 w-4 text-muted-foreground" />}
                      <span className="text-sm font-medium">{ev.type === "OUT" ? "Salida" : "Entrada"}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs" htmlFor={`edit-at-${ev.id}`}>Hora</Label>
                        <Input
                          id={`edit-at-${ev.id}`}
                          type="datetime-local"
                          value={editando.at}
                          max={toLocalInput(new Date())}
                          onChange={e => setEditando(ed => ed ? { ...ed, at: e.target.value } : ed)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor={`edit-note-${ev.id}`}>Nota</Label>
                        <Input
                          id={`edit-note-${ev.id}`}
                          value={editando.note}
                          maxLength={280}
                          placeholder="Motivo de la corrección…"
                          onChange={e => setEditando(ed => ed ? { ...ed, note: e.target.value } : ed)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditando(null)} disabled={guardando}>
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={() => void submitCorreccion(ev)} disabled={guardando || !editando.at}>
                        {guardando && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                        Guardar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {ev.type === "OUT"
                        ? <LogOut className="h-4 w-4 text-muted-foreground shrink-0" />
                        : <LogIn className="h-4 w-4 text-muted-foreground shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {ev.type === "OUT" ? "Salida" : "Entrada"} · {fmtFechaHora(ev.at)}
                        </p>
                        {ev.note && <p className="text-xs text-muted-foreground truncate">{ev.note}</p>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditando({ id: ev.id, at: toLocalInput(new Date(ev.at)), note: ev.note ?? "" })}
                      disabled={editando !== null}
                      aria-label={`Corregir ${ev.type === "OUT" ? "salida" : "entrada"} de ${fmtFechaHora(ev.at)}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
