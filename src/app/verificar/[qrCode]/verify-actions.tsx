"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CheckCircle, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface VerifyActionsProps {
  qrCode: string
  canComplete: boolean
  status: string
  isExpired: boolean
}

export function VerifyActions({
  qrCode,
  canComplete,
  status,
  isExpired,
}: VerifyActionsProps) {
  const [completing, setCompleting] = useState(false)
  const [completed, setCompleted] = useState(status === "COMPLETED")
  const [error, setError] = useState("")
  const router = useRouter()

  const handleComplete = async () => {
    setCompleting(true)
    setError("")

    try {
      const res = await fetch("/api/reservations/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCode }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "No se pudo marcar como entregado. Intenta de nuevo.")
        return
      }

      setCompleted(true)
      router.refresh()
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div className="space-y-3 pt-4 border-t">
      {error && (
        <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm" role="alert">
          {error}
        </div>
      )}

      {completed ? (
        <div className="p-4 bg-primary/10 rounded-lg text-center border border-primary/20">
          <CheckCircle className="h-8 w-8 text-primary mx-auto mb-2" />
          <p className="font-medium text-foreground">
            Reserva completada
          </p>
          <p className="text-sm text-muted-foreground">
            El producto ha sido entregado exitosamente
          </p>
        </div>
      ) : canComplete ? (
        <Button
          onClick={handleComplete}
          disabled={completing}
          className="w-full h-12 text-lg"
        >
          {completing ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Completando...
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-5 w-5" />
              Completar Entrega
            </>
          )}
        </Button>
      ) : isExpired ? (
        <div className="p-3 bg-destructive/10 rounded-lg text-center text-sm text-destructive" role="status">
          Esta reserva ha expirado y no puede ser completada
        </div>
      ) : (
        <div className="p-3 bg-muted rounded-lg text-center text-sm text-muted-foreground border border-border" role="status">
          Esta reserva aún no está lista para entrega.
          Estado actual: {status}
        </div>
      )}

      <Button variant="outline" className="w-full" asChild>
        <Link href="/admin/reservas">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver a Reservas
        </Link>
      </Button>
    </div>
  )
}
