"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertTriangle, LayoutDashboard, RefreshCw } from "lucide-react"

export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Platform error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <main className="text-center max-w-md" role="main">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">No pudimos cargar la consola</h1>
        <p className="text-muted-foreground mt-2">
          Ocurrió un error inesperado en la consola de plataforma. Puedes reintentar o volver al inicio de la consola.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
          <Button variant="outline" asChild>
            <Link href="/platform">
              <LayoutDashboard className="h-4 w-4 mr-2" />
              Ir a la consola
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
