"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertTriangle, LayoutDashboard, RefreshCw } from "lucide-react"

// Boundary del área /admin: vive dentro del AdminShell (sidebar intacto),
// así el usuario no sale del contexto del panel al reintentar.
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Admin error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <main className="text-center max-w-md" role="main">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">No pudimos cargar esta sección</h1>
        <p className="text-muted-foreground mt-2">
          Ocurrió un error inesperado en el panel. Puedes reintentar sin salir
          de aquí o volver al dashboard.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin">
              <LayoutDashboard className="h-4 w-4 mr-2" />
              Ir al dashboard
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
