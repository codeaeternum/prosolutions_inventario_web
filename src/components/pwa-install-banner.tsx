"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { X, Smartphone, Share } from "lucide-react"

const STORAGE_KEY = "pwa-install-banner-dismissed"

export function PwaInstallBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const standalone =
      (window.navigator as { standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches ||
      (window as Window & { matchMedia?: (q: string) => { matches: boolean } }).matchMedia?.("(display-mode: fullscreen)")?.matches

    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    const dismissed = localStorage.getItem(STORAGE_KEY) === "1"

    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee matchMedia/localStorage una vez al montar (APIs solo de navegador)
    setVisible(!standalone && mobile && !dismissed)
  }, [])

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card px-4 py-3 shadow-lg safe-area-bottom sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-sm sm:rounded-xl"
      role="banner"
      aria-label="Instalar app"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Smartphone className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Instalar Pro-Solutions</p>
          <p className="text-sm text-muted-foreground">
            Añade la app a la pantalla de inicio para escanear QR y usar todo desde el móvil.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Menú <Share className="inline h-3 w-3" /> → &quot;Añadir a la pantalla de inicio&quot;
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href="/instalar">Cómo instalar</Link>
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Ahora no
            </Button>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={dismiss}
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
