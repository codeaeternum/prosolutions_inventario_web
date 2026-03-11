"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

/**
 * Muestra un banner cuando el service worker detecta una nueva versión y toma control.
 * Con next-pwa (skipWaiting: true) el nuevo SW se activa solo; este componente
 * escucha 'controllerchange' y ofrece recargar para ver los cambios.
 */
export function PwaUpdateBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.serviceWorker) return

    const onControllerChange = () => {
      setShow(true)
    }

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange)

    // Comprobar actualizaciones al recuperar el foco (pestaña o ventana)
    const onFocus = () => {
      navigator.serviceWorker.getRegistration()?.then((r) => r?.update())
    }
    window.addEventListener("focus", onFocus)

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange)
      window.removeEventListener("focus", onFocus)
    }
  }, [])

  if (!show) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-primary-foreground shadow-md safe-area-top"
      role="alert"
      aria-live="polite"
    >
      <p className="text-sm font-medium">
        Nueva versión disponible. Recarga para ver los cambios.
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => window.location.reload()}
        aria-label="Recargar la aplicación"
      >
        <RefreshCw className="mr-1.5 h-4 w-4" />
        Recargar
      </Button>
    </div>
  )
}
