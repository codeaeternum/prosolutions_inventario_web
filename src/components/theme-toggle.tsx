"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

const subscribeToNothing = () => () => {}

export function ThemeToggle() {
  // `theme` puede ser "system" (defaultTheme="system" en el root layout), así
  // que el estado real aplicado se lee de `resolvedTheme`. Usar `theme` aquí
  // era el bug: con sistema oscuro el icono salía invertido y el primer click
  // hacía setTheme("dark") — sin cambio visible.
  const { resolvedTheme, setTheme } = useTheme()

  // Detección de hidratación sin effect: false en SSR y en el primer render
  // del cliente (snapshot de servidor), true después. Evita el mismatch de
  // icono entre HTML servido y tema real.
  const mounted = React.useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )

  // resolvedTheme solo es confiable tras montar; antes se renderiza un
  // placeholder deshabilitado para evitar hydration mismatch.
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled>
        <Sun className="h-5 w-5" />
        <span className="sr-only">Cambiar tema</span>
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"
  const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={label}
      title={label}
    >
      {isDark ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      <span className="sr-only">{label}</span>
    </Button>
  )
}
