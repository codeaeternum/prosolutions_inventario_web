"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Home, RefreshCw } from "lucide-react"

export default function TenantPublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Public storefront error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <main className="text-center max-w-md" role="main">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">No pudimos cargar esta página</h1>
        <p className="text-muted-foreground mt-2">
          Ocurrió un problema temporal al consultar la información del negocio. Intenta de nuevo en unos segundos.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
          <Button variant="outline" asChild>
            <Link href="/mercado">
              <Home className="h-4 w-4 mr-2" />
              Ver directorio
            </Link>
          </Button>
        </div>
      </main>
    </div>
  )
}
