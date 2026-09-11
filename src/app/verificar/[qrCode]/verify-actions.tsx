"use client"

import { useState, useRef } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { CheckCircle, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"

interface VerifyActionsProps {
  paymentMethod: string | null
  due: number
  qrCode: string
  canComplete: boolean
  status: string
  isExpired: boolean
}

export function VerifyActions({
  qrCode, paymentMethod, due,
  canComplete,
  status,
  isExpired,
}: VerifyActionsProps) {
  const [finalPaymentMethod, setFinalPaymentMethod] = useState("")
  const [completing, setCompleting] = useState(false)
  const [completed, setCompleted] = useState(status === "COMPLETED")
  const [error, setError] = useState("")
  const router = useRouter()
  const operation = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)

  const handleComplete = async () => {
    if (inFlight.current || completed) return
    if (paymentMethod !== "CREDIT" && due > 0 && !finalPaymentMethod) { setError("Selecciona el medio con el que recibiste el saldo."); return }
    inFlight.current = true
    operation.current = getClientOperationKey(operation.current, { qrCode, finalPaymentMethod })
    setCompleting(true)
    setError("")

    try {
      const res = await fetch("/api/reservations/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCode, finalPaymentMethod: paymentMethod === "CREDIT" ? "CREDIT" : finalPaymentMethod || undefined, idempotencyKey: operation.current.key }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "No se pudo marcar como entregado. Intenta de nuevo.")
        return
      }

      operation.current = null
      setCompleted(true)
      router.refresh()
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      inFlight.current = false
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

      {canComplete && !completed && paymentMethod !== "CREDIT" && due > 0 && <label className="block text-sm">Saldo por recibir: {new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(due)}
        <select className="mt-2 w-full rounded-md border bg-background p-2" aria-label="Medio de pago del saldo" value={finalPaymentMethod} disabled={completing} onChange={event => setFinalPaymentMethod(event.target.value)}>
          <option value="">Selecciona el medio de pago</option><option value="EFECTIVO">Efectivo</option><option value="TARJETA">Tarjeta</option><option value="TRANSFERENCIA">Transferencia</option>
        </select></label>}
      {canComplete && !completed && paymentMethod === "CREDIT" && <p className="text-sm text-muted-foreground">Compra a crédito: entregar conserva la deuda. Registra los abonos desde Crédito.</p>}
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
