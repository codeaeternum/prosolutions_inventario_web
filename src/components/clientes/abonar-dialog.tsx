"use client"

import { useEffect, useRef, useState } from "react"
import { getClientOperationKey, type ClientOperationKey } from "@/lib/client-operation-key"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"

/** Cliente al que se le registra un abono a su saldo de crédito. */
export interface AbonarTarget {
  id: string
  name: string
  creditBalance: number | null
}

type AbonoMethod = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA"

interface AbonarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AbonarTarget | null
  /** Se llama tras registrar el abono (para refrescar saldos/movimientos). */
  onSuccess?: () => void
}

/**
 * Diálogo "Registrar Abono" compartido entre la cartera (/admin/clientes?tab=cobranza) y la
 * ficha 360 del cliente. Cobra por POST /api/credit/payment con llave de
 * idempotencia: un reintento con los mismos datos no duplica el abono.
 */
export function AbonarDialog({ open, onOpenChange, user, onSuccess }: AbonarDialogProps) {
  const paymentOperation = useRef<ClientOperationKey | null>(null)
  const paymentInFlight = useRef(false)
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<AbonoMethod>("EFECTIVO")
  // Sucursal donde entra el efectivo del abono; "AUTO" = sucursal base del cobrador.
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [branch, setBranch] = useState("AUTO")

  useEffect(() => {
    fetch("/api/branches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBranches((d?.branches ?? []).filter((b: { isActive: boolean }) => b.isActive)))
      .catch(() => {})
  }, [])

  // Limpiar el formulario al abrir el diálogo o cambiar de cliente
  // (ajuste de estado durante el render, patrón recomendado por React).
  const formKey = open ? `open:${user?.id ?? ""}` : "closed"
  const [resetKey, setResetKey] = useState("")
  if (formKey !== resetKey) {
    setResetKey(formKey)
    if (open) {
      setAmount("")
      setNotes("")
      setPaymentMethod("EFECTIVO")
      setBranch("AUTO")
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!paymentInFlight.current) onOpenChange(next)
  }

  const handleAbonar = async () => {
    if (paymentInFlight.current || !user || !amount) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Ingresa un monto válido mayor a 0")
      return
    }
    paymentInFlight.current = true
    setLoading(true)
    try {
      const payload = {
        userId: user.id,
        amount: value,
        notes: notes || undefined,
        paymentMethod,
        branchId: branch !== "AUTO" ? branch : undefined,
      }
      paymentOperation.current = getClientOperationKey(paymentOperation.current, payload)
      const res = await fetch("/api/credit/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: paymentOperation.current.key }),
      })
      const data = await res.json()
      if (res.ok) {
        paymentOperation.current = null
        toast.success(`Abono de ${formatPrice(value)} registrado para ${user.name}`)
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(data.error || "Error al registrar abono")
      }
    } catch {
      toast.error("No se pudo confirmar el abono. Reintenta con los mismos datos para evitar duplicarlo.")
    } finally {
      paymentInFlight.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar Abono</DialogTitle>
          <DialogDescription>
            {user && (
              <>
                Cliente: <strong>{user.name}</strong> — Deuda actual:{" "}
                <strong className="text-destructive">{formatPrice(user.creditBalance || 0)}</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Monto del Abono</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Ej: 500"
              value={amount}
              disabled={loading}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            {amount && user && parseFloat(amount) > 0 && (
              <p className="text-xs text-muted-foreground">
                Nuevo saldo: {formatPrice(Math.max(0, (user.creditBalance || 0) - parseFloat(amount)))}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="credit-payment-method">Medio de abono</Label>
            <Select
              value={paymentMethod}
              onValueChange={(value) => {
                if (!paymentInFlight.current) setPaymentMethod(value as AbonoMethod)
              }}
            >
              <SelectTrigger id="credit-payment-method" disabled={loading}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EFECTIVO">Efectivo</SelectItem>
                <SelectItem value="TARJETA">Tarjeta</SelectItem>
                <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {paymentMethod === "EFECTIVO"
                ? "Efectivo: requiere caja abierta y registra una entrada de dinero."
                : "Este abono reduce la deuda sin registrar efectivo en caja."}
            </p>
          </div>
          {paymentMethod === "EFECTIVO" && branches.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="credit-payment-branch">Sucursal donde se cobra</Label>
              <Select
                value={branch}
                onValueChange={(value) => {
                  if (!paymentInFlight.current) setBranch(value)
                }}
              >
                <SelectTrigger id="credit-payment-branch" disabled={loading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Mi sucursal (predeterminada)</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                El efectivo entra a la caja abierta de esta sucursal.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Textarea
              placeholder="Ej: Referencia o aclaración del abono"
              value={notes}
              disabled={loading}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleAbonar}
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="bg-green-600 hover:bg-green-700"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar Abono
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
