"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  EyeOff,
  ListChecks,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface OnboardingStep {
  key: string
  label: string
  done: boolean
  href: string
}

interface OnboardingResponse {
  dismissed: boolean
  doneCount: number
  total: number
  steps: OnboardingStep[]
}

// Checklist de onboarding del dashboard. Solo se renderiza para ADMIN (el
// page lo decide); la API igual lo limita a staff. Mientras carga o si el
// negocio ya lo ocultó (dismissed) no muestra nada para evitar parpadeos.
export function OnboardingCard() {
  // null = cargando / no disponible / ocultado
  const [data, setData] = useState<OnboardingResponse | null>(null)
  const [dismissing, setDismissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/onboarding")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: OnboardingResponse | null) => {
        if (!cancelled && json && !json.dismissed) setData(json)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleDismiss = async () => {
    if (dismissing) return
    setDismissing(true)
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismiss: true }),
      })
      if (res.ok) {
        setData(null)
        toast.success("Guía de configuración ocultada")
      } else {
        toast.error("No se pudo ocultar la guía")
        setDismissing(false)
      }
    } catch {
      toast.error("Error de conexión")
      setDismissing(false)
    }
  }

  if (!data) return null

  const complete = data.doneCount === data.total
  const percent = Math.round((data.doneCount / data.total) * 100)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-5 w-5" />
            Configura tu negocio
          </CardTitle>
          <CardDescription>
            {complete
              ? "¡Tu cuenta está lista! Completaste todos los pasos."
              : "Completa estos pasos para dejar lista tu cuenta"}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 shrink-0 text-muted-foreground"
          onClick={handleDismiss}
          disabled={dismissing}
        >
          {dismissing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
          Ocultar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progreso */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {data.doneCount} de {data.total} completados
            </span>
            <span className="font-medium">{percent}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {complete ? (
          <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
            <span>
              Todo listo. Si ya no necesitas esta guía, usa «Ocultar» para
              quitarla del dashboard.
            </span>
          </div>
        ) : (
          <ul className="divide-y">
            {data.steps.map((step) => (
              <li key={step.key}>
                {step.done ? (
                  <div className="flex items-center gap-3 py-2.5">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                    <span className="text-sm text-muted-foreground">
                      {step.label}
                    </span>
                  </div>
                ) : (
                  <Link
                    href={step.href}
                    className="group flex items-center gap-3 py-2.5"
                  >
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                    <span className="flex-1 text-sm font-medium group-hover:text-primary group-hover:underline underline-offset-4">
                      {step.label}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
