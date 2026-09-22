"use client"

import { useRef, useState } from "react"
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
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatPrice } from "@/lib/utils"

/** Cliente cuya línea de crédito o saldo se gestiona desde la ficha 360. */
export interface CreditoTarget {
  id: string
  name: string
  creditLimit: number | null
  creditBalance: number | null
}

interface CreditoDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: CreditoTarget | null
  /** Se llama tras el cambio (para refrescar saldos/movimientos). */
  onSuccess?: () => void
}

// Ajuste de estado durante el render: reinicia el formulario al abrir o
// cambiar de cliente (mismo patrón que AbonarDialog).
function useFormReset(open: boolean, userId: string | undefined, reset: () => void) {
  const formKey = open ? `open:${userId ?? ""}` : "closed"
  const [resetKey, setResetKey] = useState("")
  if (formKey !== resetKey) {
    setResetKey(formKey)
    if (open) reset()
  }
}

/**
 * Edita el límite de crédito del cliente por PATCH /api/credit/users/[id]
 * (módulo "credito"). Vacío = quita la línea (null); el servidor rechaza
 * límites por debajo de la deuda viva.
 */
export function EditarLimiteDialog({ open, onOpenChange, user, onSuccess }: CreditoDialogProps) {
  const inFlight = useRef(false)
  const [limit, setLimit] = useState("")
  const [loading, setLoading] = useState(false)

  useFormReset(open, user?.id, () => {
    setLimit(user?.creditLimit != null ? String(user.creditLimit) : "")
  })

  const handleOpenChange = (next: boolean) => {
    if (!inFlight.current) onOpenChange(next)
  }

  const handleSave = async () => {
    if (inFlight.current || !user) return
    const value = limit.trim() === "" ? null : Number(limit)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Ingresa un límite válido (0 o más; vacío para quitar el crédito)")
      return
    }
    inFlight.current = true
    setLoading(true)
    try {
      const res = await fetch(`/api/credit/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creditLimit: value }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(value === null ? "Línea de crédito removida" : `Límite actualizado a ${formatPrice(value)}`)
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(data.error || "Error al actualizar el límite")
      }
    } catch {
      toast.error("Error de conexión")
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar límite de crédito</DialogTitle>
          <DialogDescription>
            {user && (
              <>
                Cliente: <strong>{user.name}</strong> — Límite actual:{" "}
                <strong>{user.creditLimit != null ? formatPrice(user.creditLimit) : "Sin crédito"}</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Nuevo límite</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Ej: 5000"
              value={limit}
              disabled={loading}
              onChange={(e) => setLimit(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Vacío = sin línea de crédito; 0 = crédito inhabilitado para nuevos cargos.
            </p>
            {(user?.creditBalance ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Deuda actual: {formatPrice(user!.creditBalance!)} — el límite no puede quedar por debajo.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar límite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Registra un cargo manual (DEBT) por POST /api/credit/debt con llave de
 * idempotencia: un reintento con los mismos datos no duplica el cargo.
 * Requiere rol ADMIN y límite de crédito que cubra el cargo.
 */
export function CargoManualDialog({ open, onOpenChange, user, onSuccess }: CreditoDialogProps) {
  const operation = useRef<ClientOperationKey | null>(null)
  const inFlight = useRef(false)
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")
  const [loading, setLoading] = useState(false)

  useFormReset(open, user?.id, () => {
    setAmount("")
    setNotes("")
  })

  const disponible =
    user?.creditLimit != null && user.creditLimit > 0
      ? user.creditLimit - (user.creditBalance ?? 0)
      : null

  const handleOpenChange = (next: boolean) => {
    if (!inFlight.current) onOpenChange(next)
  }

  const handleCargo = async () => {
    if (inFlight.current || !user || !amount) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Ingresa un monto válido mayor a 0")
      return
    }
    const note = notes.trim()
    if (!note) {
      toast.error("La nota es obligatoria para un cargo manual")
      return
    }
    inFlight.current = true
    setLoading(true)
    try {
      const payload = { userId: user.id, amount: value, notes: note }
      operation.current = getClientOperationKey(operation.current, payload)
      const res = await fetch("/api/credit/debt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey: operation.current.key }),
      })
      const data = await res.json()
      if (res.ok) {
        operation.current = null
        toast.success(`Cargo de ${formatPrice(value)} registrado para ${user.name}`)
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(data.error || "Error al registrar el cargo")
      }
    } catch {
      toast.error("No se pudo confirmar el cargo. Reintenta con los mismos datos para evitar duplicarlo.")
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar cargo manual</DialogTitle>
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
            <Label>Monto del cargo</Label>
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
            {disponible === null ? (
              <p className="text-xs text-destructive">
                Sin límite de crédito activo: edítalo antes de cargar.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Crédito disponible: {formatPrice(Math.max(0, disponible))}
                {amount && parseFloat(amount) > disponible && " — el monto supera el disponible"}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Nota del cargo</Label>
            <Textarea
              placeholder="Ej: Cargo por servicio, ajuste o reposición"
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
            onClick={handleCargo}
            disabled={loading || !amount || parseFloat(amount) <= 0 || !notes.trim()}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Registrar cargo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
