"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, Clock, Delete, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

// GET /api/staff — la misma lista que alimenta el cambio rápido de usuario.
interface StaffMember {
  id: string
  name: string
  role: string
  jobTitle: string | null
  hasPin: boolean
}

// Estado conocido SOLO por las checadas hechas en esta pantalla: el kiosco
// también lo puede operar un EMPLOYEE y la vista de negocio del checador es
// admin-only, así que no hay estado inicial en vivo — la tarjeta refleja lo
// marcado aquí de forma optimista.
type EstadoLocal = { open: boolean; since: string | null }

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City" })

const initials = (name: string) =>
  name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)

// Tras una checada la tarjeta queda en cooldown visual: el servidor ya
// deduplica a <60 s, esto solo evita el doble-tap inmediato.
const COOLDOWN_MS = 2_000

/**
 * Checador de mostrador (kiosco): grid de tarjetas grandes del staff; cada
 * persona toca su nombre, escribe su PIN en el teclado y el POST decide solo
 * si toca entrada o salida (auto). La sesión del operador nunca cambia.
 */
export function AsistenciaKiosco() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<Map<string, EstadoLocal>>(new Map())
  const [cooldown, setCooldown] = useState<Set<string>>(new Set())
  const [ahora, setAhora] = useState(() => new Date())

  const [seleccionado, setSeleccionado] = useState<StaffMember | null>(null)
  const [pin, setPin] = useState("")
  const [registrando, setRegistrando] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/staff", { signal })
      if (signal?.aborted) return
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (signal?.aborted) return
      setStaff(Array.isArray(data) ? data : [])
    } catch {
      if (!signal?.aborted) setError("No se pudo cargar el personal")
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const t = setTimeout(() => { void load(controller.signal) }, 0)
    return () => {
      clearTimeout(t)
      controller.abort()
    }
  }, [load])

  // Reloj grande del kiosco: un tick por segundo mientras la pantalla vive.
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const cerrarDialog = () => {
    if (registrando) return
    setSeleccionado(null)
    setPin("")
  }

  const registrar = async (miembro: StaffMember, pinValue: string) => {
    if (registrando) return
    setRegistrando(true)
    try {
      const res = await fetch("/api/asistencia/kiosco", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sin `type`: el servidor resuelve entrada/salida según la jornada.
        body: JSON.stringify({ userId: miembro.id, pin: pinValue }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const entrada = data?.event?.type === "IN"
        const nombre = typeof data?.userName === "string" ? data.userName : miembro.name
        toast.success(entrada ? `Entrada registrada — ${nombre}` : `Salida registrada — ${nombre}`)
        setEstado(prev => {
          const next = new Map(prev)
          next.set(miembro.id, { open: entrada, since: data?.event?.at ?? new Date().toISOString() })
          return next
        })
        setCooldown(prev => new Set(prev).add(miembro.id))
        setTimeout(() => {
          setCooldown(prev => {
            const next = new Set(prev)
            next.delete(miembro.id)
            return next
          })
        }, COOLDOWN_MS)
        setSeleccionado(null)
        setPin("")
      } else {
        toast.error(data?.error ?? "No se pudo registrar la checada")
        setPin("")
      }
    } catch {
      toast.error("Error de conexión")
      setPin("")
    } finally {
      setRegistrando(false)
    }
  }

  const tocarDigito = (d: string) => {
    if (registrando || !seleccionado || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    // Auto-submit al completar 6 dígitos (el máximo del PIN); con 4-5 la
    // persona confirma con "Registrar".
    if (next.length === 6) void registrar(seleccionado, next)
  }

  const borrarDigito = () => {
    if (registrando) return
    setPin(p => p.slice(0, -1))
  }

  const conPin = (staff ?? []).filter(m => m.hasPin)

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col items-center gap-1 pt-2 text-center">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Clock className="h-6 w-6 text-primary" />
          Checador
        </h1>
        <p className="text-sm text-muted-foreground">Toca tu nombre y escribe tu PIN</p>
        <p className="mt-2 text-5xl font-bold tabular-nums tracking-tight" aria-live="off">
          {ahora.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
        <p className="text-sm text-muted-foreground capitalize">
          {ahora.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Cargando personal">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </div>
      )}

      {!loading && !error && conPin.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Clock className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nadie del equipo tiene PIN rápido todavía. Configura PINs rápidos en{" "}
            <Link href="/admin/equipo?tab=usuarios" className="text-primary hover:underline">
              Equipo → Usuarios
            </Link>
            .
          </p>
        </div>
      )}

      {!loading && !error && conPin.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(staff ?? []).map(m => {
            const est = estado.get(m.id)
            const enfriado = cooldown.has(m.id)
            return (
              <button
                key={m.id}
                type="button"
                disabled={!m.hasPin || enfriado || registrando}
                onClick={() => { setSeleccionado(m); setPin("") }}
                className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="bg-primary/10 text-lg text-primary">
                    {initials(m.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium leading-tight">{m.name}</p>
                  {m.jobTitle && (
                    <p className="truncate text-xs text-muted-foreground">{m.jobTitle}</p>
                  )}
                </div>
                {!m.hasPin ? (
                  <span className="text-xs text-muted-foreground">Sin PIN</span>
                ) : est?.open ? (
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">
                    Adentro desde {est.since ? fmtHora(est.since) : "--:--"}
                  </Badge>
                ) : est ? (
                  <Badge variant="secondary">Afuera</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Toca para checar</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Teclado de PIN: objetos grandes pensados para tableta en el
          mostrador; el PIN nunca se muestra, solo puntos por dígito. */}
      <Dialog open={seleccionado !== null} onOpenChange={open => { if (!open) cerrarDialog() }}>
        <DialogContent className="sm:max-w-sm" onOpenAutoFocus={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-center">
              {seleccionado ? `Hola, ${seleccionado.name.split(" ")[0]}` : "Checador"}
            </DialogTitle>
          </DialogHeader>
          {seleccionado && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
                <Avatar className="h-11 w-11">
                  <AvatarFallback className="bg-primary text-sm text-primary-foreground">
                    {initials(seleccionado.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate font-medium">{seleccionado.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {seleccionado.jobTitle ?? (seleccionado.role === "ADMIN" ? "Administrador" : "Empleado")}
                  </p>
                </div>
              </div>

              <div className="flex justify-center gap-2" aria-label={`PIN de ${pin.length} dígitos`}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-4 w-4 rounded-full border-2 ${
                      i < pin.length ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => (
                  <Button
                    key={d}
                    type="button"
                    variant="outline"
                    className="h-16 text-2xl font-medium"
                    disabled={registrando}
                    onClick={() => tocarDigito(d)}
                  >
                    {d}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-16 text-lg"
                  disabled={registrando || pin.length === 0}
                  onClick={() => setPin("")}
                >
                  C
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-16 text-2xl font-medium"
                  disabled={registrando}
                  onClick={() => tocarDigito("0")}
                >
                  0
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-16"
                  disabled={registrando || pin.length === 0}
                  onClick={borrarDigito}
                  aria-label="Borrar dígito"
                >
                  <Delete className="h-6 w-6" />
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 flex-1 text-base"
                  disabled={registrando}
                  onClick={cerrarDialog}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  className="h-14 flex-1 text-base"
                  disabled={registrando || pin.length < 4}
                  onClick={() => void registrar(seleccionado, pin)}
                >
                  {registrando && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                  Registrar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
