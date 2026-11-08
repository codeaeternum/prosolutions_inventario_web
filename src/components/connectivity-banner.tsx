"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Wifi, WifiOff } from "lucide-react"
import { cn } from "@/lib/utils"

const PING_INTERVAL_MS = 30_000
const PING_TIMEOUT_MS = 8_000
const RECONNECTED_BANNER_MS = 3_000

type ConnectivityStatus = "online" | "offline" | "reconnected"

/**
 * Latido contra el servidor. Cualquier respuesta HTTP —incluso un 503 de
 * "degraded"— confirma que hay camino hasta el origen; solo un rechazo de red
 * o timeout lo marca como inalcanzable (túnel caído, DNS roto, captive portal).
 */
async function pingServer(): Promise<boolean> {
  try {
    await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    })
    return true
  } catch {
    return false
  }
}

interface ConnectivityBannerProps {
  /**
   * Reserva espacio sobre la barra de navegación inferior fija (<lg en admin).
   * En páginas públicas sin barra, el aviso queda pegado al borde inferior.
   */
  aboveBottomNav?: boolean
}

/**
 * Indicador persistente de conectividad. Los eventos online/offline del
 * navegador detectan cortes del SO pero dan falsos positivos (red local viva
 * con el túnel o el servidor caído), así que el estado real solo sale de pings
 * verificados a /api/health: al montar, en cada evento "online" y cada 30s.
 * Al recuperarse muestra un aviso verde breve y revalida los datos (RSC) para
 * que la pantalla se refresque sola, sin recarga manual.
 */
export function ConnectivityBanner({ aboveBottomNav = false }: ConnectivityBannerProps) {
  const router = useRouter()
  const [status, setStatus] = useState<ConnectivityStatus>("online")
  // Espejo del estado: permite saber, dentro del ping asíncrono, si venimos de
  // una caída real (→ flash verde + refresh) o solo es una confirmación más.
  const statusRef = useRef<ConnectivityStatus>("online")
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const applyStatus = (next: ConnectivityStatus) => {
      statusRef.current = next
      setStatus(next)
    }

    const verify = async () => {
      // Sin red a nivel SO el fetch fallaría de todos modos: marcar directo.
      if (!navigator.onLine) {
        applyStatus("offline")
        return
      }
      const reachable = await pingServer()
      if (reachable) {
        if (statusRef.current === "offline") {
          // Recuperación confirmada: aviso breve + revalidado suave de datos.
          applyStatus("reconnected")
          router.refresh()
          if (hideTimer.current) clearTimeout(hideTimer.current)
          hideTimer.current = setTimeout(() => {
            if (statusRef.current === "reconnected") applyStatus("online")
          }, RECONNECTED_BANNER_MS)
        }
        // "online" no cambia; "reconnected" termina su flash por el temporizador
        // (un ping tardío no debe cortarlo).
      } else {
        applyStatus("offline")
      }
    }

    const handleOffline = () => applyStatus("offline")
    const handleOnline = () => void verify()

    window.addEventListener("offline", handleOffline)
    window.addEventListener("online", handleOnline)

    // Verificación inicial + sondeo periódico solo con pestaña visible y red
    // reportada por el SO (ahorra requests cuando el equipo duerme o está sin red).
    void verify()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void verify()
      }
    }, PING_INTERVAL_MS)

    return () => {
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("online", handleOnline)
      clearInterval(interval)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [router])

  if (status === "online") return null

  const offline = status === "offline"

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4",
        aboveBottomNav
          ? "bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6"
          : "bottom-4 sm:bottom-6",
      )}
    >
      <div
        role={offline ? "alert" : "status"}
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg",
          "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300",
          offline
            ? "bg-destructive text-destructive-foreground"
            : "bg-success text-success-foreground",
        )}
      >
        {offline ? (
          <>
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>Sin conexión — los cambios no se guardarán</span>
          </>
        ) : (
          <>
            <Wifi className="h-4 w-4 shrink-0" aria-hidden />
            <span>Conexión restablecida</span>
          </>
        )}
      </div>
    </div>
  )
}
