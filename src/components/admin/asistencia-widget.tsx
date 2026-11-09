"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Loader2, LogIn, LogOut, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { businessDayKey } from "@/lib/business-time"
import { JORNADA_ALERTA_MIN } from "@/lib/asistencia"

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
  /** Jornada abierta prolongada (>= 10 h). */
  longShift?: boolean
  source?: string
}

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })

const fmtDuracion = (min: number) => {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} m` : `${h} h`
}

/**
 * Checador personal del dashboard: marca entrada/salida del día vía
 * /api/asistencia. Es accesorio — si el endpoint responde 401/403 (rol sin
 * permiso o contexto donde no aplica) el widget no se renderiza en absoluto.
 */
export function AsistenciaWidget({ userId }: { userId?: string }) {
  const [jornadas, setJornadas] = useState<Jornada[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [posting, setPosting] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (signal?: AbortSignal) => {
    // Sin userId el GET pide vista de negocio (solo ADMIN): el widget es
    // personal, así que exige el id propio para no pedir datos ajenos.
    if (!userId) {
      setHidden(true)
      setLoading(false)
      return
    }
    setError(null)
    try {
      // Rango del día en fecha del negocio: el GET interpreta "YYYY-MM-DD"
      // como día completo en America/Mexico_City.
      const today = businessDayKey(new Date())
      const params = new URLSearchParams({ from: today, to: today, userId })
      const res = await fetch(`/api/asistencia?${params}`, { signal })
      if (signal?.aborted) return
      if (res.status === 401 || res.status === 403) {
        setHidden(true)
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (signal?.aborted) return
      // Respuesta: { period, users: [{ userId, name, events, jornadas }] }
      // — el usuario pedido sale aunque no tenga eventos (jornadas: []).
      setJornadas(Array.isArray(data?.users?.[0]?.jornadas) ? data.users[0].jornadas : [])
      setHidden(false)
    } catch {
      if (!signal?.aborted) setError("No se pudo cargar tu asistencia")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    const controller = new AbortController()
    const t = setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [load])

  const jornadaAbierta = jornadas.find(j => j.open === true) ?? null

  // Contador "llevas X h Y m": un tick por minuto solo mientras hay jornada
  // abierta (cerrada la jornada, el texto ya no cambia).
  useEffect(() => {
    if (!jornadaAbierta) return
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [jornadaAbierta])

  const marcar = async (type: "IN" | "OUT") => {
    if (posting) return
    setPosting(true)
    try {
      const res = await fetch("/api/asistencia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
      const data = await res.json().catch(() => null)
      if (res.status === 409) {
        // El estado pudo cambiar en otro dispositivo: el mensaje del
        // servidor manda y se refetchea para dibujar la verdad actual.
        toast.error(data?.error ?? "La marca choca con tu jornada actual")
        void load()
        return
      }
      if (res.status === 401 || res.status === 403) {
        setHidden(true)
        return
      }
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo registrar la marca")
        return
      }
      toast.success(type === "IN" ? "Entrada registrada" : "Salida registrada")
      void load()
    } catch {
      toast.error("Error de conexión al registrar la marca")
    } finally {
      setPosting(false)
    }
  }

  if (hidden || !userId) return null

  const elapsedMin = jornadaAbierta
    ? Math.max(0, Math.floor((now - new Date(jornadaAbierta.inAt).getTime()) / 60_000))
    : 0
  const isLongShift = Boolean(
    jornadaAbierta && (jornadaAbierta.longShift === true || elapsedMin >= JORNADA_ALERTA_MIN)
  )

  return (
    <Card className={!loading && !error && isLongShift ? "border-amber-500/40 bg-amber-500/5" : undefined}>
      <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`rounded-lg p-2 shrink-0 ${
              jornadaAbierta ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary"
            }`}
          >
            {jornadaAbierta ? <LogOut className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Tu jornada de hoy</p>
            {loading ? (
              <Skeleton className="h-4 w-44 mt-1" />
            ) : error ? (
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => void load()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Reintentar
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {jornadaAbierta
                    ? <>Llevas <span className="font-medium text-foreground tabular-nums">{fmtDuracion(elapsedMin)}</span> — entrada {fmtHora(jornadaAbierta.inAt)}</>
                    : "Sin jornada abierta"}
                </p>
                {isLongShift && (
                  <p role="status" className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                    Llevas más de 10 h con turno abierto — si ya terminaste, registra tu salida.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <Button
          variant={jornadaAbierta ? "default" : "outline"}
          size="sm"
          className="gap-2 shrink-0"
          disabled={loading || posting}
          onClick={() => void marcar(jornadaAbierta ? "OUT" : "IN")}
        >
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : jornadaAbierta ? (
            <LogOut className="h-4 w-4" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {jornadaAbierta ? "Registrar salida" : "Registrar entrada"}
        </Button>
      </CardContent>
    </Card>
  )
}
